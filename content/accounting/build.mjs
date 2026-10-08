import {readFile, readdir, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {questionNumbers} from '../../dist/question-numbers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const dist = path.join(root, 'dist');
const allowPartial = process.argv.includes('--allow-partial');
const spans = {
  4:[66,88],5:[89,101],6:[102,143],7:[144,163],8:[164,177],9:[178,191],
  10:[192,211],11:[212,221],12:[222,234],13:[235,323],14:[324,354],
  15:[355,374],16:[375,387],17:[388,444],18:[445,458],19:[459,485],
  20:[486,500],21:[501,514],22:[515,525],23:[526,569],24:[570,589],
  25:[590,600],26:[601,636],27:[637,768],28:[769,782],29:[783,805],30:[806,869]
};
const modules = [
  ['基础理论',[1,2,3]],['资产与投资',[4,5,6,7,15]],
  ['负债与权益',[8,9,10,11,12,16]],['金融工具与租赁',[13,14]],
  ['收入与特殊交易',[17,18,19,20,21,22]],['报告与会计变更',[23,24,25]],
  ['合并与计量',[26,27,28,29]],['政府与非营利会计',[30]]
];
const expectedSectionCounts = {
  4:5,5:4,6:5,7:5,8:2,9:5,10:3,11:3,12:4,13:8,14:4,15:2,16:3,
  17:3,18:3,19:6,20:3,21:3,22:3,23:7,24:5,25:3,26:2,27:11,28:4,29:3,30:3
};
const moduleFor = chapter => modules.find(([,numbers]) => numbers.includes(chapter))?.[0] || '';
const fail = (id, message) => { throw new Error(`${id}: ${message}`); };
const trimmed = value => String(value ?? '').trim();
const questions = [];
const seenIds = new Set();
const seenStems = new Set();
const available = new Set(await readdir(here));
for (let n = 4; n <= 30; n++) {
  const name = `chapter${n}.json`;
  if (!available.has(name)) {
    if (!allowPartial) fail(name, '缺少章节题稿');
    continue;
  }
  const items = JSON.parse(await readFile(path.join(here,name), 'utf8'));
  if (!Array.isArray(items) || items.length < 15) fail(name, '至少需要 15 道逐点入门题');
  const sections = new Set();
  const normalizedItems = [];
  for (const [itemIndex,q] of items.entries()) {
    const id = q?.id || name;
    if (!new RegExp(`^CH${n}-\\d{3}$`).test(id)) fail(id, '题号格式应为 CH章号-三位序号');
    if (seenIds.has(id)) fail(id, '题号重复');
    seenIds.add(id);
    if (!/^第(?:\d+|[一二三四五六七八九十]+)章\s+/.test(trimmed(q.chapter))) fail(id, '章节名称格式不正确');
    for (const field of ['section','topic','stem','explanation']) if (!trimmed(q[field])) fail(id, `缺少 ${field}`);
    sections.add(trimmed(q.section));
    if (seenStems.has(trimmed(q.stem))) fail(id, '题干重复');
    seenStems.add(trimmed(q.stem));
    if (!Number.isInteger(q.printedPage) || q.printedPage < spans[n][0] || q.printedPage > spans[n][1]) fail(id, '教材页码超出本章');
    if (q.pdfPage !== q.printedPage + 11) fail(id, 'PDF 页码应为教材页码 + 11');
    if (q.type !== 'single') fail(id, '当前逐点题稿应为单选题');
    if (!Array.isArray(q.options) || q.options.length !== 4) fail(id, '需要四个选项');
    if (q.options.some((o,i) => o.key !== 'ABCD'[i] || !trimmed(o.text))) fail(id, '选项键或内容无效');
    if (new Set(q.options.map(o => trimmed(o.text))).size !== 4) fail(id, '选项内容重复');
    if (!'ABCD'.includes(q.answer) || trimmed(q.answer).length !== 1) fail(id, '答案必须为 A-D 之一');
    const correctText = q.options.find(option => option.key === q.answer).text;
    const desiredIndex = itemIndex % 4;
    const distractors = q.options.filter(option => option.key !== q.answer).map(option => option.text);
    const optionTexts = distractors.slice();
    optionTexts.splice(desiredIndex,0,correctText);
    const normalized = {...q,options:optionTexts.map((text,index)=>({key:'ABCD'[index],text})),answer:'ABCD'[desiredIndex]};
    normalizedItems.push(normalized);
    questions.push(normalized);
  }
  if (sections.size !== expectedSectionCounts[n]) fail(name, `教材应覆盖 ${expectedSectionCounts[n]} 节，当前为 ${sections.size} 节`);
  const answerCounts = Object.fromEntries('ABCD'.split('').map(key => [key,normalizedItems.filter(q => q.answer === key).length]));
  if (Math.max(...Object.values(answerCounts)) - Math.min(...Object.values(answerCounts)) > 1) fail(name, '正确答案位置未均衡');
  console.log(`第${n}章：${items.length}题，${sections.size}节，${new Set(items.map(q=>q.topic)).size}个知识点`);
}

await writeFile(path.join(dist,'accounting-expanded.js'), `export const expandedAccountingQuestions = ${JSON.stringify(questions,null,2)};\n`, 'utf8');
const {questions:all} = await import(pathToFileURL(path.join(dist,'questions.js')).href + '?build=' + Date.now());
const accounting = all;
const headers = ['题号','模块','章序','章节','题型','难度','题干','选项A','选项B','选项C','选项D','正确答案','参考作答','解析','知识点','教材章节','教材节','教材页','PDF页','原题号'];
const typeLabels = {single:'单选',multi:'多选',written:'简答'};
const csvQuote = value => `"${String(value ?? '').replaceAll('"','""')}"`;
const rows = accounting.map(q => {
  const answerIndices = q.type === 'single' ? [q.answer] : q.type === 'multi' ? q.answer : [];
  if (!questionNumbers.accounting[q.id]) fail(q.id, '请先补充统一题号映射');
  return [questionNumbers.accounting[q.id],moduleFor(q.chapterIndex+1),q.chapterIndex+1,q.chapterTitle,typeLabels[q.type],q.level,q.stem,
    ...Array.from({length:4}, (_,i) => q.options?.[i] ?? ''),
    answerIndices.map(i => 'ABCD'[i]).join('、'),q.sample || '',q.explain,q.knowledgePoint || '',
    q.source?.chapter || '',q.source?.section || '',q.source?.printedPage || '',q.source?.pdfPage || '',q.id];
});
await writeFile(path.join(dist,'questions.csv'), '\ufeff'+[headers,...rows].map(row=>row.map(csvQuote).join(',')).join('\n')+'\n','utf8');
const coverageHeaders = ['模块','章序','章节','教材节','知识点','题号','教材页','PDF页'];
const coverageRows = accounting.filter(q=>q.source).map(q=>[moduleFor(q.chapterIndex+1),q.chapterIndex+1,q.chapterTitle,q.source.section,q.knowledgePoint,q.id,q.source.printedPage,q.source.pdfPage]);
await writeFile(path.join(dist,'accounting-coverage.csv'), '\ufeff'+[coverageHeaders,...coverageRows].map(row=>row.map(csvQuote).join(',')).join('\n')+'\n','utf8');
console.log(JSON.stringify({total:accounting.length,expanded:questions.length,chapters:27,missing:[...Array(27)].map((_,i)=>i+4).filter(n=>!available.has(`chapter${n}.json`))}));
