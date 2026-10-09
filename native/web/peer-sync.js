// App-owned LAN discovery and transport; Android/Windows implement the bridge.
export function createPeerSync(options) {
  if (!window.CpaNative && !window.CPA_NATIVE_ENDPOINT) return null;
  const pending = new Map();
  let sequence=0, info=null, busy=false, publishing=false, status='正在启动设备同步…';
  let inbox=[], view=null, lastPayload='', latestProgress='', progressAt=0;
  const key='cpa-peer-ui-v1';
  let saved;
  try { saved=JSON.parse(localStorage.getItem(key)||'null'); } catch {}
  saved=saved||{settings:{marks:{},shuffle:null},seen:{}};
  saved.settings ||= {marks:{},shuffle:null}; saved.seen ||= {};
  function persist(){localStorage.setItem(key,JSON.stringify(saved));}
  window.__cpaPeerReply=(id,response)=>{
    const item=pending.get(id); if(!item)return;
    clearTimeout(item.timer);pending.delete(id);
    if(response.ok)item.resolve(response.result);else item.reject(Error(response.error||'同步失败'));
  };
  async function request(value) {
    if(window.CpaNative)return new Promise((resolve,reject)=>{
      const id=String(++sequence),timer=setTimeout(()=>{pending.delete(id);reject(Error('设备响应超时'));},60000);
      pending.set(id,{resolve,reject,timer});
      try{window.CpaNative.request(id,JSON.stringify(value));}catch(e){clearTimeout(timer);pending.delete(id);reject(e);}
    });
    const response=await fetch('/local',{method:'POST',headers:{'Content-Type':'application/json',
      Authorization:'Bearer '+window.CPA_NATIVE_ENDPOINT.token},body:JSON.stringify(value),signal:AbortSignal.timeout(60000)});
    const result=await response.json();if(!result.ok)throw Error(result.error||'同步失败');return result.result;
  }
  const stamp=()=>String(Date.now()).padStart(16,'0')+':'+info.id+':'+String(++sequence).padStart(8,'0');
  function capture() {
    const value=options.snapshot();
    if(value.progress!==latestProgress){latestProgress=value.progress;progressAt=Date.now();}
    const selected=new Set(value.marks);
    for(const id of new Set([...Object.keys(saved.settings.marks),...selected])) {
      const old=saved.settings.marks[id];if(!old||old.value!==selected.has(id))saved.settings.marks[id]={value:selected.has(id),stamp:stamp()};
    }
    if(!saved.settings.shuffle||saved.settings.shuffle.value!==value.shuffle)saved.settings.shuffle={value:value.shuffle,stamp:stamp()};
    persist();
    return JSON.stringify({schema:'cpa-p2p-v1',bankId:options.bankId,deviceId:info.id,
      progressAt,backup:value.backup,progress:value.progress,settings:saved.settings});
  }
  function settingsFrom(value) {
    const result={marks:{},shuffle:null};
    if(!value||!value.marks||Object.keys(value.marks).length>10000)throw Error('同步设置无效');
    const validate=x=>x&&typeof x.value==='boolean'&&typeof x.stamp==='string'&&x.stamp.length<=120;
    for(const [id,item] of Object.entries(value.marks)) {
      if(id.length>150||!validate(item))throw Error('标记同步格式无效');result.marks[id]=item;
    }
    if(!validate(value.shuffle))throw Error('设置同步格式无效');result.shuffle=value.shuffle;return result;
  }
  function mergeSettings(remote) {
    const result={marks:{...saved.settings.marks},shuffle:saved.settings.shuffle};
    for(const [id,item] of Object.entries(remote.marks))if(!result.marks[id]||item.stamp>result.marks[id].stamp)result.marks[id]=item;
    if(!result.shuffle||remote.shuffle.stamp>result.shuffle.stamp)result.shuffle=remote.shuffle;
    return result;
  }
  function decode(message) {
    const value=JSON.parse(message.payload);
    if(value.schema!=='cpa-p2p-v1'||value.bankId!==options.bankId||typeof value.progress!=='string'||value.progress.length>10000000)throw Error('题库或同步版本不同');
    options.validate(value); value.settings=settingsFrom(value.settings);return value;
  }
  async function publish() {
    if(!info||publishing)return;publishing=true;
    try{const payload=capture();if(payload!==lastPayload){await request({action:'publish',payload});lastPayload=payload;}}
    finally{publishing=false;}
  }
  function mergedSettings(settings){return {marks:Object.entries(settings.marks).filter(([,x])=>x.value).map(([id])=>id),shuffle:settings.shuffle.value};}
  async function cycle() {
    if(busy||document.hidden)return;busy=true;
    try{
      if(!info)info=await request({action:'info'});
      await publish();
      const result=await request({action:'exchange'});inbox=result.inbox||[];
      for(const message of inbox)if(saved.seen[message.id]!==message.hash){
        const value=decode(message),settings=mergeSettings(value.settings);
        options.merge(value,mergedSettings(settings));
        saved.settings=settings;saved.seen[message.id]=message.hash;persist();
      }
      await publish();
      const list=await request({action:'peers'});
      const paired=list.peers.filter(p=>p.paired);
      status=paired.length?(paired.some(p=>p.status.startsWith('未连接'))?'部分设备未连接，本机记录已保留':'记录已同步，可选择继续对方进度'):'已就绪，请先配对附近设备';
      draw(list.peers);
    }catch(e){status=e.message;draw();}finally{busy=false;}
  }
  function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;}
  function button(text,action){const b=node('button',text);b.type='button';b.onclick=async()=>{b.disabled=true;try{await action();}catch(e){status=e.message;draw();}finally{b.disabled=false;}};return b;}
  function draw(peers) {
    if(!view||!view.isConnected)return;
    view.querySelector('[data-status]').textContent=status;
    if(!info)return;
    view.querySelector('[data-info]').textContent=info.alias+' · '+(info.ips||[]).join(' / ')+'\n本机配对码：'+info.pin;
    if(!peers)return;
    const list=view.querySelector('[data-peers]');list.replaceChildren();
    for(const peer of peers){
      const card=node('div');card.className='peer-card';
      card.append(node('strong',peer.alias),node('p',peer.host+':'+peer.port+' · '+(peer.paired?(peer.status||'已配对'):'未配对')));
      if(!peer.paired){
        const pin=node('input');pin.placeholder='输入对方显示的 8 位配对码';pin.inputMode='numeric';pin.maxLength=8;pin.autocomplete='off';
        card.append(pin,button('配对',async()=>{if(!/^\d{8}$/.test(pin.value))throw Error('请输入 8 位配对码');await request({action:'pair',id:peer.id,pin:pin.value});await cycle();}));
      }else{
        const message=inbox.find(x=>x.id===peer.id);
        if(message)card.append(button('在本机继续对方进度',async()=>{
          if(!confirm('将切换到对方发送的练习进度。当前进度会保留为恢复备份，答题统计会合并。请暂停对方作答。'))return;
          const value=decode(message);localStorage.setItem('cpa-before-peer-progress-v1',options.snapshot().progress);
          options.apply(value);latestProgress=options.snapshot().progress;progressAt=Date.now();lastPayload='';await cycle();status='已接续练习，可以关闭同步窗口答题。';draw();
        }));
        card.append(button('取消配对',async()=>{await request({action:'forget',id:peer.id});delete saved.seen[peer.id];persist();await cycle();}));
      }
      list.append(card);
    }
    if(!peers.length)list.append(node('p','暂未发现设备。请保持对方程序打开；也可输入对方局域网 IP。'));
  }
  function open() {
    options.openModal('局域网设备同步',body=>{
      view=node('div');view.className='peer-panel';
      const details=node('p');details.dataset.info='';details.style.whiteSpace='pre-wrap';
      const state=node('p',status);state.dataset.status='';state.setAttribute('role','status');
      view.append(node('p','两端连接同一 Wi-Fi 或手机热点，并保持 EXE / APK 打开。首次配对后自动合并统计、错题、标记和历史；切换设备时点击“在本机继续对方进度”。'),details,state);
      view.append(button('查找附近设备',async()=>{await request({action:'discover'});await cycle();}));
      const list=node('div');list.dataset.peers='';view.append(list);
      const host=node('input');host.placeholder='对方 IP，例如 192.168.43.1';host.inputMode='decimal';
      view.append(host,button('通过 IP 查找',async()=>{await request({action:'manual',host:host.value.trim()});await cycle();}));
      view.append(button('恢复接续前的本机进度',async()=>{const p=localStorage.getItem('cpa-before-peer-progress-v1');if(!p)throw Error('没有可恢复的进度');options.apply({progress:p});latestProgress=options.snapshot().progress;progressAt=Date.now();lastPayload='';await cycle();}));
      body.append(view);draw();cycle();
    });
  }
  const timer=setInterval(cycle,4000);cycle();
  return {open,changed(){/* Poll captures only changed state, keeping editing synchronous. */},stop(){clearInterval(timer);}};
}
