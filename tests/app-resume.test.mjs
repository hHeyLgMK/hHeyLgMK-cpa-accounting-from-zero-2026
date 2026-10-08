import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {chapters as accountingChapters,questions as accountingQuestions} from '../dist/questions.js';
import {extraSubjects} from '../dist/extra-subjects.js';
import {readProgress,writeProgress} from '../dist/progress.js';

const source = fs.readFileSync(new URL('../dist/app.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
// Run the production application with an in-memory DOM and persistent storage.
// A fresh VM represents reopening the application; no session variables survive.
function boot(disk=new Map(), script=source) {
  const nodes = new Map(), events = {}, timers = new Map();
  let timerId=0;
  class Node {
    constructor() {
      this.children=[];this.hidden=true;this.value='';this.textContent='';this.listeners={};this.attrs={};
      this.style={setProperty(){}};
      const classes=new Set();
      this.classList={add:(c)=>classes.add(c),remove:(c)=>classes.delete(c),
        toggle:(c,enabled)=>{const on=enabled??!classes.has(c);on?classes.add(c):classes.delete(c);return on;}};
    }
    set id(id){this._id=id;nodes.set(id,this);} get id(){return this._id;}
    append(...children){this.children.push(...children);}
    replaceChildren(...children){this.children=children;}
    setAttribute(k,v){this.attrs[k]=v;} getAttribute(k){return this.attrs[k]??null;}
    addEventListener(k,fn){this.listeners[k]=fn;}
    querySelector(){return new Node();}
    focus(){} closest(){return null;}
  }
  const node = id => {if(!nodes.has(id))nodes.set(id,new Node());return nodes.get(id);};
  const document={getElementById:node,createElement:()=>new Node(),createTextNode:text=>({textContent:text}),
    querySelector:node,querySelectorAll:()=>[],activeElement:null,hidden:false,
    addEventListener:(name,fn)=>{events[name]=fn;}};
  const context=vm.createContext({document,
    window:{addEventListener:(name,fn)=>{events[name]=fn;}},
    localStorage:{getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)},
    setInterval:fn=>{timers.set(++timerId,fn);return timerId;},clearInterval:id=>timers.delete(id),
    matchMedia:()=>({matches:false}),accountingChapters,accountingQuestions,extraSubjects,readProgress,writeProgress,
    URL:{createObjectURL:()=> 'blob:test'},Blob,Uint8Array,atob});
  vm.runInContext(script,context,{timeout:10000});
  return {disk,nodes,events,timers,run:code=>vm.runInContext(code,context),
    json:code=>JSON.parse(vm.runInContext('JSON.stringify('+code+')',context))};
}

test('real app restart returns to the same section/question and keeps submitted and draft answers',()=>{
  let app=boot();app.run("openAccounting();startChapter(4,'__all__');selectChoice(current(),0);submitAnswer();navigate(4);selectChoice(current(),1);");
  app.nodes.get('markBtn').onclick();
  const expected=app.json('({subjectId,chapterIndex,sectionName,session,data})');
  app.events.pagehide();app=boot(app.disk);
  const actual=app.json('({subjectId,chapterIndex,sectionName,session,data})');
  assert.equal(actual.subjectId,expected.subjectId);assert.equal(actual.chapterIndex,4);
  assert.equal(actual.sectionName,'__all__');assert.equal(actual.session.index,4);
  assert.deepEqual(actual.session.answers,expected.session.answers);
  assert.deepEqual(actual.data,expected.data);
  assert.equal(app.nodes.get('practiceApp').hidden,false);
  assert.equal(app.run('selectionOpen'),false);
});
test('real written input saves before navigation and all subjects remain available after reopening',()=>{
  let app=boot();app.run("openAccounting();navigate(3);openSubject('law');startChapter(0,'__all__');navigate(session.items.findIndex(q=>q.type==='written'));");
  const draft='尚未提交的草稿：收到订金不等于收入\n100 × 20% = 20';
  app.nodes.get('writtenInput').listeners.input({target:{value:draft}});
  const question=app.run('current().id');app=boot(app.disk);
  assert.equal(app.run('subjectId'),'law');assert.equal(app.run('current().id'),question);
  assert.equal(app.run('answerFor(current()).text'),draft);
  assert.equal(app.nodes.get('writtenInput').value,draft);
  app.run('openAccounting()');assert.equal(app.run('session.index'),3);
});
test('real mock restart preserves the drawn questions, order, answers and paused countdown',()=>{
  let app=boot();app.run('openAccounting();data.shuffle=true;startMock();selectChoice(current(),2);navigate(3);');
  for(let i=0;i<13;i++)for(const tick of app.timers.values())tick();
  const expected=app.json('({ids:session.items.map(q=>q.id),orders:session.orders,answers:session.answers,seconds:session.seconds})');
  app=boot(app.disk);
  assert.deepEqual(app.json('({ids:session.items.map(q=>q.id),orders:session.orders,answers:session.answers,seconds:session.seconds})'),expected);
  assert.equal(app.run('session.index'),3);
  for(const tick of app.timers.values())tick();
  assert.equal(app.run('session.seconds'),expected.seconds-1);
  app.run('finishMock(true)');const records=app.json('data.records');
  app=boot(app.disk);assert.equal(app.run('session.finished'),true);assert.equal(app.run('session.showResult'),true);
  app.run('finishMock(true)');assert.deepEqual(app.json('data.records'),records);
});
test('real app ignores malformed progress without losing existing practice statistics',()=>{
  let app=boot();app.run('openAccounting();selectChoice(current(),0);submitAnswer()');
  const records=app.json('data.records');app.disk.set('cpa-practice-sessions-v1','{bad');
  app=boot(app.disk);assert.deepEqual(app.json('data.records'),records);assert.equal(app.run('session.index'),0);
});
test('EXE HTML initializes the full bank and resumes production answers after restart',()=>{
  const html=fs.readFileSync(new URL('../work/windows-build/CPA_Accounting_Offline.html',import.meta.url),'utf8');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];assert.equal(scripts.length,1);
  let app=boot(new Map(),scripts[0][1]);assert.equal(app.run('Object.values(subjects).reduce((n,s)=>n+s.questions.length,0)'),3732);
  app.run('openAccounting();navigate(2);selectChoice(current(),1)');
  const expected=app.run('current().id');app=boot(app.disk,scripts[0][1]);
  assert.equal(app.run('current().id'),expected);assert.deepEqual(app.json('answerFor(current()).choices'),[1]);
  assert.equal(app.run('Object.keys(offlineURLs).length'),8);
});
