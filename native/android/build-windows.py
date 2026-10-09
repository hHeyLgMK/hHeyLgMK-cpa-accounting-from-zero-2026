"""Build a same-signature APK with a local Windows JDK and Android SDK.

python native/android/build-windows.py --tool-paths /path/to/paths.json --signing-key /private/signing_key.pem --node /path/to/node.exe
The JSON supplies java, javac, android_jar, aapt, d8, zipalign and apksigner paths.
"""
import argparse, hashlib, json, os, subprocess, uuid, zipfile
from pathlib import Path
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization

ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--tool-paths',required=True);parser.add_argument('--signing-key',required=True);parser.add_argument('--node',default='node')
args=parser.parse_args()
tools=json.loads(Path(args.tool_paths).read_text(encoding='utf-8'))
key_path=Path(args.signing_key).resolve()
if key_path.is_relative_to(ROOT):raise ValueError('Keep the original signing private key outside the repository')
key=serialization.load_pem_private_key(key_path.read_bytes(),None)
cert_path=ROOT/'native/android/signing-cert.pem'
cert=x509.load_pem_x509_certificate(cert_path.read_bytes())
if key.public_key().public_numbers()!=cert.public_key().public_numbers():raise ValueError('Signing key does not match the original APK certificate')
def run(command):
    # aapt/zipalign use narrow Windows paths; relative arguments avoid the Unicode repo parent.
    values=[str(command[0])]
    for value in command[1:]:
        value=str(value)
        if Path(value).is_absolute():
            try:value=os.path.relpath(value,ROOT)
            except ValueError:pass
        values.append(value)
    subprocess.run(values,cwd=ROOT,check=True)
run([args.node,ROOT/'native/build-web.mjs'])
shared=ROOT/'work/peer-build';bank=(shared/'bank-id.txt').read_text()
build=shared/('android-windows-'+uuid.uuid4().hex)
src=build/'src/cn/cpa26/workbook';src.mkdir(parents=True)
for original in (ROOT/'native/android/src/cn/cpa26/workbook').glob('*.java'):
    (src/original.name).write_bytes(original.read_text(encoding='utf-8').replace('BANK_PLACEHOLDER',bank).encode('utf-8'))
classes=build/'classes';classes.mkdir()
run([tools['javac'],'-J-Duser.language=en','-Xlint:-options','-source','8','-target','8','-encoding','UTF-8','-bootclasspath',tools['android_jar'],'-d',classes,*src.glob('*.java')])
run([tools['java'],'-cp',tools['d8'],'com.android.tools.r8.D8','--release','--min-api','26','--lib',tools['android_jar'],'--output',build,*classes.rglob('*.class')])
assets=build/'assets';assets.mkdir();(assets/'index.html').write_bytes((shared/'index.html').read_bytes())
unsigned=build/'unsigned.apk'
aapt2=tools.get('aapt2',str(Path(tools['aapt']).with_name('aapt2.exe')))
resources=build/'resources.zip'
run([aapt2,'compile','--dir',ROOT/'native/android/res','-o',resources])
run([aapt2,'link','-o',unsigned,'--manifest',ROOT/'native/android/AndroidManifest.xml','-A',assets,'-I',tools['android_jar'],resources])
with zipfile.ZipFile(unsigned,'a',compression=zipfile.ZIP_DEFLATED) as archive:archive.write(build/'classes.dex','classes.dex')
aligned=build/'aligned.apk';run([tools['zipalign'],'-f','4',unsigned,aligned])
output=ROOT/'downloads/peer/CPA刷题库_设备同步_Android.apk'
temporary_key=build/'signer.pk8'
try:
    temporary_key.write_bytes(key.private_bytes(serialization.Encoding.DER,serialization.PrivateFormat.PKCS8,serialization.NoEncryption()))
    run([tools['java'],'-jar',tools['apksigner'],'sign','--key',temporary_key,'--cert',cert_path,'--v1-signing-enabled','true','--v2-signing-enabled','true','--v3-signing-enabled','true','--v4-signing-enabled','false','--out',output,aligned])
    run([tools['java'],'-jar',tools['apksigner'],'verify','--verbose','--print-certs',output])
finally:
    temporary_key.unlink(missing_ok=True)
release_path=ROOT/'downloads/peer/release.json'
release=json.loads(release_path.read_text(encoding='utf-8'))
if release['bankId']!=bank:raise ValueError('Question bank changed; rebuild both installers together')
release.update(version='3.2.2',androidVersionCode=36,androidSigningCertificateSha256=cert.fingerprint(hashes.SHA256()).hex())
release['files'][output.name]={'sha256':hashlib.sha256(output.read_bytes()).hexdigest(),'bytes':output.stat().st_size}
release_path.write_bytes((json.dumps(release,ensure_ascii=False,indent=2)+'\n').encode('utf-8'))
(ROOT/'downloads/peer/SHA256SUMS.txt').write_bytes(''.join(v['sha256']+'  '+n+'\n' for n,v in release['files'].items()).encode('utf-8'))
print('Built Android 3.2.2 with the original signing certificate')
