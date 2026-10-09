import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const dir=path.join(root,'web'),out=path.join(root,'../work/peer-build');
fs.mkdirSync(out,{recursive:true});
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const wrap=(name,bindings)=>'(()=>{'+read(name).replace(/^import .*;\n/gm,'').replace(/^export /gm,'')+'\nreturn {'+bindings+'};})()';
const files=['basic-theory.js','accounting-expanded.js','questions.js','extra-subjects.js','strategy.js','question-numbers.js'];
const bankId=createHash('sha256').update(files.map(read).join('\n')).digest('hex');
let scripts=[
  'const {basicTheoryQuestions}='+wrap('basic-theory.js','basicTheoryQuestions')+';',
  'const {expandedAccountingQuestions}='+wrap('accounting-expanded.js','expandedAccountingQuestions')+';',
  'const {chapters:accountingChapters,questions:accountingQuestions}='+wrap('questions.js','chapters,questions')+';',
  'const {extraSubjects}='+wrap('extra-subjects.js','extraSubjects')+';',
  'const {strategySubject}='+wrap('strategy.js','strategySubject')+';',
  'const {questionNumbers}='+wrap('question-numbers.js','questionNumbers')+';',
  'const {createPeerSync}='+wrap('peer-sync.js','createPeerSync')+';',
  read('app.js').replace(/^import .*;\n/gm,'').replaceAll('BANK_PLACEHOLDER',bankId)
].join('\n');
const downloads={};for(const name of fs.readdirSync(dir).filter(n=>/\.(csv|md)$/.test(n)))downloads[name]=Buffer.from(read(name)).toString('base64');
scripts+='\nconst offlineAssets='+JSON.stringify(downloads)+';\ndocument.addEventListener("click",e=>{const a=e.target.closest("a[download]");if(!a)return;const n=a.getAttribute("href").replace(/^\\.\\//,"");if(!offlineAssets[n])return;e.preventDefault();const u=URL.createObjectURL(new Blob([Uint8Array.from(atob(offlineAssets[n]),c=>c.charCodeAt(0))],{type:"text/plain;charset=utf-8"}));const link=document.createElement("a");link.href=u;link.download=n;link.click();setTimeout(()=>URL.revokeObjectURL(u),60000);},true);';
const html=read('index.html').replace('<link rel="stylesheet" href="./app.css">',()=>'<style>'+read('app.css')+'</style>').replace('<script type="module" src="./app.js"></script>',()=>'<script>'+scripts.replace(/<\/script/gi,'<\\/script')+'</script>');
fs.writeFileSync(path.join(out,'index.html'),html);fs.writeFileSync(path.join(out,'CPAPeer.html.gz'),gzipSync(html,{level:9}));fs.writeFileSync(path.join(out,'bank-id.txt'),bankId);console.log(JSON.stringify({bankId,htmlBytes:Buffer.byteLength(html)}));
