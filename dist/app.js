import {chapters, questions} from './questions.js';

const $ = id => document.getElementById(id);
const typeName = {single:'单项选择题', multi:'多项选择题', written:'简答与应用题'};
const letters = ['A','B','C','D'];
const storageKey = 'cpa-accounting-zero-v1';
const defaultData = {records:{}, marks:[], shuffle:false};
let data;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  data = saved && typeof saved === 'object' ? {
    records:saved.records && typeof saved.records === 'object' ? saved.records : {},
    marks:Array.isArray(saved.marks) ? saved.marks : [],
    shuffle:Boolean(saved.shuffle)
  } : defaultData;
} catch { data = defaultData; }
let chapterIndex = 0;
let sectionName = null;
let session;
let fontSize = 1;
let timerHandle = null;
let modalReturnFocus = null;
let selectionOpen = true;
const byId = new Map(questions.map(q => [q.id,q]));

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(data)); }
  catch { /* The practice still works when local storage is unavailable. */ }
}
function el(tag, className, textValue) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (textValue !== undefined) node.textContent = textValue;
  return node;
}
function shuffle(input) {
  const a = input.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i],a[j]] = [a[j],a[i]];
  }
  return a;
}
function makeSession(mode, items) {
  const orders = {};
  items.forEach(q => {
    if (q.options) orders[q.id] = data.shuffle ? shuffle(q.options.map((_,i) => i)) : q.options.map((_,i) => i);
  });
  session = {mode, items, index:0, answers:{}, orders, marked:new Set(data.marks), finished:false, showResult:false, seconds:45*60};
  if (timerHandle) clearInterval(timerHandle);
  if (mode === 'mock') {
    timerHandle = setInterval(() => {
      if (selectionOpen || session.mode !== 'mock' || session.finished) return;
      session.seconds--;
      updateTimer();
      if (session.seconds <= 0) finishMock(true);
    }, 1000);
  }
  closeDrawer();
  render();
}
function chapterSections(index) {
  return [...new Set(questions.filter(q => q.chapterIndex === index).map(q => q.source?.section).filter(Boolean))];
}
function startChapter(index, requestedSection) {
  const previousSection = index === chapterIndex ? sectionName : null;
  chapterIndex = index;
  const sections = chapterSections(index);
  sectionName = requestedSection === undefined ? (previousSection && (previousSection === '__all__' || sections.includes(previousSection)) ? previousSection : sections[0] || '__all__') : requestedSection;
  if (sectionName !== '__all__' && !sections.includes(sectionName)) sectionName = sections[0] || '__all__';
  const sectionSelect = $('sectionSelect');
  sectionSelect.replaceChildren();
  if (sections.length) {
    const all = el('option','','本章全部（'+chapters[index].items.length+' 题）');
    all.value = '__all__';
    sectionSelect.append(all);
    sections.forEach(section => {
      const count = questions.filter(q => q.chapterIndex === index && q.source?.section === section).length;
      const option = el('option','',section+'（'+count+' 题）');
      option.value = section;
      sectionSelect.append(option);
    });
    sectionSelect.value = sectionName;
  }
  makeSession('learn', questions.filter(q => q.chapterIndex === index && (sectionName === '__all__' || q.source?.section === sectionName)));
}
function startMock() {
  const singles = shuffle(questions.filter(q => q.type === 'single')).slice(0,10);
  const multis = shuffle(questions.filter(q => q.type === 'multi')).slice(0,5);
  const writtens = shuffle(questions.filter(q => q.type === 'written')).slice(0,5);
  makeSession('mock', [...singles,...multis,...writtens]);
}
function startWrong() {
  const items = questions.filter(q => data.records[q.id]?.wrong);
  makeSession('wrong', items);
}
function current() { return session.items[session.index]; }
function answerFor(q) {
  if (!session.answers[q.id]) session.answers[q.id] = {choices:[], text:'', submitted:false, judged:null, recorded:false};
  return session.answers[q.id];
}
function chosenCorrect(q, answer) {
  if (q.type === 'written') return false;
  const expected = q.type === 'single' ? [q.answer] : q.answer;
  return expected.length === answer.choices.length && expected.every(i => answer.choices.includes(i));
}
function recordOutcome(q, correct, answer) {
  if (answer.recorded) return;
  const record = data.records[q.id] || {attempts:0, correct:0, wrong:false, streak:0};
  record.attempts += 1;
  if (correct) {
    record.correct += 1;
    if (record.wrong) {
      record.streak += 1;
      if (record.streak >= 3) { record.wrong = false; record.streak = 0; }
    }
  } else {
    record.wrong = true;
    record.streak = 0;
  }
  data.records[q.id] = record;
  answer.recorded = true;
  save();
}
function selectChoice(q, canonical) {
  if (session.finished || answerFor(q).submitted) return;
  const a = answerFor(q);
  if (q.type === 'single') a.choices = [canonical];
  else a.choices = a.choices.includes(canonical) ? a.choices.filter(i => i !== canonical) : [...a.choices,canonical];
  render();
}
function submitAnswer() {
  const q = current();
  if (!q || session.mode === 'mock' || session.finished) return;
  const a = answerFor(q);
  if (a.submitted) return;
  if (q.type !== 'written' && !a.choices.length) {
    $('toolTip').textContent = '请先选择至少一个选项。';
    return;
  }
  if (q.type === 'written' && !a.text.trim()) {
    $('toolTip').textContent = '请先写出你的思路，再看参考答案。';
    $('writtenInput')?.focus();
    return;
  }
  a.submitted = true;
  if (q.type !== 'written') recordOutcome(q, chosenCorrect(q,a), a);
  render();
}
function gradeWritten(isCorrect) {
  const q = current();
  if (!q || q.type !== 'written') return;
  const a = answerFor(q);
  if (!a.submitted && !session.finished) return;
  if (a.judged !== null) return;
  a.judged = isCorrect;
  recordOutcome(q, isCorrect, a);
  render();
}
function finishMock(auto) {
  if (session.mode !== 'mock' || session.finished) return;
  if (!auto) {
    const unanswered = session.items.filter(q => {
      const a = answerFor(q);
      return q.type === 'written' ? !a.text.trim() : !a.choices.length;
    }).length;
    openModal('确认交卷', body => {
      body.append(el('p','',unanswered ? '还有 '+unanswered+' 题未填写。交卷后可查看解析与参考答案。' : '交卷后会显示客观题成绩和所有题目的解析。'));
      const row = el('div','self-grade');
      const yes = el('button','','确认交卷');
      const cancel = el('button','no','继续作答');
      yes.onclick = () => { closeModal(); finishMock(true); };
      cancel.onclick = closeModal;
      row.append(yes,cancel);
      body.append(row);
    });
    return;
  }
  session.finished = true;
  session.showResult = true;
  if (timerHandle) clearInterval(timerHandle);
  session.items.forEach(q => {
    const a = answerFor(q);
    if (q.type !== 'written') recordOutcome(q, chosenCorrect(q,a), a);
  });
  render();
}
function navigate(i) {
  if (i < 0 || i >= session.items.length) return;
  session.index = i;
  session.showResult = false;
  closeDrawer();
  render();
  $('paper').scrollTop = 0;
}
function wrongCount() { return questions.filter(q => data.records[q.id]?.wrong).length; }
function updateTimer() {
  $('timer').textContent = session.mode === 'mock'
    ? (session.finished ? '已交卷' : '剩余 '+String(Math.floor(session.seconds/60)).padStart(2,'0')+':'+String(Math.max(0,session.seconds%60)).padStart(2,'0'))
    : session.mode === 'wrong' ? '错题复习' : '学习模式';
}
function renderNav() {
  const container = $('questionNav');
  container.replaceChildren();
  if (!session.items.length) {
    container.append(el('p','writing-hint','暂无错题，先去章节学习。'));
    return;
  }
  for (const type of ['single','multi','written']) {
    const items = session.items.map((q,i) => ({q,i})).filter(({q}) => q.type === type);
    if (!items.length) continue;
    const group = el('section','nav-group');
    group.append(el('div','nav-group-title',typeName[type]+'（'+items.length+'）'));
    const chips = el('div','chips');
    items.forEach(({q,i}) => {
      const a = session.answers[q.id];
      const classes = ['q-chip'];
      if (i === session.index && !session.showResult) classes.push('current');
      if (a && (a.submitted || a.choices.length || a.text.trim())) classes.push('answered');
      if (data.marks.includes(q.id)) classes.push('marked');
      const chip = el('button',classes.join(' '),String(i+1));
      chip.type = 'button';
      chip.title = '第 '+(i+1)+' 题 · '+q.chapterTitle;
      chip.setAttribute('aria-label',chip.title);
      chip.onclick = () => navigate(i);
      chips.append(chip);
    });
    group.append(chips);
    container.append(group);
  }
}
function renderStats() {
  $('wrongCount').textContent = wrongCount();
  $('streakCount').textContent = wrongCount()+' 道待复习';
  $('doneCount').textContent = Object.keys(data.records).filter(id => byId.has(id)).length+' / '+questions.length+' 题已练';
}
function renderQuestion(q) {
  const box = $('questionContent');
  box.replaceChildren();
  box.hidden = false;
  const a = answerFor(q);
  box.append(el('div','question-head', '第 '+(session.index+1)+' / '+session.items.length+' 题 · '+typeName[q.type]+' · '+q.level));
  box.append(el('h2','question-title',q.stem));
  if (q.options) {
    const optionBox = el('div','options');
    session.orders[q.id].forEach((canonical,shown) => {
      const chosen = a.choices.includes(canonical);
      const btn = el('button','option'+(chosen?' selected':''));
      btn.type = 'button';
      btn.setAttribute('aria-pressed',String(chosen));
      const canShowFeedback = session.mode === 'mock' ? session.finished : a.submitted;
      if (canShowFeedback) {
        const expected = q.type === 'single' ? [q.answer] : q.answer;
        if (expected.includes(canonical)) btn.classList.add('correct');
        else if (chosen) btn.classList.add('incorrect');
      }
      btn.disabled = a.submitted || session.finished;
      btn.append(el('span','letter',letters[shown]),el('span','',q.options[canonical]));
      btn.onclick = () => selectChoice(q,canonical);
      optionBox.append(btn);
    });
    box.append(optionBox);
    if (q.type === 'multi') box.append(el('p','writing-hint','多选题：请选出所有正确选项。'));
  } else {
    const textarea = el('textarea','written-area');
    textarea.id = 'writtenInput';
    textarea.placeholder = '先写下你的判断和理由，再查看参考答案。';
    textarea.value = a.text;
    textarea.disabled = a.submitted || session.finished;
    textarea.addEventListener('input', e => { a.text = e.target.value; });
    box.append(textarea);
    box.append(el('p','writing-hint','简答题需自行对照参考答案评分；模拟模式交卷后显示参考答案。'));
  }
  renderFeedback(q,a);
}
function sourceLabel(q) {
  if (!q.source) return '';
  const {chapter, section, printedPage, pdfPage} = q.source;
  const location = [chapter, section].filter(Boolean).join(' · ');
  const pages = [printedPage ? '教材第 '+printedPage+' 页' : '', pdfPage ? 'PDF 第 '+pdfPage+' 页' : ''].filter(Boolean).join(' / ');
  return [location, pages].filter(Boolean).join(' · ');
}
function renderFeedback(q,a) {
  const panel = $('feedback');
  panel.replaceChildren();
  const visible = session.mode === 'mock' ? session.finished : a.submitted;
  panel.hidden = !visible;
  if (!visible) return;
  let correct = q.type !== 'written' ? chosenCorrect(q,a) : a.judged;
  panel.classList.toggle('bad',correct === false);
  if (q.type !== 'written') {
    panel.append(el('h2','',correct?'回答正确':'再巩固一下'));
    const indices = q.type === 'single' ? [q.answer] : q.answer;
    const displayed = indices.map(i => letters[session.orders[q.id].indexOf(i)]).sort().join('、');
    panel.append(el('p','answer-line','正确答案：'+displayed));
    panel.append(el('p','',q.explain));
  } else {
    panel.append(el('h2','',a.judged === null ? '参考答案与自评' : a.judged ? '已记为掌握' : '已加入错题复习'));
    panel.append(el('p','answer-line','参考作答：'+q.sample));
    panel.append(el('p','',q.explain));
    if (a.judged === null) {
      const row = el('div','self-grade');
      const yes = el('button','','我的答案基本正确');
      const no = el('button','no','还不会，加入错题');
      yes.onclick = () => gradeWritten(true);
      no.onclick = () => gradeWritten(false);
      row.append(yes,no);
      panel.append(row);
    }
  }
  if (q.knowledgePoint) panel.append(el('p','knowledge-line','知识点：'+q.knowledgePoint));
  if (q.source) panel.append(el('p','source-line','教材位置：'+sourceLabel(q)));
  if (data.records[q.id]?.wrong) {
    const n = data.records[q.id].streak || 0;
    panel.append(el('p','writing-hint','错题复习进度：连续答对 '+n+' / 3 次可移出错题本。'));
  }
}
function renderResult() {
  const box = $('result');
  box.replaceChildren();
  box.hidden = false;
  const objective = session.items.filter(q => q.type !== 'written');
  const correct = objective.filter(q => chosenCorrect(q,answerFor(q))).length;
  box.append(el('h2','','模拟练习完成'));
  box.append(el('p','score','客观题 '+correct+' / '+objective.length+' 题正确'));
  box.append(el('p','','本套题从原创入门题库抽取，练习时长 45 分钟；不是中注协官方试卷，也不代表真实考试分数。'));
  box.append(el('p','','简答与应用题需点击题号，对照参考答案自行评价。错题会进入错题复习。'));
  const row = el('div','self-grade');
  const review = el('button','','从第 1 题查看解析');
  const again = el('button','','重新抽题');
  const learn = el('button','','返回章节学习');
  review.onclick = () => navigate(0);
  again.onclick = startMock;
  learn.onclick = () => startChapter(chapterIndex);
  row.append(review,again,learn);
  box.append(row);
  const list = el('div','result-list');
  session.items.forEach((q,i) => {
    const a = answerFor(q);
    const label = q.type === 'written' ? (a.judged === null?'待自评':a.judged?'已掌握':'需复习') : chosenCorrect(q,a)?'正确':'错误';
    const item = el('button','result-item');
    item.type = 'button';
    item.append(el('strong','',String(i+1).padStart(2,'0')+' · '+typeName[q.type]+' · '+label),el('span','',q.stem));
    item.onclick = () => navigate(i);
    list.append(item);
  });
  box.append(list);
}
function render() {
  renderStats();
  updateTimer();
  for (const mode of ['Learn','Mock','Wrong']) {
    const button = $('mode'+mode);
    const isActive = session.mode === mode.toLowerCase();
    button.classList.toggle('active',isActive);
    button.setAttribute('aria-current',isActive?'page':'false');
  }
  $('chapterSelect').value = String(chapterIndex);
  $('chapterSelect').disabled = session.mode !== 'learn';
  $('sectionPicker').hidden = session.mode !== 'learn' || !chapterSections(chapterIndex).length;
  $('sectionSelect').disabled = session.mode !== 'learn';
  $('chapterNote').textContent = session.mode === 'learn' ? (sectionName === '__all__' ? '本章共 '+chapters[chapterIndex].items.length+' 题。' : '当前练习 '+session.items.length+' / '+chapters[chapterIndex].items.length+' 题；切换知识节可练习其余题目。')+' '+chapters[chapterIndex].lead
    : session.mode === 'mock' ? '45 分钟 · 随机抽取 20 题 · 交卷后查看解析与自评'
    : '答错或自评“还不会”的题进入错题本；连续答对 3 次移出。';
  renderNav();
  const q = current();
  $('questionType').textContent = session.mode === 'learn' ? (chapterIndex < 3 ? '基础理论 · 逐题讲解' : '章节学习 · 逐题讲解')
    : session.mode === 'mock' ? '机考模拟 · 原创练习' : '错题复习 · 巩固';
  $('sessionTitle').textContent = session.mode === 'learn' ? '第 '+(chapterIndex+1)+' 章 · '+chapters[chapterIndex].title+(sectionName === '__all__' ? '' : ' · '+sectionName)
    : session.mode === 'mock' ? '会计 · 模拟练习' : '会计 · 错题复习';
  $('markBtn').disabled = !q || session.showResult;
  $('markBtn').classList.toggle('active',Boolean(q && data.marks.includes(q.id)));
  $('markBtn').textContent = q && data.marks.includes(q.id) ? '★ 已标记' : '☆ 标记';
  const isResult = session.showResult;
  $('result').hidden = !isResult;
  $('questionContent').hidden = isResult || !q;
  $('feedback').hidden = isResult || !q;
  $('intro').hidden = isResult || !q;
  $('prevBtn').hidden = isResult || !q;
  $('nextBtn').hidden = isResult || !q;
  $('submitBtn').hidden = isResult || !q || session.mode === 'mock' || Boolean(q && answerFor(q).submitted);
  $('finishBtn').hidden = session.mode !== 'mock' || isResult;
  $('finishBtn').textContent = session.finished ? '查看结果' : '交卷';
  $('prevBtn').disabled = !q || session.index === 0;
  $('nextBtn').disabled = !q || session.index === session.items.length-1;
  $('toolTip').textContent = session.mode === 'mock' ? '答案自动保留，点击“交卷”查看解析'
    : session.mode === 'wrong' ? '连续答对 3 次可移出错题本' : '选好答案后点击“提交答案”';
  if (isResult) { renderResult(); $('intro').replaceChildren(); return; }
  $('result').replaceChildren();
  if (!q) {
    $('intro').hidden = true;
    const empty = el('div','empty');
    empty.append(el('h2','','错题本还是空的'),el('p','','从章节学习开始，答错的题会自动出现在这里。'));
    const start = el('button','','开始章节学习');
    start.onclick = () => startChapter(chapterIndex);
    empty.append(start);
    $('questionContent').replaceChildren(empty);
    $('questionContent').hidden = false;
    return;
  }
  $('intro').replaceChildren();
  if (session.mode === 'learn') {
    $('intro').append(el('strong','','本章先知道：'),document.createTextNode(chapters[chapterIndex].lead));
  } else if (session.mode === 'mock') {
    $('intro').append(el('strong','','模拟作答提示：'),document.createTextNode('使用左侧题号跳题、标记，底部按钮翻页和交卷。交卷前不显示答案。'));
  } else {
    $('intro').append(el('strong','','错题巩固：'),document.createTextNode('重新作答后查看解析，连续答对 3 次自动移出错题本。'));
  }
  renderQuestion(q);
}
function openModal(title, build) {
  modalReturnFocus = document.activeElement;
  $('modalTitle').textContent = title;
  $('modalBody').replaceChildren();
  build($('modalBody'));
  $('modal').hidden = false;
  $('modalClose').focus();
}
function closeModal() {
  $('modal').hidden = true;
  $('modalBody').replaceChildren();
  if (modalReturnFocus?.focus) modalReturnFocus.focus();
}
function closeDrawer() {
  $('sidebar').classList.remove('open');
  $('sideScrim').hidden = true;
}
function openAccounting() {
  selectionOpen = false;
  $('subjectPicker').hidden = true;
  $('practiceApp').hidden = false;
  updateTimer();
  $('mode'+session.mode[0].toUpperCase()+session.mode.slice(1)).focus();
}
function showSubjectPicker() {
  if (!$('modal').hidden) closeModal();
  closeDrawer();
  selectionOpen = true;
  $('practiceApp').hidden = true;
  $('subjectPicker').hidden = false;
  $('chooseAccounting').focus();
}
function showHelp() {
  openModal('使用说明', body => {
    body.append(el('p','','按 2026 年《会计》教材组织 30 章，共 '+questions.length+' 道原创入门题。基础理论对应第 1 至 3 章，答案解析标有教材位置。章节学习先读提示再作答；模拟练习在交卷后看解析；错题连续答对 3 次移出。'));
    body.append(el('p','','入口页可以选择科目。目前只开放《会计》；其他科目尚无题库。返回选科页时会保留本次作答，并暂停模拟练习计时。'));
    body.append(el('p','','键盘操作：↑ 或 ← 切换到上一题，↓ 或 → 切换到下一题；数字键 1～4 可选答案。在输入答案、选择章节或使用计算器时，方向键不会切题。'));
    body.append(el('p','','布局和题号导航、标记、计算器、交卷操作参考官方机考模拟练习系统。本站为独立制作的学习工具，非中注协官方练习网站，题目不是真题。'));
    const p = el('p');
    const a = el('a','','打开中注协官方模拟练习网站');
    a.href = 'https://cpademo.joytest.org.cn/';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    p.append(a);
    body.append(p);
    body.append(el('p','','答题记录只保存在当前浏览器；下载 CSV 可以离线查看题目。2027 年备考请在新版考试大纲发布后核对变化。'));
  });
}
function showCalculator() {
  openModal('简易计算器', body => {
    const input = el('input','calc-display');
    input.type = 'text'; input.readOnly = true; input.value = '';
    input.setAttribute('aria-label','计算式');
    const grid = el('div','calc-grid');
    const output = el('div','calc-output');
    for (const token of ['7','8','9','÷','4','5','6','×','1','2','3','−','C','0','.','+','=','(',')','⌫']) {
      const btn = el('button',token==='='?'calc-equal':'',token);
      btn.type = 'button';
      btn.onclick = () => {
        if (token==='C') { input.value=''; output.textContent=''; }
        else if (token==='⌫') input.value=input.value.slice(0,-1);
        else if (token==='=') {
          try { output.textContent = '= '+String(calculate(input.value)); }
          catch { output.textContent='表达式有误'; }
        } else { input.value += token; output.textContent=''; }
      };
      grid.append(btn);
    }
    body.append(input,grid,output,el('p','writing-hint','支持加、减、乘、除及括号；供练习使用。'));
  });
}
function calculate(expression) {
  const tokens = expression.replaceAll('×','*').replaceAll('÷','/').replaceAll('−','-').replace(/\s/g,'').match(/(?:\d+(?:\.\d*)?|\.\d+)|[()+*/-]/g);
  if (!tokens || tokens.join('') !== expression.replaceAll('×','*').replaceAll('÷','/').replaceAll('−','-').replace(/\s/g,'')) throw Error('invalid');
  let i=0;
  function primary() {
    if (tokens[i]==='-') { i++; return -primary(); }
    if (tokens[i]==='+') { i++; return primary(); }
    if (tokens[i]==='(') { i++; const value=sum(); if (tokens[i++]!==')') throw Error('bracket'); return value; }
    if (i>=tokens.length || !/^(?:\d|\.)/.test(tokens[i])) throw Error('number');
    return Number(tokens[i++]);
  }
  function product() {
    let x=primary();
    while (tokens[i]==='*' || tokens[i]==='/') { const op=tokens[i++], y=primary(); if (op==='/' && y===0) throw Error('zero'); x=op==='*'?x*y:x/y; }
    return x;
  }
  function sum() {
    let x=product();
    while (tokens[i]==='+' || tokens[i]==='-') { const op=tokens[i++], y=product(); x=op==='+'?x+y:x-y; }
    return x;
  }
  const result=sum();
  if (i!==tokens.length || !Number.isFinite(result)) throw Error('invalid');
  return Number(result.toPrecision(12));
}
function registerWebMCP() {
  const ctx = document.modelContext;
  if (!ctx?.registerTool) return;
  const tools = [
    {
      name:'read_practice_state', title:'查看练习状态',
      description:'查看当前模式、章节、题目和复习进度；不改变答题内容。',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      annotations:{readOnlyHint:true,untrustedContentHint:false},
      execute(input) {
        if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length) throw Error('输入须为空对象');
        return {screen:selectionOpen?'subject_picker':'practice',mode:session.mode,chapter:session.mode==='learn'?chapterIndex+1:null,questionIndex:session.items.length?session.index+1:null,total:session.items.length,wrongCount:wrongCount(),finished:session.finished};
      }
    },
    {
      name:'open_accounting_practice', title:'进入会计练习',
      description:'从科目选择页进入已经开放的会计题库，保留当前作答进度。',
      inputSchema:{type:'object',properties:{},additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input) {
        if (!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length) throw Error('输入须为空对象');
        openAccounting();
        return {screen:'practice',subject:'会计',mode:session.mode,questionIndex:session.index+1};
      }
    },
    {
      name:'start_chapter_practice', title:'开始章节练习',
      description:'打开指定的会计章节，显示该章第 1 道题。',
      inputSchema:{type:'object',properties:{chapter:{type:'integer',minimum:1,maximum:30}},required:['chapter'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input) {
        if (!input || !Number.isInteger(input.chapter) || input.chapter<1 || input.chapter>30 || Object.keys(input).some(k=>k!=='chapter')) throw Error('chapter 必须是 1 到 30 的整数');
        openAccounting();
        startChapter(input.chapter-1);
        return {mode:'learn',chapter:input.chapter,title:chapters[input.chapter-1].title,questionCount:session.items.length};
      }
    },
    {
      name:'navigate_practice_question', title:'跳转试题',
      description:'在当前练习中跳到指定题号，和点击左侧题号相同。',
      inputSchema:{type:'object',properties:{number:{type:'integer',minimum:1}},required:['number'],additionalProperties:false},
      annotations:{readOnlyHint:false,untrustedContentHint:false},
      execute(input) {
        if (!input || !Number.isInteger(input.number) || input.number<1 || input.number>session.items.length || Object.keys(input).some(k=>k!=='number')) throw Error('题号超出当前练习范围');
        openAccounting();
        navigate(input.number-1);
        return {number:input.number,id:current().id,type:current().type};
      }
    }
  ];
  for (const tool of tools) {
    try { Promise.resolve(ctx.registerTool(tool)).catch(() => {}); }
    catch { /* No supported WebMCP context. */ }
  }
}
const basicGroup = el('optgroup');
basicGroup.label = '基础理论（第 1—3 章）';
const otherGroup = el('optgroup');
otherGroup.label = '其余章节';
chapters.forEach((ch,i) => {
  const option = el('option','',String(i+1).padStart(2,'0')+' · '+ch.title+'（'+ch.items.length+' 题）');
  option.value = String(i);
  (i < 3 ? basicGroup : otherGroup).append(option);
});
$('chapterSelect').append(basicGroup,otherGroup);
$('accountingSummary').textContent = '已开放 · '+chapters.length+' 章 / '+questions.length+' 题';
$('shuffleOptions').checked = data.shuffle;
$('chooseAccounting').onclick = openAccounting;
$('changeSubject').onclick = showSubjectPicker;
$('chapterSelect').onchange = e => startChapter(Number(e.target.value));
$('sectionSelect').onchange = e => startChapter(chapterIndex,e.target.value);
$('shuffleOptions').onchange = e => {
  data.shuffle = e.target.checked;
  save();
  if (session.items.length) {
    session.items.forEach(q => {
      if (q.options && !answerFor(q).submitted && !session.finished) session.orders[q.id]=data.shuffle?shuffle(q.options.map((_,i)=>i)):q.options.map((_,i)=>i);
    });
  }
  render();
};
$('modeLearn').onclick = () => startChapter(chapterIndex);
$('modeMock').onclick = startMock;
$('modeWrong').onclick = startWrong;
$('prevBtn').onclick = () => navigate(session.index-1);
$('nextBtn').onclick = () => navigate(session.index+1);
$('submitBtn').onclick = submitAnswer;
$('finishBtn').onclick = () => {
  if (session.finished) { session.showResult = true; render(); }
  else finishMock(false);
};
$('markBtn').onclick = () => {
  const q = current();
  if (!q) return;
  data.marks = data.marks.includes(q.id) ? data.marks.filter(id => id!==q.id) : [...data.marks,q.id];
  save(); render();
};
$('fontDown').onclick = () => { fontSize=Math.max(.85,fontSize-.1); $('paper').style.setProperty('--question-size',fontSize+'rem'); };
$('fontUp').onclick = () => { fontSize=Math.min(1.4,fontSize+.1); $('paper').style.setProperty('--question-size',fontSize+'rem'); };
$('helpBtn').onclick = showHelp;
$('calculatorBtn').onclick = showCalculator;
$('modalClose').onclick = closeModal;
$('modal').onclick = e => { if (e.target === $('modal')) closeModal(); };
$('mobileNav').onclick = () => { $('sidebar').classList.add('open'); $('sideScrim').hidden=false; };
$('sideScrim').onclick = closeDrawer;
$('toggleSidebar').onclick = () => {
  if (matchMedia('(max-width:700px)').matches) closeDrawer();
  else {
    const collapsed = $('sidebar').classList.toggle('is-collapsed');
    $('toggleSidebar').textContent = collapsed?'展开':'收起';
  }
};
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); else closeDrawer(); }
  if (selectionOpen) return;
  if (!$('modal').hidden || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  if (typeof e.target?.closest === 'function' && e.target.closest('textarea, input, select, [contenteditable="true"], [role="textbox"]')) return;
  if (['ArrowUp','ArrowLeft','ArrowDown','ArrowRight'].includes(e.key) && session.items.length) {
    e.preventDefault();
    navigate(session.index + (e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 1));
    return;
  }
  if (['1','2','3','4'].includes(e.key) && current()?.options) {
    const canonical = session.orders[current().id][Number(e.key)-1];
    if (canonical!==undefined) selectChoice(current(),canonical);
  }
});
startChapter(0);
registerWebMCP();
