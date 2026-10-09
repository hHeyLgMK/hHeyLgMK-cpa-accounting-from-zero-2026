// Whole-state handoff keeps submitted flags, history, drafts and statistics atomic.
export class LanSyncClient {
  constructor({request, snapshot, apply, backup, changed, clientId}) {
    Object.assign(this, {request, snapshot, apply, backup, changed, clientId});
    this.connected = false;
    this.ready = false;
    this.active = false;
    this.conflict = false;
    this.remote = null;
    this.ack = null;
  }
  canEdit() { return !this.connected || (this.ready && this.active && !this.conflict); }
  fingerprint(snapshot = this.snapshot()) { return JSON.stringify(snapshot); }
  body(remote = this.remote) {
    return {clientId:this.clientId, bankId:remote.bankId, revision:remote.revision};
  }
  status(message) { this.changed?.(message); }
  async connect() {
    this.remote = await this.request('state');
    this.connected = true;
    this.ready = false;
    this.active = false;
    this.status(this.remote.snapshot ? '已配对。选择继续共享进度，或用本机记录初始化。' : '已配对，共享记录为空。点击“用本机记录接管”初始化。');
  }
  applyRemote(remote) {
    if (remote.snapshot) this.apply(remote.snapshot);
    this.remote = remote;
    this.ack = this.fingerprint();
    this.conflict = false;
    this.ready = true;
    this.active = remote.writer === this.clientId;
  }
  async useShared(takeover = false) {
    const remote = await this.request('state');
    if (!remote.snapshot) throw Error('共享记录为空，请先用已有进度的设备初始化。');
    // Freeze local editing before the read/apply/claim transaction.
    this.active = false;
    this.backup(this.snapshot());
    this.applyRemote({...remote, writer:null});
    if (takeover) {
      const claimed = await this.request('claim', this.body(remote));
      this.remote = claimed;
      this.active = true;
    }
    this.status(this.active ? '本机正在答题，进度自动同步。' : '正在同步查看。点击“在本机继续”切换设备。');
  }
  async useLocal() {
    const remote = await this.request('state');
    const snapshot = this.snapshot();
    this.backup(snapshot);
    const claimed = await this.request('claim', {...this.body(remote), snapshot});
    this.remote = claimed;
    this.ack = this.fingerprint(snapshot);
    this.active = this.ready = true;
    this.conflict = false;
    this.status('本机正在答题，进度自动同步。');
  }
  async tick() {
    if (!this.connected) return;
    try {
      if (this.ready && this.active && !this.conflict && this.fingerprint() !== this.ack) {
        const snapshot = this.snapshot();
        const remote = await this.request('save', {...this.body(), snapshot});
        this.remote = remote;
        this.ack = this.fingerprint(snapshot);
        this.status('已同步 · ' + new Date().toLocaleTimeString());
        return;
      }
      const remote = await this.request('state');
      if (!this.ready || this.conflict) {
        this.remote = remote;
        return;
      }
      if (remote.revision !== this.remote.revision) {
        if (this.fingerprint() !== this.ack) {
          this.backup(this.snapshot());
          this.active = false;
          this.conflict = true;
          this.remote = remote;
          this.status('两端记录有变化，已保留本机备份。请选择采用共享记录或用本机记录接管。');
          return;
        }
        this.applyRemote(remote);
        this.status(this.active ? '本机正在答题，进度自动同步。' : '已跟随另一台设备的最新进度。点击“在本机继续”接管。');
      }
    } catch (error) {
      if (error.status === 409) {
        this.backup(this.snapshot());
        this.active = false;
        this.conflict = true;
        this.status('另一端已接管，未同步的本机记录已备份。请选择采用共享记录或用本机记录接管。');
      } else this.status('连接中断，记录仍保存在本机。恢复连接后重试；也可断开后离线答题。');
      throw error;
    }
  }
  async disconnect() {
    if (this.active && !this.conflict) {
      // Do not pretend a failed upload succeeded before switching offline.
      await this.tick();
      if (this.active) this.remote = await this.request('release', this.body());
    }
    this.connected = this.active = this.ready = false;
    this.conflict = false;
    this.status('已断开，本机可离线答题。下次连接时请选择保留哪一份记录。');
  }
}

export function createLanSync({snapshot, apply}) {
  if (typeof location === 'undefined' || !/^https?:$/.test(location.protocol)) return null;
  let client;
  let token = '';
  let busy = false;
  let serviceAvailable = false;
  let poll;
  let clientId;
  try {
    clientId = localStorage.getItem('cpa-lan-device-v1');
    if (!clientId) {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      clientId = Array.from(bytes, n => n.toString(16).padStart(2,'0')).join('');
      localStorage.setItem('cpa-lan-device-v1',clientId);
    }
  } catch { return null; }
  const backupsKey = 'cpa-lan-backups-v1';
  function backup(value) {
    const entries = JSON.parse(localStorage.getItem(backupsKey) || '[]');
    if (entries.at(-1)?.snapshot && JSON.stringify(entries.at(-1).snapshot) === JSON.stringify(value)) return;
    entries.push({at:new Date().toISOString(), snapshot:value});
    localStorage.setItem(backupsKey,JSON.stringify(entries.slice(-5)));
  }
  async function request(action, body) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(),8000);
    try {
      const response = await fetch('/api/'+action,{method:body ? 'POST' : 'GET',
        headers:{Authorization:'Bearer '+token, ...(body ? {'Content-Type':'application/json'} : {})},
        body:body ? JSON.stringify(body) : undefined, signal:controller.signal, cache:'no-store'});
      const result = await response.json();
      if (!response.ok) { const error = Error(result.error || '连接失败'); error.status = response.status; throw error; }
      return result;
    } finally { clearTimeout(timeout); }
  }
  const panel = document.createElement('details');
  panel.className = 'lan-panel';
  const title = document.createElement('summary');
  title.textContent = '局域网同步';
  panel.append(title);
  const content = document.createElement('div');
  const status = document.createElement('p');
  status.setAttribute('role','status');
  status.textContent = '输入电脑同步窗口中的 8 位配对码。';
  const label = document.createElement('label');
  label.textContent = '配对码 ';
  const code = document.createElement('input');
  code.inputMode = 'numeric'; code.type = 'password'; code.maxLength = 8;
  code.autocomplete = 'off'; code.placeholder = '8 位数字';
  label.append(code);
  const buttons = document.createElement('div'); buttons.className = 'lan-actions';
  const addButton = (text, action) => {
    const button = document.createElement('button');
    button.type = 'button'; button.textContent = text;
    button.onclick = () => run(action);
    buttons.append(button); return button;
  };
  const connectButton = addButton('配对', async () => {
    token = code.value.trim();
    if (!/^\d{8}$/.test(token)) throw Error('请输入电脑同步窗口显示的 8 位数字。');
    await client.connect();
  });
  const continueButton = addButton('在本机继续',async () => {
    if (client.active) { await client.tick(); return; }
    if (!client.ready && !confirm('将备份本机记录，读取共享进度并在本机继续。确认共享记录是你需要的进度？')) return;
    if (client.conflict && !confirm('本机未同步的记录已备份。采用共享进度并在本机继续？')) return;
    await client.useShared(true);
  });
  const followButton = addButton('采用共享记录',async () => {
    if (!confirm('将先备份本机记录，再采用共享记录。本机进入同步查看模式。')) return;
    await client.useShared();
  });
  const localButton = addButton('用本机记录接管',async () => {
    if (!confirm('将本机进度设为共享进度。电脑会备份上一份共享记录，两端已有分歧不会自动合并。继续？')) return;
    await client.useLocal();
  });
  const disconnectButton = addButton('暂停同步 / 离线',async () => {
    try { await client.disconnect(); }
    catch (error) {
      if (!confirm('未能完成最后一次同步。本机记录仍保留，是否断开并离线答题？')) throw error;
      client.connected = client.active = client.ready = client.conflict = false;
      client.status('已离线，未上传的记录保存在本机。');
    }
  });
  addButton('导出本机及备份',() => {
    const value = {format:'cpa-lan-backup-v1',current:snapshot(),backups:JSON.parse(localStorage.getItem(backupsKey)||'[]')};
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'}));
    link.download = 'CPA-刷题同步备份-'+Date.now()+'.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(link.href),1000);
  });
  const importLabel = document.createElement('label');
  importLabel.textContent = '导入备份 ';
  const importInput = document.createElement('input');
  importInput.type = 'file'; importInput.accept = '.json,application/json';
  importInput.onchange = () => run(async () => {
    if (client.connected) throw Error('请先暂停同步，再导入备份。');
    const file = importInput.files?.[0];
    if (!file || file.size > 12*1024*1024) throw Error('请选择小于 12 MB 的同步备份 JSON 文件。');
    const value = JSON.parse(await file.text());
    if (value.format !== 'cpa-lan-backup-v1' || !value.current) throw Error('备份格式不正确。');
    if (!confirm('先备份本机记录，再恢复所选文件中的当前记录？')) return;
    backup(snapshot()); apply(value.current);
    client.status('备份已恢复。连接后可用本机记录接管。');
    importInput.value = '';
  });
  importLabel.append(importInput);
  content.append(status,label,buttons,importLabel);
  const note = document.createElement('p');
  note.textContent = '另一台设备先等待“已同步”，再点击本机继续。请保持电脑服务窗口打开。';
  content.append(note); panel.append(content);
  const style = document.createElement('style');
  style.textContent = '.lan-panel{position:relative;z-index:50;background:#eaf3ff;color:#163f69;padding:10px 16px;font:14px/1.5 system-ui}.lan-panel summary{cursor:pointer;font-weight:700}.lan-panel>div{max-width:980px;margin:auto}.lan-panel p{margin:8px 0}.lan-actions{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.lan-panel button,.lan-panel input{font:inherit;border:1px solid #86a6c4;border-radius:6px;padding:7px;background:white;color:#163f69}.lan-panel input[type=password]{width:130px}.lan-panel button:disabled{opacity:.5}.lan-panel summary:focus-visible,.lan-panel button:focus-visible{outline:3px solid #156bc1}.lan-panel input[type=file]{max-width:100%}';
  document.head.append(style);
  client = new LanSyncClient({request,snapshot,apply,backup,clientId,changed(message) {
    status.textContent = message; update();
  }});
  function update() {
    for (const id of ['practiceApp','subjectPicker']) {
      const node = document.getElementById(id);
      if (node) node.inert = !client.canEdit();
    }
    connectButton.disabled = busy || client.connected || !serviceAvailable;
    code.disabled = client.connected || !serviceAvailable;
    for (const button of [continueButton,followButton,localButton,disconnectButton]) button.disabled = busy || !client.connected;
    title.textContent = client.connected ? '局域网同步 · '+(client.canEdit() ? '本机答题' : '等待接管') : '局域网同步 · 未连接';
  }
  async function run(action) {
    if (busy) return;
    busy = true; update();
    try { await action(); }
    catch (error) {
      if (error.status === 409) {
        client.active = false; client.conflict = true;
        backup(snapshot());
      }
      status.textContent = error.status === 409 ? '共享记录已更新，请重新读取。已保留本机记录。' : error.message;
    } finally { busy = false; update(); }
  }
  // Only show LAN UI on the local service, not on static hosting.
  fetch('/api/info',{cache:'no-store'}).then(response => {
    if (!response.ok) throw Error('not a LAN service');
    return response.json();
  }).then(info => {
    if (!info.serverId || !info.bankId) throw Error('not a LAN service');
    serviceAvailable = true;
    document.body.prepend(panel); update();
    poll = setInterval(() => { if (client.connected) run(() => client.tick()); },2000);
    window.addEventListener('pagehide',() => { clearInterval(poll); });
    window.addEventListener('pageshow',event => {
      if (event.persisted) poll = setInterval(() => { if (client.connected) run(() => client.tick()); },2000);
    });
  }).catch(() => {
    document.body.prepend(panel);
    status.textContent = '可导出或导入进度备份。局域网同步请从电脑服务地址打开此页面。';
    update();
  });
  return client;
}
