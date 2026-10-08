import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.resolve(process.argv[2] || path.join(root,'work','windows-build'));
const dist = path.join(root,'dist');
const read = name => fs.readFileSync(path.join(dist,name),'utf8');
function moduleBody(name) {
  return read(name).replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
}
function wrap(name, bindings) {
  return '(() => {\n'+moduleBody(name)+'\nreturn {'+bindings+'};\n})()';
}
const scripts = [
  "const {basicTheoryQuestions} = "+wrap('basic-theory.js','basicTheoryQuestions')+';',
  "const {expandedAccountingQuestions} = "+wrap('accounting-expanded.js','expandedAccountingQuestions')+';',
  "const {chapters:accountingChapters, questions:accountingQuestions} = "+wrap('questions.js','chapters,questions')+';',
  "const {extraSubjects} = "+wrap('extra-subjects.js','extraSubjects')+';',
  "const {readProgress,writeProgress} = "+wrap('progress.js','readProgress,writeProgress')+';',
  moduleBody('app.js')
].join('\n');
const downloads = {};
for (const name of fs.readdirSync(dist).filter(n => /\.(csv|md)$/.test(n))) {
  downloads[name] = fs.readFileSync(path.join(dist,name)).toString('base64');
}
const downloadScript = String.raw`
const offlineDownloads = ${JSON.stringify(downloads)};
const offlineURLs = {};
for (const [name,encoded] of Object.entries(offlineDownloads)) {
  const bytes = Uint8Array.from(atob(encoded), c => c.charCodeAt(0));
  offlineURLs[name] = URL.createObjectURL(new Blob([bytes],{type:'text/plain;charset=utf-8'}));
}
function offlineLink(link) {
  const name = link.getAttribute('href')?.replace(/^\.\//,'');
  if (offlineURLs[name]) { link.href=offlineURLs[name]; link.download=name; }
}
document.querySelectorAll('a[download]').forEach(offlineLink);
document.addEventListener('click', event => {
  const link = event.target.closest('a[download]');
  if (link) offlineLink(link);
},true);
`;
// Inline every module and download: opening the EXE needs no HTTP server.
const html = read('index.html')
  .replace('<link rel="stylesheet" href="./app.css">',() => '<style>'+read('app.css')+'</style>')
  .replace('<script type="module" src="./app.js"></script>',
    () => '<script>\n'+(scripts+'\n'+downloadScript).replace(/<\/script/gi,'<\\/script')+'\n</script>');
if (/\b(?:import|export)\s+(?:const|\{|\*)/.test(scripts)) throw Error('Unbundled module declaration');
fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(path.join(out,'CPA_Accounting_Offline.html'),html);
fs.writeFileSync(path.join(out,'CPAOffline.html.gz'),gzipSync(Buffer.from(html),{level:9}));
console.log(JSON.stringify({html:path.join(out,'CPA_Accounting_Offline.html'),bytes:Buffer.byteLength(html),
  payloadBytes:fs.statSync(path.join(out,'CPAOffline.html.gz')).size}));
