import fs from 'node:fs';
import {questions} from '../../dist/questions.js';
import {expandedAccountingQuestions} from '../../dist/accounting-expanded.js';

const fail = message => { throw new Error(message); };
if (questions.length !== 2331) fail(`总题量应为2331，实际${questions.length}`);
if (expandedAccountingQuestions.length !== 2051) fail(`扩展题应为2051，实际${expandedAccountingQuestions.length}`);
const ids = new Set();
const stems = new Set();
for (const q of questions) {
  if (ids.has(q.id)) fail(`题号重复：${q.id}`);
  ids.add(q.id);
  const stem = String(q.stem).trim();
  if (stems.has(stem)) fail(`题干重复：${q.id}`);
  stems.add(stem);
  if (q.source && q.source.pdfPage !== q.source.printedPage + 11) fail(`页码偏移错误：${q.id}`);
}
const chapterCounts = Object.fromEntries(Array.from({length:30},(_,i)=>i+1).map(n => [n,questions.filter(q=>q.chapterIndex===n-1).length]));
const csvRows = fs.readFileSync('../../dist/questions.csv','utf8').trimEnd().split(/\r?\n/).length;
const coverageRows = fs.readFileSync('../../dist/accounting-coverage.csv','utf8').trimEnd().split(/\r?\n/).length;
if (csvRows !== questions.length + 1) fail(`题库CSV行数错误：${csvRows}`);
if (coverageRows !== questions.filter(q=>q.source).length + 1) fail(`覆盖表行数错误：${coverageRows}`);
console.log(JSON.stringify({total:questions.length,expanded:expandedAccountingQuestions.length,uniqueIds:ids.size,uniqueStems:stems.size,csvRows,coverageRows,chapterCounts}));
