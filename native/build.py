"""Build EXE and APK with local Mono, JDK, Android SDK; no hosted build service.

python native/build.py --tools-root /path/to/tools --signing-key /private/key.pem
                      --previous-apk /path/to/previous.apk
Signing key and previous signer certificate must match for an in-place update.
"""
import argparse, os, subprocess, shutil, zipfile
from pathlib import Path
from cryptography.hazmat.primitives import serialization
from cryptography import x509
from cryptography.hazmat.primitives.serialization import pkcs7,pkcs12

ROOT=Path(__file__).resolve().parent.parent
p=argparse.ArgumentParser();p.add_argument('--tools-root',required=True);p.add_argument('--signing-key',required=True);p.add_argument('--previous-apk');p.add_argument('--signing-cert')
args=p.parse_args();tools=Path(args.tools_root).resolve()
out=ROOT/'work/peer-build';out.mkdir(parents=True,exist_ok=True)
deliver=ROOT/'downloads/peer';deliver.mkdir(parents=True,exist_ok=True)
def run(cmd,**kw):subprocess.run([str(x) for x in cmd],check=True,cwd=ROOT,**kw)
run(['node',ROOT/'native/build-web.mjs']);bank=(out/'bank-id.txt').read_text()
java=tools/'usr/lib/jvm/java-21-openjdk-amd64/bin/java';javac=java.with_name('javac')
android=tools/'usr/share/java/com.android.android-23.jar';dx=tools/'usr/share/java/com.android.dx-10.0.0.jar'
mono=tools/'usr/bin/mono';mcs=tools/'usr/lib/mono/4.5/mcs.exe'
cs=out/'PeerApp.cs';cs.write_text((ROOT/'native/windows/PeerApp.cs').read_text().replace('BANK_PLACEHOLDER',bank))
env=dict(os.environ,MONO_PATH=str(tools/'usr/lib/mono/4.5'),MONO_CFG_DIR=str(tools/'etc'))
refs=['System','System.Core','System.Windows.Forms','System.Drawing','System.Web.Extensions','System.IO.Compression']
# GZipStream is in System.dll on the target Framework, so no Compression DLL is required.
refs.remove('System.IO.Compression')
exe=deliver/'CPA刷题库_设备同步_Windows.exe'
run([mono,mcs,'-target:winexe','-optimize+','-out:'+str(exe),*[('-r:'+str(tools/'usr/lib/mono/4.5'/f'{r}.dll')) for r in refs],'-resource:'+str(out/'CPAPeer.html.gz')+',CPAPeer.html.gz',cs],env=env)
src=out/'src/cn/cpa26/workbook';src.mkdir(parents=True,exist_ok=True)
for file in (ROOT/'native/android/src/cn/cpa26/workbook').glob('*.java'):
 (src/file.name).write_text(file.read_text().replace('BANK_PLACEHOLDER',bank))
classes=out/'classes';shutil.rmtree(classes,ignore_errors=True);classes.mkdir()
run([javac,'-source','8','-target','8','-encoding','UTF-8','-cp',android,'-d',classes,*src.glob('*.java')])
run([java,'-cp',dx,'com.android.dx.command.Main','--dex','--output='+str(out/'classes.dex'),classes])
assets=out/'assets';assets.mkdir(exist_ok=True);shutil.copyfile(out/'index.html',assets/'index.html')
res=out/'res/drawable';res.mkdir(parents=True,exist_ok=True)
shutil.copyfile(ROOT/'native/android/res/drawable/icon.png',res/'icon.png')
cert_path=Path(args.signing_cert) if args.signing_cert else ROOT/'native/android/signing-cert.pem'
certificates=[x509.load_pem_x509_certificate(cert_path.read_bytes())]
if args.previous_apk:
 with zipfile.ZipFile(Path(args.previous_apk).resolve()) as z:
  (res/'icon.png').write_bytes(z.read('res/drawable/icon.png'))
  signers=[n for n in z.namelist() if n.startswith('META-INF/') and n.endswith('.RSA')]
  if signers:certificates=pkcs7.load_der_pkcs7_certificates(z.read(signers[0]))
private=Path(args.signing_key).read_bytes()
if private.startswith(b'-----BEGIN'):key=serialization.load_pem_private_key(private,None)
else:
 password=os.environ.get('CPA_SIGNING_PASSWORD')
 if password is None:raise ValueError('Set CPA_SIGNING_PASSWORD for PKCS12 keystores')
 key,_,_=pkcs12.load_key_and_certificates(private,password.encode())
cert=next((c for c in certificates if c.public_key().public_numbers()==key.public_key().public_numbers()),None)
if cert is None:raise ValueError('Signing key differs from previous APK; refusing to sign an incompatible update')
(out/'signer.pk8').write_bytes(key.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
(out/'signer.pem').write_bytes(cert.public_bytes(serialization.Encoding.PEM));(out/'signer.pk8').chmod(0o600)
sdk=tools/'usr/lib/android-sdk/build-tools/debian'
env=dict(os.environ,LD_LIBRARY_PATH=str(tools/'usr/lib/x86_64-linux-gnu/android')+':'+str(tools/'usr/lib/x86_64-linux-gnu')+':'+str(tools/'usr/lib'))
unsigned=out/'unsigned.apk'
run([sdk/'aapt','package','-f','-M',ROOT/'native/android/AndroidManifest.xml','-S',res.parent,'-A',assets,'-I',android,'-F',unsigned],env=env)
with zipfile.ZipFile(unsigned,'a',compression=zipfile.ZIP_DEFLATED) as z:z.write(out/'classes.dex','classes.dex')
aligned=out/'aligned.apk';run([sdk/'zipalign','-f','4',unsigned,aligned],env=env)
apk=deliver/'CPA刷题库_设备同步_Android.apk'
signer=tools/'usr/share/java/apksigner-31.0.2.jar'
try:
 run([java,'-jar',signer,'sign','--key',out/'signer.pk8','--cert',out/'signer.pem','--out',apk,aligned])
 run([java,'-jar',signer,'verify','--verbose',apk])
finally:
 (out/'signer.pk8').unlink(missing_ok=True)
print('Built:',exe,apk,sep='\n')
