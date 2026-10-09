"""Run production Java transport and the production EXE transport together on loopback."""
import os,json,subprocess,tempfile,socket,urllib.request,ssl,hashlib,sys,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
TOOLS=Path(sys.argv[1]).resolve();BUILD=ROOT/'work/peer-build'
JAVA=TOOLS/'usr/lib/jvm/java-21-openjdk-amd64/bin/java'
BANK=(BUILD/'bank-id.txt').read_text()
env=dict(os.environ,MONO_PATH=str(TOOLS/'usr/lib/mono/4.5'),MONO_CFG_DIR=str(TOOLS/'etc'))
def port():
 with socket.socket() as s:s.bind(('127.0.0.1',0));return s.getsockname()[1]
def pfx(root,name):
 key=root/(name+'.key');cert=root/(name+'.crt');out=root/(name+'.pfx')
 subprocess.run(['openssl','req','-x509','-newkey','rsa:2048','-nodes','-keyout',str(key),'-out',str(cert),'-days','2','-subj','/CN='+name],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 subprocess.run(['openssl','pkcs12','-export','-legacy','-inkey',str(key),'-in',str(cert),'-out',str(out),'-passout','pass:'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 return out
def start(cmd):return subprocess.Popen([str(x) for x in cmd],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
def call(url,token,value,origin=None):
 headers={'Content-Type':'application/json','Authorization':'Bearer '+token}
 if origin:headers['Origin']=origin
 req=urllib.request.Request(url,data=json.dumps(value).encode(),headers=headers)
 with urllib.request.urlopen(req,timeout=15) as r:return json.load(r)
with tempfile.TemporaryDirectory() as folder:
 root=Path(folder);a=b=None
 try:
  remote,local,jport=port(),port(),port()
  a=start([TOOLS/'usr/bin/mono',ROOT/'downloads/peer/CPA刷题库_设备同步_Windows.exe','--test',root/'windows',pfx(root,'windows'),BUILD/'index.html',remote,local])
  line=a.stdout.readline()
  if not line:raise RuntimeError(a.stderr.read())
  info=json.loads(line);token=a.stdout.readline().strip();url=f'http://127.0.0.1:{local}/local'
  b=start([JAVA,'-cp',str(BUILD/'testclasses')+':'+str(TOOLS/'usr/share/java/com.android.json-android-10.0.0.jar'),'cn.cpa26.workbook.PeerHarness',pfx(root,'android'),root/'android',BANK,jport])
  line=b.stdout.readline()
  if not line:raise RuntimeError(b.stderr.read())
  android=json.loads(line)
  def windows(v):
   r=call(url,token,v);assert r['ok'],r;return r['result']
  def android_call(v):
   b.stdin.write(json.dumps(v)+'\n');b.stdin.flush();r=json.loads(b.stdout.readline());assert r['ok'],r;return r['result']
  found=windows({'action':'manual','host':'127.0.0.1','port':jport});assert found['id']==android['id']
  try:windows({'action':'pair','id':android['id'],'pin':'00000000'});raise AssertionError('wrong PIN accepted')
  except urllib.error.HTTPError:pass
  windows({'action':'pair','id':android['id'],'pin':android['pin']})
  assert windows({'action':'peers'})['peers'][0]['paired']
  assert android_call({'action':'peers'})['peers'][0]['paired']
  def payload(n):return json.dumps({'schema':'cpa-p2p-v1','bankId':BANK,'test':n,'draft':'中文草稿 × 20%','events':[{'id':'once','correct':True}]})
  first,second=payload(1),payload(2)
  windows({'action':'publish','payload':first});android_call({'action':'publish','payload':second})
  result=windows({'action':'exchange'});assert result['inbox'][0]['payload']==second
  result=android_call({'action':'exchange'});assert result['inbox'][0]['payload']==first
  for i in range(4):assert windows({'action':'exchange'})['inbox'][0]['hash']==hashlib.sha256(second.encode()).hexdigest()
  # Local bridge rejects requests from a foreign origin and wrong bearer token.
  for badtoken,origin in [('bad',None),(token,'https://unrelated.example')]:
   try:call(url,badtoken,{'action':'info'},origin);raise AssertionError('foreign local request accepted')
   except urllib.error.HTTPError:pass
  try:windows({'action':'publish','payload':json.dumps({'schema':'cpa-p2p-v1','bankId':'other'})});raise AssertionError('wrong bank accepted')
  except urllib.error.HTTPError:pass
  # Saved paired identity and received payload survive process restart.
  b.stdin.close();b.wait(timeout=10)
  b=start([JAVA,'-cp',str(BUILD/'testclasses')+':'+str(TOOLS/'usr/share/java/com.android.json-android-10.0.0.jar'),'cn.cpa26.workbook.PeerHarness',root/'android.pfx',root/'android',BANK,jport]);json.loads(b.stdout.readline())
  assert android_call({'action':'exchange'})['inbox'][0]['payload']==first
  windows({'action':'forget','id':android['id']})
  assert not windows({'action':'peers'})['peers']
  print('PASS: Java/EXE pairing, PIN rejection, bidirectional TLS, Unicode, repeated exchange, origin/token protection, bank rejection, restart, unpair')
 finally:
  for proc in (a,b):
   if proc and proc.poll() is None:proc.kill();proc.wait()
