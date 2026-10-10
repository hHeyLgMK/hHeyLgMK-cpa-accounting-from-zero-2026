import {chapters as accountingChapters, questions as accountingQuestions} from './questions.js';
import {extraSubjects} from './extra-subjects.js';
import {strategySubject} from './strategy.js';
import {questionNumbers} from './question-numbers.js';
import {createPeerSync} from './peer-sync.js';
const accountingModules = [['基础理论',[1,2,3]],['资产与投资',[4,5,6,7,15]],['负债与权益',[8,9,10,11,12,16]],['金融工具与租赁',[13,14]],['收入与特殊交易',[17,18,19,20,21,22]],['报告与会计变更',[23,24,25]],['合并与计量',[26,27,28,29]],['政府与非营利会计',[30]]];
const subjects = {accounting:{name:'会计',chapters:accountingChapters,questions:accountingQuestions,modules:accountingModules},...extraSubjects,strategy:strategySubject};
let subjectId='accounting';
let chapters=accountingChapters, questions=accountingQuestions;
const subjectSessions=new Map();
let peerSync=null;
let appMenuOpen=false;
let appMenuReturnFocus=null;

const $ = id => document.getElementById(id);
const typeName = {single:'单项选择题', multi:'多项选择题', written:'简答与应用题'};
const letters = ['A','B','C','D'];
const storageKey = 'cpa-accounting-zero-v1';
// GitHub latest cpa-practice-sessions-v1 compatible per-subject resume support.
const progressKey = 'cpa-practice-sessions-v1';
function writeProgress(storage, key, active, previousSubjects) {
  const states = new Map(previousSubjects);
  states.set(active.subjectId, active);
  const sessions = {};
  for (const [id, state] of states) {
    const s = state.session;
    if (!s) continue;
    sessions[id] = {
      id:s.id, startedAt:s.startedAt,
      chapterIndex:state.chapterIndex, sectionName:state.sectionName,
      mode:s.mode, ids:s.items.map(q => q.id), index:s.index,
      answers:s.answers, orders:s.orders,
      finished:s.finished, showResult:s.showResult, seconds:s.seconds
    };
  }
  storage.setItem(key, JSON.stringify({version:1, subjectId:active.subjectId,
    selectionOpen:active.selectionOpen, fontSize:active.fontSize, sessions}));
}
function readProgress(storage, key, subjects) {
  let saved;
  try { saved = JSON.parse(storage.getItem(key) || 'null'); } catch { return null; }
  if (!saved || saved.version !== 1 || !subjects[saved.subjectId] ||
      !saved.sessions || typeof saved.sessions !== 'object') return null;
  const states = new Map();
  for (const [id, value] of Object.entries(saved.sessions)) {
    const subject = subjects[id];
    if (!subject || !value || !['learn','mock','wrong'].includes(value.mode) ||
        !Number.isInteger(value.chapterIndex) || value.chapterIndex < 0 ||
        value.chapterIndex >= subject.chapters.length || !Array.isArray(value.ids) ||
        new Set(value.ids).size !== value.ids.length) continue;
    const byId = new Map(subject.questions.map(q => [q.id,q]));
    const items = value.ids.map(id => byId.get(id));
    if (items.some(q => !q) || (!items.length && value.mode !== 'wrong')) continue;
    const sections = [...new Set(subject.questions.filter(q => q.chapterIndex === value.chapterIndex)
      .map(q => q.studySection || q.source?.section).filter(Boolean))];
    const sectionName = value.sectionName === '__all__' || sections.includes(value.sectionName)
      ? value.sectionName : sections[0] || '__all__';
    if (value.mode === 'learn' && items.some(q => q.chapterIndex !== value.chapterIndex ||
        (sectionName !== '__all__' && (q.studySection || q.source?.section) !== sectionName))) continue;
    const answers = {}, orders = {};
    const finished = ['learn','mock'].includes(value.mode) && value.finished === true;
    for (const q of items) {
      const order = value.orders?.[q.id];
      if (q.options) {
        const natural = q.options.map((_,i) => i);
        orders[q.id] = Array.isArray(order) && order.length === natural.length &&
          new Set(order).size === natural.length && order.every(i => Number.isInteger(i) && natural.includes(i))
          ? order.slice() : natural;
      }
      const a = value.answers?.[q.id];
      if (!a || typeof a !== 'object') continue;
      const choices = Array.isArray(a.choices) ? [...new Set(a.choices.filter(i =>
        Number.isInteger(i) && i >= 0 && i < (q.options?.length || 0)))] : [];
      const submitted = a.submitted === true;
      answers[q.id] = {choices:q.type === 'single' ? choices.slice(0,1) : choices,
        text:typeof a.text === 'string' ? a.text : '', submitted,
        judged:typeof a.judged === 'boolean' ? a.judged : null,
        recorded:a.recorded === true && (submitted || finished)};
    }
    const session = {mode:value.mode, items,
      id:typeof value.id === 'string' ? value.id : undefined,
      startedAt:typeof value.startedAt === 'string' ? value.startedAt : undefined,
      index:Number.isInteger(value.index) ? Math.max(0,Math.min(value.index,items.length-1)) : 0,
      answers, orders, finished, showResult:finished && value.showResult === true,
      seconds:Number.isFinite(value.seconds) ? Math.max(0,Math.min(2700,Math.floor(value.seconds))) : 2700};
    states.set(id, {session, chapterIndex:value.chapterIndex, sectionName});
  }
  if (!states.has(saved.subjectId)) return null;
  return {subjectId:saved.subjectId, selectionOpen:saved.selectionOpen === true,
    fontSize:Number.isFinite(saved.fontSize) ? Math.max(.85,Math.min(1.4,saved.fontSize)) : 1, states};
}
function saveProgress() {
  if (!session) return;
  try {
    writeProgress(localStorage,progressKey,
      {subjectId,chapterIndex,sectionName,session,selectionOpen,fontSize},subjectSessions);
    const status=$('progressStatus');
    if (status) status.textContent = '已保存当前作答，退出后可继续';
  } catch {
    const status=$('progressStatus');
    if (status) status.textContent = '存储不可用，当前进度无法保存';
  }
}
function restorePractice() {
  const saved = readProgress(localStorage,progressKey,subjects);
  if (!saved) return false;
  subjectSessions.clear();
  for (const [id,state] of saved.states) {
    state.session.marked = new Set(data.marks);
    state.session.id ||= Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9);
    state.session.startedAt ||= new Date().toISOString();
    subjectSessions.set(id,state);
  }
  const active = subjectSessions.get(saved.subjectId);
  subjectId=saved.subjectId;
  ({chapters,questions}=subjects[subjectId]);
  byId=new Map(questions.map(q=>[q.id,q]));
  ({session,chapterIndex,sectionName}=active);
  fontSize=saved.fontSize;
  populateChapters();
  populateSections();
  startTimer();
  render();
  openSubject(subjectId);
  if (saved.selectionOpen) showSubjectPicker();
  const paper=$('paper');
  if (paper) paper.style.setProperty('--question-size',fontSize+'rem');
  saveProgress();
  return true;
}

const defaultData = {records:{}, marks:[], shuffle:false, history:[], sync:null};
let data;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
  data = saved && typeof saved === 'object' ? {
    records:saved.records && typeof saved.records === 'object' ? saved.records : {},
    marks:Array.isArray(saved.marks) ? saved.marks : [],
    shuffle:Boolean(saved.shuffle),
    history:Array.isArray(saved.history) ? saved.history : [],
    sync:saved.sync && typeof saved.sync === 'object' ? saved.sync : null
  } : defaultData;
} catch { data = defaultData; }
function uniqueId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,12);
}
const deviceKey = 'cpa-practice-device-v1';
let deviceId;
try {
  deviceId = localStorage.getItem(deviceKey) || uniqueId();
  localStorage.setItem(deviceKey,deviceId);
} catch { deviceId = uniqueId(); }
if (!data.sync || !data.sync.bases || !Array.isArray(data.sync.events)) {
  data.sync = {bases:{[uniqueId()]:JSON.parse(JSON.stringify(data.records))},events:[]};
}
let chapterIndex = 0;
let sectionName = null;
let session;
let fontSize = 1;
let timerHandle = null;
let modalReturnFocus = null;
let selectionOpen = true;
let byId = new Map(questions.map(q => [q.id,q]));
function numberFor(q) { return questionNumbers[subjectId]?.[q.id] || q.id; }

function save() {
  try { localStorage.setItem(storageKey, JSON.stringify(data)); saveProgress(); return true; }
  catch { return false; }
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
  session = {id:Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9), startedAt:new Date().toISOString(), mode, items, index:0, answers:{}, orders, marked:new Set(data.marks), finished:false, showResult:false, seconds:45*60};
  startTimer();
  closeDrawer();
  render();
  saveProgress();
}
function startTimer() {
  if (timerHandle) clearInterval(timerHandle);
  if (session.mode === 'mock') {
    timerHandle = setInterval(() => {
      if (selectionOpen || session.mode !== 'mock' || session.finished) return;
      session.seconds--;
      updateTimer();
      if (session.seconds <= 0) finishMock(true);
      else saveProgress();
    }, 1000);
  }
}
function chapterSections(index) {
  return [...new Set(questions.filter(q => q.chapterIndex === index).map(q => q.studySection || q.source?.section).filter(Boolean))];
}
function startChapter(index, requestedSection) {
  const previousSection = index === chapterIndex ? sectionName : null;
  chapterIndex = index;
  const sections = chapterSections(index);
  sectionName = requestedSection === undefined ? (previousSection && (previousSection === '__all__' || sections.includes(previousSection)) ? previousSection : (subjectId === 'accounting' ? sections[0] : '__all__') || '__all__') : requestedSection;
  if (sectionName !== '__all__' && !sections.includes(sectionName)) sectionName = sections[0] || '__all__';
  populateSections();
  makeSession('learn', questions.filter(q => q.chapterIndex === index && (sectionName === '__all__' || (q.studySection || q.source?.section) === sectionName)));
}
function populateSections() {
  const index=chapterIndex;
  const sections=chapterSections(index);
  const sectionSelect = $('sectionSelect');
  sectionSelect.replaceChildren();
  if (sections.length) {
    const all = el('option','','本章全部（'+chapters[chapterIndex].items.length+' 题）');
    all.value = '__all__';
    sectionSelect.append(all);
    sections.forEach(section => {
      const count = questions.filter(q => q.chapterIndex === index && (q.studySection || q.source?.section) === section).length;
      const option = el('option','',section+'（'+count+' 题）');
      option.value = section;
      sectionSelect.append(option);
    });
    sectionSelect.value = sectionName;
  }
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
  // The same resumed session/question has one outcome on every device.
  const eventId='session:'+session.id+':'+q.id;
  if (data.sync.events.some(event=>event.id===eventId)) { answer.recorded=true;save();return; }
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
  data.sync.events.push({id:eventId,question:q.id,correct,at:new Date().toISOString()});
  save();
}
function historyEntry() {
  let entry = data.history.find(item => item.id === session.id);
  if (!entry) {
    entry = {id:session.id, startedAt:session.startedAt, finishedAt:null,
      subject:subjectId, mode:session.mode,
      chapter:session.mode === 'learn' ? chapters[chapterIndex]?.title : null,
      section:session.mode === 'learn' && sectionName !== '__all__' ? sectionName : null,
      total:session.items.length, items:[]};
    data.history.unshift(entry);
    trimHistory();
  }
  return entry;
}
function trimHistory() {
  let total = data.history.reduce((n,record) => n + record.items.length,0);
  while (data.history.length > 200 || (total > 10000 && data.history.length > 1)) {
    total -= data.history[data.history.length-1].items.length;
    data.history.pop();
  }
}
function normalizedRecord(value) {
  if (!value || typeof value !== 'object' || !Number.isSafeInteger(value.attempts) ||
      !Number.isSafeInteger(value.correct) || value.attempts < 0 || value.attempts > 10000000 ||
      value.correct < 0 || value.correct > value.attempts || typeof value.wrong !== 'boolean') throw Error('答题统计格式不正确');
  return {attempts:value.attempts,correct:value.correct,wrong:value.wrong,
    streak:Number.isSafeInteger(value.streak) && value.streak >= 0 && value.streak <= 3 ? value.streak : 0};
}
function normalizeBackup(text) {
  if (text.length > 25000000) throw Error('备份文件超过 25 MB');
  let backup;
  try { backup = JSON.parse(text); } catch { throw Error('不是有效的 JSON 备份'); }
  if (backup?.app !== 'CPA刷题库' || backup?.formatVersion !== 1 || !backup.data ||
      !backup.data.sync || !Array.isArray(backup.data.sync.events) ||
      !backup.data.sync.bases || typeof backup.data.sync.bases !== 'object' ||
      !Array.isArray(backup.data.history) || !Array.isArray(backup.data.marks)) throw Error('备份版本或内容不正确');
  const sync = {bases:Object.create(null),events:[]};
  const bases = Object.entries(backup.data.sync.bases);
  if (bases.length > 1000 || backup.data.sync.events.length > 100000 || backup.data.history.length > 2000) throw Error('备份记录超出支持范围');
  for (const [id,records] of bases) {
    if (!id || id.length > 120 || !records || typeof records !== 'object' || Array.isArray(records) || Object.keys(records).length > 10000) throw Error('统计基线格式不正确');
    const normalized = Object.create(null);
    for (const [qid,record] of Object.entries(records)) {
      if (!qid || qid.length > 150) throw Error('题目编号不正确');
      normalized[qid] = normalizedRecord(record);
    }
    sync.bases[id] = normalized;
  }
  for (const event of backup.data.sync.events) {
    if (!event || typeof event.id !== 'string' || !event.id || event.id.length > 150 ||
        typeof event.question !== 'string' || !event.question || event.question.length > 150 ||
        typeof event.correct !== 'boolean' || typeof event.at !== 'string' ||
        !Number.isFinite(Date.parse(event.at))) throw Error('答题事件格式不正确');
    sync.events.push({id:event.id,question:event.question,correct:event.correct,at:event.at});
  }
  const history = [];
  for (const entry of backup.data.history) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 150 ||
        typeof entry.startedAt !== 'string' || !Number.isFinite(Date.parse(entry.startedAt)) ||
        typeof entry.subject !== 'string' || entry.subject.length > 30 ||
        !['learn','mock','wrong'].includes(entry.mode) ||
        !Number.isSafeInteger(entry.total) || entry.total < 0 || entry.total > 10000 ||
        !Array.isArray(entry.items) || entry.items.length > 10000) throw Error('练习历史格式不正确');
    const items = entry.items.map(item => {
      if (!item || typeof item.id !== 'string' || !item.id || item.id.length > 150 ||
          !['single','multi','written'].includes(item.type) ||
          !Array.isArray(item.choices) || item.choices.length > 4 ||
          !item.choices.every(n => Number.isInteger(n) && n >= 0 && n < 4) ||
          typeof item.text !== 'string' || item.text.length > 20000 ||
          (item.correct !== null && typeof item.correct !== 'boolean')) throw Error('历史答案格式不正确');
      return {id:item.id,number:String(item.number || item.id).slice(0,150),type:item.type,
        choices:item.choices.slice(),text:item.text,submitted:Boolean(item.submitted),correct:item.correct,
        at:typeof item.at === 'string' && Number.isFinite(Date.parse(item.at)) ? item.at : entry.startedAt};
    });
    history.push({id:entry.id,startedAt:entry.startedAt,
      finishedAt:typeof entry.finishedAt === 'string' && Number.isFinite(Date.parse(entry.finishedAt)) ? entry.finishedAt : null,
      subject:entry.subject,mode:entry.mode,chapter:String(entry.chapter || '').slice(0,200) || null,
      section:String(entry.section || '').slice(0,200) || null,total:entry.total,items});
  }
  if (backup.data.marks.length > 10000 || !backup.data.marks.every(id => typeof id === 'string' && id.length <= 150)) throw Error('标记题目格式不正确');
  return {sync,history,marks:backup.data.marks};
}
function rebuildRecords(sync) {
  const result = Object.create(null);
  for (const baseline of Object.values(sync.bases)) {
    for (const [id,old] of Object.entries(baseline)) {
      const record = result[id] || (result[id] = {attempts:0,correct:0,wrong:false,streak:0});
      record.attempts += old.attempts;
      record.correct += old.correct;
      if (old.wrong) { record.wrong = true; record.streak = Math.max(record.streak,old.streak); }
    }
  }
  for (const event of sync.events.slice().sort((a,b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id))) {
    const record = result[event.question] || (result[event.question] = {attempts:0,correct:0,wrong:false,streak:0});
    record.attempts++;
    if (event.correct) {
      record.correct++;
      if (record.wrong && ++record.streak >= 3) { record.wrong = false; record.streak = 0; }
    } else { record.wrong = true; record.streak = 0; }
  }
  return result;
}
function mergeProgress(incoming) {
  const sync = {bases:Object.assign(Object.create(null),data.sync.bases,incoming.sync.bases),events:[]};
  const events = new Map();
  for (const event of [...data.sync.events,...incoming.sync.events]) {
    const old=events.get(event.id);
    if (!old || event.at < old.at || (event.at === old.at && Number(event.correct)<Number(old.correct))) events.set(event.id,event);
  }
  sync.events = [...events.values()];
  const entries = new Map();
  for (const entry of [...data.history,...incoming.history]) {
    const existing = entries.get(entry.id);
    if (!existing) { entries.set(entry.id,{...entry,items:entry.items.slice()}); continue; }
    const items = new Map(existing.items.map(item => [item.id,item]));
    for (const item of entry.items) {
      const old = items.get(item.id);
      if (!old || item.at >= old.at) items.set(item.id,item);
    }
    existing.items = [...items.values()];
    if (entry.finishedAt && (!existing.finishedAt || entry.finishedAt > existing.finishedAt)) existing.finishedAt = entry.finishedAt;
  }
  const history = [...entries.values()].sort((a,b) => b.startedAt.localeCompare(a.startedAt));
  const next = {...data,records:rebuildRecords(sync),marks:[...new Set([...data.marks,...incoming.marks])],history,sync};
  let total = next.history.reduce((n,entry) => n + entry.items.length,0);
  while (next.history.length > 200 || (total > 10000 && next.history.length > 1)) total -= next.history.pop().items.length;
  try { localStorage.setItem(storageKey,JSON.stringify(next)); }
  catch { throw Error('设备存储空间不足，导入未生效；请先保留备份文件'); }
  data = next;
  render();
  return {sessions:next.history.length,attempts:sync.events.length};
}
function exportProgress() {
  return JSON.stringify({app:'CPA刷题库',formatVersion:1,exportedAt:new Date().toISOString(),
    data:{records:data.records,marks:data.marks,history:data.history,sync:data.sync}});
}
function rememberAnswer(q, a) {
  const entry = historyEntry();
  const snapshot = {id:q.id, number:numberFor(q), type:q.type,
    choices:a.choices.slice(), text:q.type === 'written' ? a.text : '',
    submitted:a.submitted, correct:q.type === 'written' ? a.judged : chosenCorrect(q,a),
    at:new Date().toISOString()};
  const index = entry.items.findIndex(item => item.id === q.id);
  if (index < 0) entry.items.push(snapshot);
  else entry.items[index] = snapshot;
  trimHistory();
  save();
}
function completeHistory() {
  const entry = historyEntry();
  entry.finishedAt = new Date().toISOString();
  save();
}
function selectChoice(q, canonical) {
  if (session.finished || answerFor(q).submitted) return;
  const a = answerFor(q);
  if (q.type === 'single') a.choices = [canonical];
  else a.choices = a.choices.includes(canonical) ? a.choices.filter(i => i !== canonical) : [...a.choices,canonical];
  saveProgress();
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
  rememberAnswer(q,a);
  render();
}
function gradeWritten(isCorrect) {
  const q = current();
  if (!q || q.type !== 'written') return;
  const a = answerFor(q);
  if ((!a.submitted && !session.finished) || !a.text.trim()) return;
  if (a.judged !== null) return;
  a.judged = isCorrect;
  recordOutcome(q, isCorrect, a);
  rememberAnswer(q,a);
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
    if (q.type !== 'written' || a.text.trim()) {
      a.submitted = true;
      rememberAnswer(q,a);
    }
  });
  completeHistory();
  render();
}
function finishLearning(confirmed) {
  if (session.mode !== 'learn' || session.finished) return;
  const unanswered = session.items.filter(q => {
    const a = answerFor(q);
    return q.type === 'written' ? !a.text.trim() : !a.choices.length;
  }).length;
  if (!confirmed) {
    openModal('提交本组练习', body => {
      body.append(el('p','',unanswered
        ? '本组还有 '+unanswered+' 题未填写。已作答题目会一起提交；未答题不会计入错题。提交后不能修改答案。'
        : '本组题目已填写。提交后会显示客观题结果；简答题需要对照参考答案自行评价。'));
      const row = el('div','self-grade');
      const yes = el('button','','确认提交');
      const cancel = el('button','no','继续作答');
      yes.onclick = () => { closeModal(); finishLearning(true); };
      cancel.onclick = closeModal;
      row.append(yes,cancel);
      body.append(row);
    });
    return;
  }
  session.finished = true;
  session.showResult = true;
  session.items.forEach(q => {
    const a = answerFor(q);
    const answered = q.type === 'written' ? Boolean(a.text.trim()) : a.choices.length > 0;
    if (!answered) return;
    a.submitted = true;
    if (q.type !== 'written') recordOutcome(q, chosenCorrect(q,a), a);
    rememberAnswer(q,a);
  });
  completeHistory();
  render();
}
function navigate(i) {
  if (i < 0 || i >= session.items.length) return;
  session.index = i;
  session.showResult = false;
  closeDrawer();
  render();
  saveProgress();
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
      const chip = el('button',classes.join(' '),numberFor(q));
      chip.type = 'button';
      chip.title = '第 '+(i+1)+' 题 · '+numberFor(q)+' · '+q.chapterTitle;
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
  box.append(el('div','question-head', '第 '+(session.index+1)+' / '+session.items.length+' 题 · 编号 '+numberFor(q)+' · '+typeName[q.type]+' · '+q.level));
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
    textarea.addEventListener('input', e => { a.text = e.target.value; saveProgress(); });
    box.append(textarea);
    box.append(el('p','writing-hint','简答题需自行对照参考答案评分；模拟模式交卷后显示参考答案。'));
  }
  renderFeedback(q,a);
}
function sourceLabel(q) {
  if (!q.source) return '';
  const {book, chapter, section, printedPage, pdfPage, note} = q.source;
  const location = [book, chapter, section].filter(Boolean).join(' · ');
  const pages = [printedPage ? '教材第 '+printedPage+' 页' : '', pdfPage ? 'PDF 第 '+pdfPage+' 页' : ''].filter(Boolean).join(' / ');
  return [location, pages, note].filter(Boolean).join(' · ');
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
    if (a.judged === null && a.text.trim()) {
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
  if (q.source) {
    const line = el('p','source-line',(q.source.locationGranularity === 'official' ? '官方补充：' : q.source.locationGranularity === 'section' ? '教材阅读范围：' : '教材位置：')+sourceLabel(q));
    if (q.source.url) {
      const link = el('a','','查看官方原文');
      link.href=q.source.url;link.target='_blank';link.rel='noopener noreferrer';
      line.append(document.createTextNode(' '),link);
    }
    panel.append(line);
  }
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
  const answeredObjective = objective.filter(q => answerFor(q).choices.length);
  const correct = answeredObjective.filter(q => chosenCorrect(q,answerFor(q))).length;
  const learning = session.mode === 'learn';
  box.append(el('h2','',learning?'本组练习已提交':'模拟练习完成'));
  box.append(el('p','score',learning
    ? '客观题已答 '+answeredObjective.length+' / '+objective.length+'，正确 '+correct+' 题'
    : '客观题 '+correct+' / '+objective.length+' 题正确'));
  if (learning) {
    const written = session.items.filter(q => q.type === 'written');
    box.append(el('p','','简答题已提交 '+written.filter(q => answerFor(q).text.trim()).length+' / '+written.length+' 题；点击题号查看参考答案并自评。未答题不计入错题。'));
  } else {
    box.append(el('p','','本套题从原创入门题库抽取，练习时长 45 分钟；不是中注协官方试卷，也不代表真实考试分数。'));
    box.append(el('p','','简答与应用题需点击题号，对照参考答案自行评价。错题会进入错题复习。'));
  }
  const row = el('div','self-grade');
  const review = el('button','','从第 1 题查看解析');
  const again = el('button','',learning?'重新练习本组':'重新抽题');
  const learn = el('button','',learning?'练习本章全部':'返回章节学习');
  review.onclick = () => navigate(0);
  again.onclick = learning ? () => startChapter(chapterIndex,sectionName) : startMock;
  learn.onclick = learning ? () => startChapter(chapterIndex,'__all__') : () => startChapter(chapterIndex);
  row.append(review,again,learn);
  box.append(row);
  const list = el('div','result-list');
  session.items.forEach((q,i) => {
    const a = answerFor(q);
    const answered = q.type === 'written' ? Boolean(a.text.trim()) : a.choices.length > 0;
    const label = learning && !answered ? '未答'
      : q.type === 'written' ? (a.judged === null?'待自评':a.judged?'已掌握':'需复习')
      : chosenCorrect(q,a)?'正确':'错误';
    const item = el('button','result-item');
    item.type = 'button';
    item.append(el('strong','',numberFor(q)+' · '+typeName[q.type]+' · '+label),el('span','',q.stem));
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
  if (session.mode === 'learn' && chapters[chapterIndex].coverage) {
    const c=chapters[chapterIndex].coverage;
    $('chapterNote').textContent += ' 本章 '+c.sections+' 节均有练习，清单列出 '+c.points+' 个知识点条目。';
  }
  renderNav();
  const q = current();
  $('questionType').textContent = session.mode === 'learn' ? (subjects[subjectId].modules.find(m=>m[1].includes(chapterIndex+1))?.[0]+' · 零基础')
    : session.mode === 'mock' ? '机考模拟 · 原创练习' : '错题复习 · 巩固';
  $('sessionTitle').textContent = session.mode === 'learn' ? '第 '+(chapterIndex+1)+' 章 · '+chapters[chapterIndex].title+(sectionName === '__all__' ? '' : ' · '+sectionName)
    : session.mode === 'mock' ? subjects[subjectId].name+' · 模拟练习' : subjects[subjectId].name+' · 错题复习';
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
  $('submitBtn').hidden = isResult || !q || session.mode === 'mock' || session.finished || Boolean(q && answerFor(q).submitted);
  $('finishBtn').hidden = (session.mode !== 'mock' && session.mode !== 'learn') || isResult || !q;
  $('finishBtn').textContent = session.finished ? '查看结果' : session.mode === 'learn' ? '提交本组' : '交卷';
  $('prevBtn').disabled = !q || session.index === 0;
  $('nextBtn').disabled = !q || session.index === session.items.length-1;
  $('toolTip').textContent = session.mode === 'mock' ? '答案自动保留，点击“交卷”查看解析'
    : session.mode === 'wrong' ? '连续答对 3 次可移出错题本'
    : session.finished ? '本组已提交，可逐题查看解析' : '可逐题提交，或全部写完后点击“提交本组”';
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
function historyDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN');
}
function historyTitle(entry) {
  const mode = {learn:'章节学习',mock:'机考模拟',wrong:'错题复习'}[entry.mode] || '练习';
  return [subjects[entry.subject]?.name || '原科目',mode,entry.chapter,entry.section].filter(Boolean).join(' · ');
}
function historySummary(entry) {
  const items = Array.isArray(entry.items) ? entry.items : [];
  const attempted = items.filter(item => item.type === 'written' ? item.text?.trim() : item.choices?.length).length;
  const objective = items.filter(item => item.type !== 'written' && item.choices?.length);
  const correct = objective.filter(item => item.correct === true).length;
  const pending = items.filter(item => item.type === 'written' && item.correct === null).length;
  return (entry.finishedAt ? '已完成' : '进行中')+' · 已答 '+attempted+' / '+entry.total+' · 客观题正确 '+correct+' / '+objective.length+(pending ? ' · 简答待自评 '+pending : '');
}
function showHistory() {
  openModal('练习历史', body => {
    body.append(el('p','history-note','按提交记录；逐题提交也会保存。最多保留最近 200 次且不超过 10000 道题，可导出备份转移到其他设备。'));
    const backup = el('button','history-back','导出 / 导入记录');
    backup.type = 'button'; backup.onclick = showBackup;
    body.append(backup);
    if (!data.history.length) {
      body.append(el('p','','暂无记录。提交一道题或完成一组练习后会显示在这里。'));
      return;
    }
    const list = el('div','history-list');
    data.history.forEach(entry => {
      const card = el('button','history-card');
      card.type = 'button';
      card.append(el('strong','',historyTitle(entry)),
        el('span','',historyDate(entry.finishedAt || entry.startedAt)),
        el('span','',historySummary(entry)));
      card.onclick = () => showHistoryDetail(entry.id);
      list.append(card);
    });
    body.append(list);
  });
}
function showBackup() {
  openModal('导出与导入记录', body => {
    body.append(el('p','history-note','手动同步：从一端导出备份，在另一端导入。重复导入会按记录编号去重；导入会合并历史、答题统计和标记题目。'));
    const status = el('p','backup-status','');
    status.setAttribute('role','status');
    const android = /Android/i.test(navigator.userAgent);
    const actions = el('div','backup-actions');
    const download = el('button','','下载 JSON 备份');
    download.type = 'button';
    download.onclick = () => {
      const blob = new Blob([exportProgress()],{type:'application/json;charset=utf-8'});
      const url = URL.createObjectURL(blob);
      const link = el('a');
      link.href = url; link.download = 'CPA刷题记录_'+new Date().toISOString().slice(0,10)+'.json';
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url),60000);
      status.textContent = '已请求保存备份文件。若安卓 APP 未显示保存窗口，请使用“分享或复制备份”。';
    };
    const transfer = el('button','','分享或复制备份');
    transfer.type = 'button';
    const pasted = el('textarea','backup-text');
    pasted.placeholder = '也可将另一台设备复制的完整备份文本粘贴到这里，再点“导入文本”。';
    pasted.setAttribute('aria-label','备份文本');
    transfer.onclick = async () => {
      const content = exportProgress();
      try {
        const file = new File([content],'CPA刷题记录_'+new Date().toISOString().slice(0,10)+'.json',{type:'application/json'});
        if (navigator.canShare?.({files:[file]}) && navigator.share) {
          await navigator.share({files:[file],title:'CPA刷题记录备份'});
          status.textContent = '已打开系统分享，请将备份文件发送到另一台设备。';
          return;
        }
      } catch (error) {
        if (error?.name === 'AbortError') { status.textContent = '已取消分享。'; return; }
      }
      pasted.value = content;
      pasted.focus(); pasted.select();
      try {
        let copied = false;
        if (navigator.clipboard?.writeText) {
          try { await navigator.clipboard.writeText(content); copied = true; } catch { /* Try the selected text below. */ }
        }
        if (!copied && !document.execCommand('copy')) throw Error('copy unavailable');
        status.textContent = '已复制备份文本，可发送到另一台设备并粘贴导入。';
      } catch { status.textContent = '备份文本已显示在下方，请长按文本全选并复制。'; }
    };
    if (!android) actions.append(download);
    actions.append(transfer);
    body.append(actions);
    if (!android) {
      const fileLabel = el('label','backup-file-label','选择 JSON 备份文件');
      const picker = el('input');
      picker.type = 'file'; picker.accept = '.json,application/json';
      picker.onchange = async () => {
        const file = picker.files?.[0];
        if (!file) return;
        try {
          if (file.size > 25000000) throw Error('备份文件超过 25 MB');
          const result = mergeProgress(normalizeBackup(await file.text()));
          status.textContent = '导入完成：现有 '+result.sessions+' 次练习、'+result.attempts+' 条答题事件。';
        } catch (error) { status.textContent = '导入失败：'+error.message; }
        picker.value = '';
      };
      fileLabel.append(picker);
      body.append(fileLabel);
    }
    body.append(el('p','history-note',android
      ? '安卓 APP：使用“分享或复制备份”，在另一台设备粘贴文本导入。系统若支持文件分享，也可以把 JSON 文件发送到电脑。'
      : '电脑浏览器：可下载或选择 JSON 文件；也可复制、粘贴备份文本。'));
    const importButton = el('button','backup-import','导入文本并合并');
    importButton.type = 'button';
    importButton.onclick = () => {
      try {
        if (!pasted.value.trim()) throw Error('请先粘贴备份文本');
        const result = mergeProgress(normalizeBackup(pasted.value));
        pasted.value = '';
        status.textContent = '导入完成：现有 '+result.sessions+' 次练习、'+result.attempts+' 条答题事件。';
      } catch (error) { status.textContent = '导入失败：'+error.message; }
    };
    body.append(pasted,importButton,status);
  });
}
function showHistoryDetail(id) {
  const entry = data.history.find(item => item.id === id);
  if (!entry) return showHistory();
  openModal('练习详情', body => {
    const back = el('button','history-back','← 返回练习历史');
    back.type = 'button'; back.onclick = showHistory;
    body.append(back,el('h3','',historyTitle(entry)),
      el('p','history-note',historyDate(entry.startedAt)+' · '+historySummary(entry)));
    const lookup = new Map((subjects[entry.subject]?.questions || []).map(q => [q.id,q]));
    const list = el('div','history-list');
    (entry.items || []).forEach(item => {
      const q = lookup.get(item.id);
      const card = el('article','history-question');
      const answered = item.type === 'written' ? Boolean(item.text?.trim()) : Boolean(item.choices?.length);
      const status = !answered ? '未答' : item.correct === null ? '待自评' : item.correct ? '正确 / 已掌握' : '错误 / 需复习';
      card.append(el('strong','',(item.number || item.id)+' · '+(typeName[item.type] || '试题')+' · '+status));
      if (q) {
        card.append(el('p','',q.stem));
        if (item.type === 'written') {
          card.append(el('p','history-answer','我的作答：'+(item.text || '未填写')),
            el('p','history-answer','参考作答：'+(q.sample || '无')));
        } else {
          const format = indices => indices.length ? indices.map(i => letters[i]+'. '+(q.options?.[i] || '')).join('；') : '未选择';
          card.append(el('p','history-answer','我的答案：'+format(item.choices || [])),
            el('p','history-answer','正确答案：'+format(q.type === 'single' ? [q.answer] : q.answer || [])));
        }
        if (q.explain) card.append(el('p','history-explain','解析：'+q.explain));
      } else card.append(el('p','','此题已不在当前题库中，保留的答案记录仍可查看：'+(item.text || (item.choices || []).map(i => letters[i]).join('、') || '未答')));
      list.append(card);
    });
    if (!list.children.length) list.append(el('p','','本次练习尚未提交题目。'));
    body.append(list);
  });
}
function closeDrawer() {
  $('sidebar').classList.remove('open');
  $('sideScrim').hidden = true;
}
function openAppMenu() {
  closeDrawer();
  if (!$('modal').hidden) closeModal();
  appMenuReturnFocus=document.activeElement;
  appMenuOpen=true;
  $('appMenuContext').textContent=selectionOpen?'选择科目，开始练习':'当前科目 · '+subjects[subjectId].name;
  $('appMenu').inert=false;
  $('appMenu').setAttribute('aria-hidden','false');
  $('appMenu').classList.add('is-open');
  for (const id of ['subjectMenuTrigger','practiceMenuTrigger']) $(id).setAttribute('aria-expanded','true');
  document.body.classList.add('app-menu-open');
  $('practiceApp').inert=true;$('subjectPicker').inert=true;
  $('appMenuClose').focus();
}
function closeAppMenu() {
  if (!appMenuOpen) return;
  appMenuOpen=false;
  $('appMenu').classList.remove('is-open');
  $('appMenu').setAttribute('aria-hidden','true');
  $('appMenu').inert=true;
  for (const id of ['subjectMenuTrigger','practiceMenuTrigger']) $(id).setAttribute('aria-expanded','false');
  document.body.classList.remove('app-menu-open');
  $('practiceApp').inert=false;$('subjectPicker').inert=false;
  if (appMenuReturnFocus?.focus) appMenuReturnFocus.focus();
}
window.cpaCloseOverlay=()=>{
  if (appMenuOpen) {closeAppMenu();return true;}
  if (!$('modal').hidden) {closeModal();return true;}
  return false;
};
function openAccounting() { openSubject('accounting'); }
function openSubject(id) {
  saveProgress();
  if (id !== subjectId) {
    subjectSessions.set(subjectId,{session,chapterIndex,sectionName});
    subjectId=id;
    ({chapters,questions}=subjects[id]);
    byId=new Map(questions.map(q=>[q.id,q]));
    populateChapters();
    const previous=subjectSessions.get(id);
    if (previous) { ({session,chapterIndex,sectionName}=previous); populateSections(); startTimer(); render(); }
    else {chapterIndex=0;sectionName=null;startChapter(0);}
  }
  document.querySelector('.brand small').textContent='2026 教材 · '+subjects[id].name+'入门题库';
  document.querySelector('.candidate span').textContent=subjects[id].name+' · '+chapters.length+' 章';
  document.querySelector('.download-link').href=id==='accounting'?'./questions.csv':'./'+id+'-questions.csv';
  document.querySelector('.guide-link').href=id==='strategy'?'./strategy-guide.md':id==='tax'?'./tax-coverage-audit.md':'./study-guide.md';
  document.querySelector('.guide-link').textContent=id==='strategy'?'下载战略模块与知识节清单':id==='tax'?'下载税法覆盖核对表':'下载四科模块与知识点清单';
  document.querySelector('.coverage-link').href=id==='strategy'?'./strategy-coverage.csv':'./knowledge-points.csv';
  document.querySelector('.coverage-link').hidden=false;
  selectionOpen = false;
  $('subjectPicker').hidden = true;
  $('practiceApp').hidden = false;
  updateTimer();
  $('mode'+session.mode[0].toUpperCase()+session.mode.slice(1)).focus();
  saveProgress();
}
function showSubjectPicker() {
  if (!$('modal').hidden) closeModal();
  closeDrawer();
  selectionOpen = true;
  $('practiceApp').hidden = true;
  $('subjectPicker').hidden = false;
  $('chooseAccounting').focus();
  saveProgress();
}
function showHelp() {
  openModal('使用说明', body => {
    body.append(el('p','','当前科目：《'+subjects[subjectId].name+'》，'+chapters.length+' 章、'+questions.length+' 道原创练习题。学习模式可逐题提交，也可点击“提交本组”一次提交已作答题目；简答题对照参考答案自评。模拟练习交卷后看解析；错题连续答对 3 次移出。'));
    if (subjects[subjectId].coverage) {
      const c=subjects[subjectId].coverage;
      body.append(el('p','',c.coveredSections+' / '+c.sections+' 节已有题目，知识点清单列出 '+c.knowledgePoints+' 个条目（按节同名去重）。覆盖到每一节不等于穷尽全部细则、例外或综合考法。可下载模块与知识点清单核对。'));
      body.append(el('p','',subjectId==='strategy'?'战略起步题标注知识节阅读范围，扩充题标注知识点所在教材页。知识点与题号对应表列出实际题目，尚不能据此断言每条细则和综合考法均已覆盖。':subjectId==='tax'?'税法原有逐节题标注所属知识节阅读范围，本次补充题标注知识点所在教材页；扫描缺少印刷页 628—629，相关信用管理题单列官方来源。目录逐节覆盖不代表穷尽所有例外与综合考法。':'新增题标注所属知识节的教材和 PDF 阅读范围。'));
    }
    body.append(el('p','','入口页可以选择六个专业阶段科目。返回选科页时会保留本次作答，并暂停模拟练习计时。'));
    body.append(el('p','','键盘操作：↑ 或 ← 切换到上一题，↓ 或 → 切换到下一题；数字键 1～4 可选答案，回车提交当前答案。在简答输入框内，回车仍用于换行；模拟练习统一交卷。'));
    body.append(el('p','','布局和题号导航、标记、计算器、交卷操作参考官方机考模拟练习系统。本站为独立制作的学习工具，非中注协官方练习网站，题目不是真题。'));
    const p = el('p');
    const a = el('a','','打开中注协官方模拟练习网站');
    a.href = 'https://cpademo.joytest.org.cn/';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    p.append(a);
    body.append(p);
    body.append(el('p','','点击“练习历史”可查看答案与解析，并导出或导入记录以手动同步设备。记录保存在本设备；升级前累计的答题次数和错题状态会保留，但此前的逐次答案无法回溯。2027 年备考请在新版考试大纲发布后核对变化。'));
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
        return {subject:subjects[subjectId].name,screen:selectionOpen?'subject_picker':'practice',mode:session.mode,chapter:session.mode==='learn'?chapterIndex+1:null,questionIndex:session.items.length?session.index+1:null,total:session.items.length,wrongCount:wrongCount(),finished:session.finished};
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
        openSubject(subjectId);
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
function populateChapters() {
  $('chapterSelect').replaceChildren();
  subjects[subjectId].modules.forEach(([name,numbers])=>{
    const group=el('optgroup');group.label=name;
    numbers.forEach(n=>{const ch=chapters[n-1];const option=el('option','',String(n).padStart(2,'0')+' · '+ch.title+'（'+ch.items.length+' 题）');option.value=String(n-1);group.append(option);});
    $('chapterSelect').append(group);
  });
}
populateChapters();
for (const [id,subject] of Object.entries(subjects)) {
  const button=document.querySelector('[data-subject="'+id+'"]');
  button.querySelector('span').textContent='已开放 · '+subject.chapters.length+' 章 / '+subject.questions.length+' 题';
  button.onclick=()=>openSubject(id);
}
$('shuffleOptions').checked = data.shuffle;
$('chooseAccounting').onclick = openAccounting;
$('subjectMenuTrigger').onclick = openAppMenu;
$('practiceMenuTrigger').onclick = openAppMenu;
$('appMenuClose').onclick = closeAppMenu;
$('appMenuScrim').onclick = closeAppMenu;
$('changeSubject').onclick = () => {closeAppMenu();showSubjectPicker();};
$('historyBtn').onclick = () => {closeAppMenu();showHistory();};
$('deviceSyncBtn').onclick = () => {
  closeAppMenu();
  if (peerSync) peerSync.open();
  else openModal('设备同步',body=>body.append(el('p','','请使用配套 APK 或 Windows EXE 打开设备同步。')));
};
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
  saveProgress();
};
$('modeLearn').onclick = () => startChapter(chapterIndex);
$('modeMock').onclick = startMock;
$('modeWrong').onclick = startWrong;
$('prevBtn').onclick = () => navigate(session.index-1);
$('nextBtn').onclick = () => navigate(session.index+1);
$('submitBtn').onclick = submitAnswer;
$('finishBtn').onclick = () => {
  if (session.finished) { session.showResult = true; render(); saveProgress(); }
  else if (session.mode === 'learn') finishLearning(false);
  else finishMock(false);
};
$('markBtn').onclick = () => {
  const q = current();
  if (!q) return;
  data.marks = data.marks.includes(q.id) ? data.marks.filter(id => id!==q.id) : [...data.marks,q.id];
  save(); render();
};
$('fontDown').onclick = () => { fontSize=Math.max(.85,fontSize-.1); $('paper').style.setProperty('--question-size',fontSize+'rem'); saveProgress(); };
$('fontUp').onclick = () => { fontSize=Math.min(1.4,fontSize+.1); $('paper').style.setProperty('--question-size',fontSize+'rem'); saveProgress(); };
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
  if (appMenuOpen) {
    if (e.key === 'Escape') {e.preventDefault();closeAppMenu();return;}
    if (e.key === 'Tab') {
      const controls=[$('appMenuClose'),$('changeSubject'),$('historyBtn'),$('deviceSyncBtn')];
      const index=controls.indexOf(document.activeElement);
      if (e.shiftKey && index<=0) {e.preventDefault();controls[controls.length-1].focus();}
      else if (!e.shiftKey && (index===controls.length-1 || index<0)) {e.preventDefault();controls[0].focus();}
    }
    return;
  }
  if (e.key === 'Escape') { if (!$('modal').hidden) closeModal(); else closeDrawer(); }
  if (selectionOpen) return;
  if (!$('modal').hidden || e.defaultPrevented || e.isComposing || e.altKey || e.ctrlKey || e.metaKey) return;
  if (typeof e.target?.closest === 'function' && e.target.closest('textarea, input, select, [contenteditable="true"], [role="textbox"]')) return;
  if (e.key === 'Enter' && !e.shiftKey) {
    const control = e.target?.closest?.('button, a, [role="button"]');
    if (control && control.id !== 'submitBtn' && !control.classList?.contains('option')) return;
    if ($('submitBtn').hidden || $('submitBtn').disabled) return;
    e.preventDefault();
    if (!e.repeat) submitAnswer();
    return;
  }
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
document.addEventListener('visibilitychange', () => { if(document.hidden) saveProgress(); });
window.addEventListener('pagehide',saveProgress);
if (!restorePractice()) startChapter(0);
registerWebMCP();
peerSync=createPeerSync({
  bankId:'BANK_PLACEHOLDER',openModal,
  snapshot(){
    const backup=JSON.parse(exportProgress());delete backup.exportedAt;
    return {backup,progress:localStorage.getItem(progressKey),marks:data.marks,shuffle:data.shuffle};
  },
  validate(value){
    normalizeBackup(JSON.stringify(value.backup));
    if(!readProgress({getItem:()=>value.progress},progressKey,subjects))throw Error('同步练习进度无效');
  },
  merge(value,settings){
    mergeProgress(normalizeBackup(JSON.stringify(value.backup)));
    data.marks=settings.marks;data.shuffle=settings.shuffle;
    if(!save())throw Error('存储空间不足，无法保存同步结果');
    $('shuffleOptions').checked=data.shuffle;render();
  },
  apply(value){
    if(!readProgress({getItem:()=>value.progress},progressKey,subjects))throw Error('同步练习进度无效');
    localStorage.setItem(progressKey,value.progress);
    if(!restorePractice())throw Error('无法恢复同步进度');
  }
});
