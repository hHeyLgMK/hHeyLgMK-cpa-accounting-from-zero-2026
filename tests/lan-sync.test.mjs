import test from 'node:test';
import assert from 'node:assert/strict';
import {LanSyncClient} from '../dist/lan-sync.js';
function harness() {
  let state={revision:0,writer:null,snapshot:null,bankId:'bank'};
  let online=true;
  const client=(id, initial) => {
    let local=structuredClone(initial), backups=[];
    const sync=new LanSyncClient({clientId:id,snapshot:()=>structuredClone(local),
      apply:value=>{local=structuredClone(value);},backup:value=>backups.push(structuredClone(value)),
      request:async(action,body)=>{
        if(!online)throw Error('offline');
        if(action==='state')return structuredClone(state);
        if(body.revision!==state.revision || (action!=='claim' && state.writer!==id)) {
          const error=Error('conflict');error.status=409;throw error;
        }
        state={...state,revision:state.revision+1,writer:action==='release'?null:id,
          snapshot:body.snapshot?structuredClone(body.snapshot):state.snapshot};
        return structuredClone(state);
      }});
    return {sync,backups,read:()=>structuredClone(local),edit:value=>{local=structuredClone(value);}};
  };
  return {client,state:()=>structuredClone(state),network:value=>{online=value;}};
}
const snapshot=n=>({data:JSON.stringify({records:{q:{attempts:n}},history:[{id:'session',items:[{id:'q',correct:true}]}],marks:['q']}),
  progress:JSON.stringify({version:1,subjectId:'accounting',sessions:{accounting:{id:'session',ids:['q'],index:0,answers:{q:{choices:[n],submitted:true,recorded:true}},seconds:1234}}})});

test('handoff transfers submitted flags, history, drafts, remaining time; old writer cannot overwrite',async()=>{
  const h=harness(), a=h.client('computer',snapshot(1)), b=h.client('phonephone',snapshot(0));
  await a.sync.connect();await a.sync.useLocal();
  a.edit(snapshot(2));await a.sync.tick();
  await b.sync.connect();await b.sync.useShared(true);
  assert.deepEqual(b.read(),snapshot(2));
  b.edit(snapshot(3));await b.sync.tick();
  await a.sync.tick();assert.equal(a.sync.canEdit(),false);assert.deepEqual(a.read(),snapshot(3));
  assert.equal(JSON.parse(a.read().data).records.q.attempts,3);
  assert.equal(h.state().writer,'phonephone');
});
test('unuploaded changes on old device become recoverable conflict instead of overwriting newer state',async()=>{
  const h=harness(),a=h.client('computer',snapshot(1)),b=h.client('phonephone',snapshot(0));
  await a.sync.connect();await a.sync.useLocal();
  a.edit(snapshot(2));
  await b.sync.connect();await b.sync.useShared(true);b.edit(snapshot(3));await b.sync.tick();
  await assert.rejects(a.sync.tick());
  assert.equal(a.sync.conflict,true);assert.equal(a.sync.canEdit(),false);
  assert.deepEqual(a.read(),snapshot(2));assert.deepEqual(a.backups.at(-1),snapshot(2));
  assert.deepEqual(h.state().snapshot,snapshot(3));
  await a.sync.useShared(true);assert.deepEqual(a.read(),snapshot(3));
});
test('network loss preserves local work and retries without losing the last answer',async()=>{
  const h=harness(),a=h.client('computer',snapshot(1));
  await a.sync.connect();await a.sync.useLocal();
  h.network(false);a.edit(snapshot(2));await assert.rejects(a.sync.tick());
  assert.deepEqual(a.read(),snapshot(2));assert.deepEqual(h.state().snapshot,snapshot(1));
  h.network(true);await a.sync.tick();assert.deepEqual(h.state().snapshot,snapshot(2));
});
test('pairing never silently replaces either preexisting set of records; choosing local is explicit',async()=>{
  const h=harness(),a=h.client('computer',snapshot(1)),b=h.client('phonephone',snapshot(9));
  await a.sync.connect();await a.sync.useLocal();await b.sync.connect();await b.sync.tick();
  assert.deepEqual(b.read(),snapshot(9));assert.deepEqual(h.state().snapshot,snapshot(1));
  assert.equal(b.sync.canEdit(),false);
  await b.sync.useLocal();assert.deepEqual(h.state().snapshot,snapshot(9));
});
test('disconnect flushes progress and releases writer; viewing device pauses editing',async()=>{
  const h=harness(),a=h.client('computer',snapshot(1)),b=h.client('phonephone',snapshot(0));
  await a.sync.connect();await a.sync.useLocal();a.edit(snapshot(2));await a.sync.disconnect();
  assert.equal(h.state().writer,null);assert.deepEqual(h.state().snapshot,snapshot(2));assert.equal(a.sync.canEdit(),true);
  await b.sync.connect();await b.sync.useShared();assert.equal(b.sync.canEdit(),false);
});
