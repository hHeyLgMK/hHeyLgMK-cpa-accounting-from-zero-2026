"""Production Java/Windows transport test; use --tool-paths on Windows, or a Linux tools root."""
import argparse, concurrent.futures, datetime, hashlib, json, os, socket, subprocess, tempfile, time
import urllib.error, urllib.request
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

ROOT=Path(__file__).resolve().parents[2];BUILD=ROOT/'work/peer-build'
parser=argparse.ArgumentParser();parser.add_argument('tools_root',nargs='?');parser.add_argument('--tool-paths')
args=parser.parse_args();env=dict(os.environ,CPA_TEST_CERT_PASSWORD='cpa-test')
if args.tool_paths:
 tools=json.loads(Path(args.tool_paths).read_text(encoding='utf-8'));java=Path(tools['java']);javac=Path(tools['javac']);jsonjar=Path(tools['json_jar'])
 launcher=[ROOT/'downloads/peer/CPA刷题库_设备同步_Windows.exe']
else:
 tools=Path(args.tools_root).resolve();java=tools/'usr/lib/jvm/java-21-openjdk-amd64/bin/java';javac=java.with_name('javac');jsonjar=tools/'usr/share/java/com.android.json-android-10.0.0.jar'
 launcher=[tools/'usr/bin/mono',ROOT/'downloads/peer/CPA刷题库_设备同步_Windows.exe'];env.update(MONO_PATH=str(tools/'usr/lib/mono/4.5'),MONO_CFG_DIR=str(tools/'etc'))
classes=BUILD/'testclasses';classes.mkdir(parents=True,exist_ok=True)
subprocess.run([str(javac),'-J-Duser.language=en','-Xlint:-options','--release','8','-encoding','UTF-8','-cp',str(jsonjar),'-d',str(classes),str(ROOT/'native/android/src/cn/cpa26/workbook/PeerNode.java'),str(ROOT/'native/tests/PeerHarness.java')],check=True)
classpath=str(classes)+os.pathsep+str(jsonjar);bank=(BUILD/'bank-id.txt').read_text()
def port():
 with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
def pfx(root,name):
 key=rsa.generate_private_key(public_exponent=65537,key_size=2048);subject=x509.Name([x509.NameAttribute(NameOID.COMMON_NAME,name)])
 now=datetime.datetime.now(datetime.timezone.utc)
 cert=x509.CertificateBuilder().subject_name(subject).issuer_name(subject).public_key(key.public_key()).serial_number(x509.random_serial_number()).not_valid_before(now-datetime.timedelta(minutes=1)).not_valid_after(now+datetime.timedelta(days=2)).sign(key,hashes.SHA256())
 encryption=serialization.PrivateFormat.PKCS12.encryption_builder().key_cert_algorithm(pkcs12.PBES.PBESv1SHA1And3KeyTripleDESCBC).hmac_hash(hashes.SHA1()).build(b'cpa-test')
 output=root/(name+'.pfx');output.write_bytes(pkcs12.serialize_key_and_certificates(name.encode(),key,cert,None,encryption))
 return output
def start(command):return subprocess.Popen([str(x) for x in command],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',errors='replace',env=env)
def call(url,token,value,origin=None):
 headers={'Content-Type':'application/json','Authorization':'Bearer '+token}
 if origin:headers['Origin']=origin
 request=urllib.request.Request(url,data=json.dumps(value).encode(),headers=headers)
 with urllib.request.urlopen(request,timeout=15) as response:return json.load(response)
with tempfile.TemporaryDirectory(dir=BUILD,prefix='transport-') as folder:
 root=Path(folder);a=b=None
 try:
  remote,local,jport=port(),port(),port()
  a=start([*launcher,'--test',root/'windows',pfx(root,'windows'),BUILD/'index.html',remote,local])
  line=a.stdout.readline()
  if not line:raise RuntimeError(a.stderr.read())
  windows_info=json.loads(line);token=a.stdout.readline().strip();url=f'http://127.0.0.1:{local}/local'
  jcmd=[java,'-Dfile.encoding=UTF-8','-Dstdout.encoding=UTF-8','-cp',classpath,'cn.cpa26.workbook.PeerHarness',pfx(root,'android'),root/'android',bank,jport]
  b=start(jcmd);line=b.stdout.readline()
  if not line:raise RuntimeError(b.stderr.read())
  android_info=json.loads(line)
  assert 'pin' not in windows_info and 'pin' not in android_info
  def windows(value):
   result=call(url,token,value);assert result['ok'],result;return result['result']
  def android(value):
   b.stdin.write(json.dumps(value)+'\n');b.stdin.flush();result=json.loads(b.stdout.readline());assert result['ok'],result;return result['result']
  windows({'action':'discover'});android({'action':'discover'})
  deadline=time.monotonic()+4
  while time.monotonic()<deadline:
   if any(p['id']==android_info['id'] for p in windows({'action':'peers'})['peers']) and any(p['id']==windows_info['id'] for p in android({'action':'peers'})['peers']):break
   time.sleep(0.15)
  discovered=any(p['id']==android_info['id'] for p in windows({'action':'peers'})['peers']) and any(p['id']==windows_info['id'] for p in android({'action':'peers'})['peers'])
  if not discovered:
   windows({'action':'manual','host':'127.0.0.1','port':jport});android({'action':'manual','host':'127.0.0.1','port':remote})
  assert not windows({'action':'peers'})['peers'][0]['syncing']
  assert not windows({'action':'exchange'})['inbox']
  windows({'action':'connect','id':android_info['id']})
  assert windows({'action':'peers'})['peers'][0]['syncing'] and android({'action':'peers'})['peers'][0]['syncing']
  def payload(n):return json.dumps({'schema':'cpa-p2p-v1','bankId':bank,'test':n,'draft':'中文草稿 × 20%','events':[{'id':'once','correct':True}]})
  first,second=payload(1),payload(2)
  windows({'action':'publish','payload':first});android({'action':'publish','payload':second})
  assert windows({'action':'exchange'})['inbox'][0]['payload']==second
  assert android({'action':'exchange'})['inbox'][0]['payload']==first
  for _ in range(4):assert windows({'action':'exchange'})['inbox'][0]['hash']==hashlib.sha256(second.encode()).hexdigest()
  with concurrent.futures.ThreadPoolExecutor(2) as pool:
   tasks=[pool.submit(windows,{'action':'connect','id':android_info['id']}),pool.submit(android,{'action':'connect','id':windows_info['id']})]
   for task in tasks:task.result(timeout=15)
  assert windows({'action':'exchange'})['inbox'][0]['payload']==second
  assert android({'action':'exchange'})['inbox'][0]['payload']==first
  for badtoken,origin in [('bad',None),(token,'https://unrelated.example')]:
   try:call(url,badtoken,{'action':'info'},origin);raise AssertionError('foreign local request accepted')
   except urllib.error.HTTPError:pass
  try:windows({'action':'publish','payload':json.dumps({'schema':'cpa-p2p-v1','bankId':'other'})});raise AssertionError('wrong bank accepted')
  except urllib.error.HTTPError:pass
  b.stdin.close();b.wait(timeout=10);b=start(jcmd);json.loads(b.stdout.readline())
  assert android({'action':'exchange'})['inbox'][0]['payload']==first
  windows({'action':'forget','id':android_info['id']})
  assert not windows({'action':'exchange'})['inbox']
  android({'action':'exchange'})
  assert android({'action':'peers'})['peers'][0]['status'].startswith('未连接')
  android({'action':'connect','id':windows_info['id']})
  assert windows({'action':'exchange'})['inbox'][0]['payload']==second
  print('PASS: discovery='+('multicast' if discovered else 'manual fallback')+', code-free selection, bidirectional TLS, simultaneous reconnect, Unicode, deduplication, local origin/token protection, bank rejection, restart, stop and reconnect')
 finally:
  for process in (a,b):
   if process and process.poll() is None:process.kill();process.wait()
