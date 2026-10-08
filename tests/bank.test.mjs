import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {questions} from '../dist/questions.js';
import {extraSubjects} from '../dist/extra-subjects.js';
import {strategySubject} from '../dist/strategy.js';
import {questionNumbers} from '../dist/question-numbers.js';

const subjects={accounting:{questions},...extraSubjects,strategy:strategySubject};
const imported=JSON.parse(fs.readFileSync(new URL('../content/android-import.json',import.meta.url),'utf8'));
function stable(value) {
  return Array.isArray(value) ? value.map(stable) : value && typeof value==='object'
    ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])) : value;
}

test('all six subject banks retain the exact questions, answers and sources imported from the APK',()=>{
  assert.equal(Object.keys(subjects).length,6);
  let total=0;
  for(const [id,subject] of Object.entries(subjects)) {
    assert.equal(subject.questions.length,imported.questionCounts[id],id);
    const hash=createHash('sha256').update(JSON.stringify(stable(subject.questions))).digest('hex');
    assert.equal(hash,imported.questionDataSha256[id],id);
    total+=subject.questions.length;
  }
  assert.equal(total,4412);
});

test('each stable internal ID has one unique display number and valid answer indices',()=>{
  const ids=new Set(),numbers=new Set();
  for(const [id,subject] of Object.entries(subjects)) {
    assert.equal(Object.keys(questionNumbers[id]).length,subject.questions.length,id);
    for(const q of subject.questions) {
      assert.ok(!ids.has(q.id),q.id);ids.add(q.id);
      const number=questionNumbers[id][q.id];
      assert.match(number,/^(ACC|LAW|FIN|TAX|AUD|STR)-\d{5}$/);
      assert.ok(!numbers.has(number),number);numbers.add(number);
      if(q.type==='written') assert.ok(q.sample?.trim(),q.id);
      else {
        const indices=q.type==='single'?[q.answer]:q.answer;
        assert.ok(indices.length && indices.every(i=>Number.isInteger(i)&&i>=0&&i<q.options.length),q.id);
      }
    }
  }
});
