import test from 'node:test';
import assert from 'node:assert/strict';
import {readProgress, writeProgress} from '../dist/progress.js';

const key = 'progress';
const items = [
  {id:'one',type:'single',chapterIndex:0,studySection:'一节',options:['A','B','C','D']},
  {id:'two',type:'multi',chapterIndex:0,studySection:'一节',options:['A','B','C','D']},
  {id:'three',type:'written',chapterIndex:0,studySection:'一节'}
];
const subjects = {accounting:{chapters:[{}],questions:items},law:{chapters:[{}],questions:items}};
function storage() {
  let text;
  return {getItem:() => text, setItem:(_,value) => {text=value;}};
}
function active(mode='learn') {
  return {subjectId:'accounting',chapterIndex:0,sectionName:'一节',selectionOpen:false,fontSize:1.2,
    session:{mode,items,index:2,seconds:1432,finished:false,showResult:false,
      orders:{one:[3,1,0,2],two:[2,3,1,0]}, answers:{
        one:{choices:[3],text:'',submitted:true,judged:null,recorded:true},
        two:{choices:[1,3],text:'',submitted:false,judged:null,recorded:false},
        three:{choices:[],text:'未提交的计算草稿\n100 × 20%',submitted:false,judged:null,recorded:false}
      }}};
}

test('reload restores chapter, question, selected answers, drafts and recorded flag',() => {
  const disk=storage(), state=active();
  writeProgress(disk,key,state,new Map());
  const restored=readProgress(disk,key,subjects);
  assert.equal(restored.subjectId,'accounting');
  assert.equal(restored.selectionOpen,false);
  assert.equal(restored.fontSize,1.2);
  const s=restored.states.get('accounting');
  assert.equal(s.chapterIndex,0);
  assert.equal(s.sectionName,'一节');
  assert.equal(s.session.index,2);
  assert.deepEqual(s.session.answers,state.session.answers);
  assert.deepEqual(s.session.orders,state.session.orders);
  assert.equal(s.session.items[0],items[0]);
  assert.ok(!disk.getItem(key).includes('options'));
});
test('mock reload keeps the identical paper, shuffled options and remaining time',() => {
  const disk=storage(), state=active('mock');
  state.session.items=[items[2],items[0],items[1]];
  writeProgress(disk,key,state,new Map());
  const restored=readProgress(disk,key,subjects).states.get('accounting').session;
  assert.deepEqual(restored.items.map(q => q.id),['three','one','two']);
  assert.equal(restored.seconds,1432);
  assert.equal(restored.finished,false);
  assert.deepEqual(restored.orders.one,[3,1,0,2]);
});
test('submitted mock result and written self-grade survive without clearing recorded state',() => {
  const disk=storage(), state=active('mock');
  state.session.finished=true; state.session.showResult=true;
  state.session.answers.two.recorded=true;
  state.session.answers.three={choices:[],text:'已完成',submitted:false,judged:false,recorded:true};
  writeProgress(disk,key,state,new Map());
  const restored=readProgress(disk,key,subjects).states.get('accounting').session;
  assert.equal(restored.showResult,true);
  assert.equal(restored.answers.two.recorded,true);
  assert.equal(restored.answers.three.judged,false);
  assert.equal(restored.answers.three.recorded,true);
});
test('all visited subjects and the subject picker survive a full restart',() => {
  const disk=storage(), state=active();
  state.selectionOpen=true;
  const previous=active('mock'); previous.session.index=1;
  writeProgress(disk,key,state,new Map([['law',previous]]));
  const restored=readProgress(disk,key,subjects);
  assert.equal(restored.selectionOpen,true);
  assert.equal(restored.states.get('law').session.index,1);
  assert.equal(restored.states.get('law').session.mode,'mock');
});
test('empty wrong-question practice is restorable',() => {
  const disk=storage(), state=active('wrong'); state.session.items=[];
  writeProgress(disk,key,state,new Map());
  const restored=readProgress(disk,key,subjects).states.get('accounting').session;
  assert.equal(restored.items.length,0); assert.equal(restored.index,0);
});
test('corrupt JSON, unknown versions and removed questions safely fall back',() => {
  const disk=storage(); disk.setItem(key,'{broken');
  assert.equal(readProgress(disk,key,subjects),null);
  disk.setItem(key,JSON.stringify({version:99}));
  assert.equal(readProgress(disk,key,subjects),null);
  writeProgress(disk,key,active(),new Map());
  const edited={...subjects,accounting:{chapters:[{}],questions:items.slice(1)}};
  assert.equal(readProgress(disk,key,edited),null);
});
test('invalid answers, option order and ranges are normalized',() => {
  const disk=storage(), state=active();
  state.session.index=900;state.session.seconds=-5;
  state.session.orders.one=[3,3,3,3];
  state.session.answers.one.choices=[99,2,2,3];
  writeProgress(disk,key,state,new Map());
  const s=readProgress(disk,key,subjects).states.get('accounting').session;
  assert.equal(s.index,2);assert.equal(s.seconds,0);
  assert.deepEqual(s.orders.one,[0,1,2,3]);
  assert.deepEqual(s.answers.one.choices,[2]);
});
test('unavailable storage is safe to read and reports write failures to the application',() => {
  const disk={getItem(){throw Error('blocked');},setItem(){throw Error('quota');}};
  assert.equal(readProgress(disk,key,subjects),null);
  assert.throws(() => writeProgress(disk,key,active(),new Map()),/quota/);
});
