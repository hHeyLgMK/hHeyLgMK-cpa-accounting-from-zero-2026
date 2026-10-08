"""Extract this APK's web sources into a staging directory without executing them.

Usage: python -X utf8 content/import-apk.py path/to/app.apk path/to/staging
Review and merge staged app.js; it does not include the repository's resume feature.
"""
import ast
import base64
import hashlib
import json
import re
import sys
import zipfile
from pathlib import Path

apk, out = Path(sys.argv[1]), Path(sys.argv[2])
with zipfile.ZipFile(apk) as archive:
    html_bytes = archive.read('assets/index.html')
html = html_bytes.decode('utf-8')
scripts = re.findall(r'<script>([\s\S]*?)</script>', html)
assert len(scripts) == 1, 'Expected one bundled script'
script = scripts[0]
files = {}
for filename, variable in [
    ('basic-theory.js', 'basicTheoryQuestions'),
    ('accounting-expanded.js', 'expandedAccountingQuestions'),
    ('extra-subjects.js', 'extraSubjects'),
    ('strategy.js', 'strategySubject'),
    ('question-numbers.js', 'questionNumbers'),
]:
    start = script.index('{const ' + variable) + 1
    end = script.index('\nglobalThis.__cpa_' + variable + '=', start)
    files[filename] = 'export ' + script[start:end].strip() + '\n'
start = script.index('const S=')
end = script.index('\nglobalThis.__cpa_chapters=', start)
questions = script[start:end].strip()
questions = re.sub(r'^const (chapters|questions)\s*=', r'export const \1=', questions, flags=re.M)
files['questions.js'] = "import {basicTheoryQuestions} from './basic-theory.js';\nimport {expandedAccountingQuestions} from './accounting-expanded.js';\n\n" + questions + '\n'
start = script.index('const accountingModules')
end = script.index('registerWebMCP();', start) + len('registerWebMCP();')
files['app.js'] = "import {chapters as accountingChapters, questions as accountingQuestions} from './questions.js';\nimport {extraSubjects} from './extra-subjects.js';\nimport {strategySubject} from './strategy.js';\nimport {questionNumbers} from './question-numbers.js';\n" + script[start:end].strip() + '\n'
files['app.css'] = re.search(r'<style>([\s\S]*?)</style>', html).group(1).strip() + '\n'
page = re.sub(r'<style>[\s\S]*?</style>', '<link rel="stylesheet" href="./app.css">', html, count=1)
files['index.html'] = re.sub(r'<script>[\s\S]*?</script>', '<script type="module" src="./app.js"></script>', page, count=1)
files = {name:source.encode('utf-8') for name, source in files.items()}
assets = ast.literal_eval(re.search(r'const offlineAssets=(\{[^\n]+\});', script).group(1))
for name, encoded in assets.items():
    assert Path(name).name == name and '/' not in name and '\\' not in name
    assert name.endswith(('.csv', '.md'))
    files[name] = base64.b64decode(encoded, validate=True)
out.mkdir(parents=True, exist_ok=True)
for name, data in files.items():
    (out / name).write_bytes(data)
manifest = {'apkSha256':hashlib.sha256(apk.read_bytes()).hexdigest(),
            'htmlSha256':hashlib.sha256(html_bytes).hexdigest(),
            'files':{name:hashlib.sha256(data).hexdigest() for name, data in files.items()}}
(out / 'import-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'files':len(files), 'output':str(out), 'apkSha256':manifest['apkSha256']}))
