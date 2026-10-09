import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../native/web/peer-sync.js',import.meta.url),'utf8').replace('export function','function');
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
function boot(overrides={}) {
  class Node {
    constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.style={};this.isConnected=true;this.textContent='';}
    append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(){}
    querySelector(selector){const key=selector.slice(6,-1);return walk(this).find(x=>Object.hasOwn(x.dataset,key));}
  }
  const walk=node=>[node,...node.children.flatMap(walk)];
  const calls=[],merges=[],disk=new Map(),body=new Node('div');let timer,inbox=[];
  const peer={id:'remote',alias:'手机',host:'192.168.43.1',port:53319,directSync:true,bankId:'bank',syncing:false,status:'',...overrides};
  const remote={schema:'cpa-p2p-v1',bankId:'bank',progress:'remote draft',backup:'records',settings:{marks:{},shuffle:{value:false,stamp:'1'}}};
  const context=vm.createContext({window:{CPA_NATIVE_ENDPOINT:{token:'local-only'}},document:{hidden:false,createElement:tag=>new Node(tag)},
    localStorage:{getItem:key=>disk.get(key)??null,setItem:(key,value)=>disk.set(key,value)},
    setInterval:fn=>{timer=fn;return 1;},clearInterval(){},setTimeout,clearTimeout,AbortSignal,confirm:()=>true,
    fetch:async(url,options)=>{
      assert.equal(url,'/local');assert.equal(options.headers.Authorization,'Bearer local-only');
      const request=JSON.parse(options.body);calls.push(request);let result;
      switch(request.action){
        case 'info':result={id:'local',alias:'电脑',ips:['192.168.43.2']};break;
        case 'publish':case 'discover':result={ok:true};break;
        case 'connect':peer.syncing=true;peer.status='已同步';inbox=[{id:peer.id,hash:'one-event',payload:JSON.stringify(remote)}];result={ok:true};break;
        case 'exchange':result={inbox};break;
        case 'peers':result={peers:[peer]};break;
        case 'forget':peer.syncing=false;inbox=[];result={ok:true};break;
        default:throw Error('Unexpected action '+request.action);
      }
      return {json:async()=>({ok:true,result})};
    }});
  const options={bankId:'bank',snapshot:()=>({progress:'local draft',backup:'records',marks:[],shuffle:false}),
    validate(){},merge:value=>merges.push(value),apply(){},openModal:(title,render)=>render(body)};
  vm.runInContext(source+';globalThis.api=createPeerSync;',context);
  const sync=context.api(options);
  return {calls,merges,peer,body,open:()=>sync.open(),tick:()=>timer(),nodes:()=>walk(body)};
}

test('discovered device syncs with one click, never asks for a code, and merges the same message once',async()=>{
  const app=boot();await flush();app.open();await flush();
  assert.ok(!app.calls.some(x=>x.action==='connect'),'discovery must not select a device');
  assert.ok(!app.nodes().some(x=>/配对|配对码/.test(x.textContent)));
  assert.ok(!app.nodes().some(x=>x.tag==='input'&&x.inputMode==='numeric'));
  await app.nodes().find(x=>x.tag==='button'&&x.textContent==='同步').onclick();
  assert.deepEqual(app.calls.find(x=>x.action==='connect'),{action:'connect',id:'remote'});
  assert.equal(app.merges.length,1);await app.tick();assert.equal(app.merges.length,1);
  assert.ok(app.nodes().some(x=>x.textContent==='在本机继续对方进度'));
  await app.nodes().find(x=>x.textContent==='停止同步').onclick();
  assert.equal(app.peer.syncing,false);assert.deepEqual(app.calls.find(x=>x.action==='forget'),{action:'forget',id:'remote'});
});
test('old protocol or different bank is shown without enabling sync',async()=>{
  for(const overrides of [{directSync:false},{bankId:'other'}]){
    const app=boot(overrides);await flush();app.open();await flush();
    assert.ok(!app.nodes().some(x=>x.tag==='button'&&x.textContent==='同步'));
    assert.ok(!app.calls.some(x=>x.action==='connect'));
  }
});
