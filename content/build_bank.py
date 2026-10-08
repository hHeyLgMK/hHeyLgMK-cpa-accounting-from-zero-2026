"""Build the four-subject bank and inspectable section/topic coverage. Accounting is untouched."""
import csv, json, re, hashlib
from pathlib import Path
from collections import Counter
from catalog import CATALOG
from expansion.sections import SECTIONS
HERE=Path(__file__).resolve().parent
OUT=HERE.parent/'dist'
BANK=json.loads((HERE/'seed-bank.json').read_text())
NUMBERS=json.loads((HERE/'question-numbers.json').read_text())
SUPPLEMENTS=json.loads((HERE/'supplemental'/'tax-questions.json').read_text())
OFFICIAL='https://fgk.chinatax.gov.cn/zcfgk/c100012/c5240851/content.html'
LAST={'law':600,'finance':523,'tax':695,'audit':693}
def pdfpage(key,page):
    if key=='tax':
        assert page not in (628,629), 'Missing scanned pages cannot be cited'
        return page+(7 if page>=630 else 9)
    return page+CATALOG[key]['offset']
def range_text(a,b):return str(a) if a==b else f'{a}—{b}'
def page_source(key,ci,si):
    sections=SECTIONS[key][ci];sec=sections[si];start=sec['page']
    end=(sections[si+1]['page'] if si+1<len(sections) else CATALOG[key]['chapters'][ci+1][1] if ci+1<len(CATALOG[key]['chapters']) else LAST[key]+1)-1
    end=max(start,end)
    printed=range_text(start,end)
    if key=='tax' and start<=628<=end:printed=f'{start}、630—{end}（628—629缺页）'
    return dict(book=f'2026年注册会计师全国统一考试辅导教材《{CATALOG[key]["name"]}》',chapter=f'第{ci+1}章 {CATALOG[key]["chapters"][ci][0]}',section=sec['label'],printedPage=printed,pdfPage=range_text(pdfpage(key,start),pdfpage(key,end)),locationGranularity='section',note='标注为所属知识节的阅读范围，不是逐题精确页码。')
coverage=[]; allrows=[]; ids=set();summary={}
for key,subject in BANK.items():
    for ci,ch in enumerate(subject['chapters']):
        ch['sections']=SECTIONS[key][ci]
        for q in ch['items']:
            q['studySection']=SECTIONS[key][ci][0]['label']
            q['sectionNumber']=1
            q['edition']='原有起步题'
    current=None;ordinal=Counter();seen=[]
    for lineno,line in enumerate((HERE/'expansion'/f'{key}.txt').read_text().splitlines(),1):
        if not line.strip():continue
        if line.startswith('@'):
            ci,si=[int(n)-1 for n in line[1:].split('.')];current=(ci,si);seen.append(current);continue
        assert current is not None
        fields=line.split('|');assert len(fields)==4,(key,lineno)
        topic,stem,sample,explain=fields
        assert all(fields),(key,lineno)
        ci,si=current;ordinal[current]+=1
        source=page_source(key,ci,si)
        if '【官方补充】' in topic:
            topic=topic.replace('【官方补充】','')
            source.update(book='国家税务总局公告2025年第12号《纳税缴费信用管理办法》',printedPage='',pdfPage='',locationGranularity='official',url=OFFICIAL,note='教材扫描第628—629页缺失；本题以官方原文补充，不标注不存在的PDF页码。')
        q=dict(id=f'{key}-full-{ci+1:02d}-{si+1:02d}-{ordinal[current]:03d}',chapterIndex=ci,chapterTitle=subject['chapters'][ci]['title'],studySection=SECTIONS[key][ci][si]['label'],sectionNumber=si+1,knowledgePoint=topic,type='written',stem=stem,sample=sample,explain=explain,level='基础理解与应用',source=source,edition='逐节扩充题')
        subject['chapters'][ci]['items'].append(q)
    expected=[(ci,si) for ci,ch in enumerate(SECTIONS[key]) for si in range(len(ch))]
    assert sorted(seen)==expected,(key,'missing/duplicate section',set(expected)-set(seen))
    supplements=SUPPLEMENTS if key=='tax' else []
    for q in supplements:
        assert q['studySection']==SECTIONS[key][q['chapterIndex']][q['sectionNumber']-1]['label']
        subject['chapters'][q['chapterIndex']]['items'].append(q)
    subject['questions']=[q for ch in subject['chapters'] for q in ch['items']]
    subject['coverage']={'chapters':len(subject['chapters']),'sections':len(expected),'coveredSections':len(seen),'addedQuestions':sum(ordinal.values())+len(supplements),'totalQuestions':len(subject['questions']),'coverageBasis':'教材目录逐节覆盖；知识点按清单核对，不等于穷尽全部条款、例外与综合题。'}
    for ci,ch in enumerate(subject['chapters']):
        for si,sec in enumerate(ch['sections']):
            qs=[q for q in ch['items'] if q['sectionNumber']==si+1]
            pts=list(dict.fromkeys(q['knowledgePoint'] for q in qs))
            coverage.append({'subject':key,'subjectName':subject['name'],'module':next(m[0] for m in subject['modules'] if ci+1 in m[1]),'chapter':ci+1,'chapterTitle':ch['title'],'section':sec['label'],'sectionNumber':si+1,'questions':len(qs),'addedQuestions':sum(q['edition']!='原有起步题' for q in qs),'knowledgePoints':pts,'questionIds':[q['id'] for q in qs],'source':page_source(key,ci,si)})
        ch['coverage']={'sections':len(ch['sections']),'points':len(set((q['sectionNumber'],q['knowledgePoint']) for q in ch['items'])),'questions':len(ch['items'])}
    subject['coverage']['knowledgePoints']=sum(ch['coverage']['points'] for ch in subject['chapters'])
    rows=[]
    for q in subject['questions']:
        assert q['id'] not in ids;ids.add(q['id'])
        assert q['explain'] and q['knowledgePoint']
        if q.get('options'):
            assert len(q['options'])==4
            assert all(0<=n<4 for n in ([q['answer']] if q['type']=='single' else q['answer']))
        else:assert q['sample']
        mod=next(m[0] for m in subject['modules'] if q['chapterIndex']+1 in m[1])
        ans=q.get('sample') or ('ABCD'[q['answer']] if q['type']=='single' else '、'.join('ABCD'[i] for i in q['answer']))
        number=NUMBERS[key][q['id']]
        rows.append([number,subject['name'],mod,q['source']['chapter'],q['studySection'],q['knowledgePoint'],q['level'],{'single':'单选','multi':'多选','written':'简答应用'}[q['type']],q['stem'],*(q.get('options') or ['']*4),ans,q['explain'],q['source']['printedPage'],q['source']['pdfPage'],q['source']['book'],q['source'].get('url',''),q['source'].get('note',''),q['edition'],q['id']])
        allrows.append([subject['name'],mod,q['chapterIndex']+1,q['chapterTitle'],q['studySection'],q['knowledgePoint'],number,q['edition'],q['source']['printedPage'],q['source']['pdfPage'],q['source']['book'],q['source'].get('url',''),q['id']])
    with (OUT/f'{key}-questions.csv').open('w',encoding='utf-8-sig',newline='') as f:
        w=csv.writer(f,lineterminator="\n");w.writerow(['题号','科目','学习模块','章','节','知识点','难度','题型','题目','A','B','C','D','答案','解析','教材页码','PDF页码','来源','来源链接','定位说明','题目批次','原题号']);w.writerows(rows)
    summary[key]=subject['coverage']
(OUT/'extra-subjects.js').write_text('export const extraSubjects = '+json.dumps(BANK,ensure_ascii=False,indent=2)+';\n')
(OUT/'coverage.json').write_text(json.dumps({'summary':summary,'sections':coverage},ensure_ascii=False,indent=2))
with (OUT/'knowledge-points.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f,lineterminator="\n");w.writerow(['科目','学习模块','章序','章名','知识节','知识点','对应题号','题目批次','教材阅读范围','PDF阅读范围','来源名称','来源链接','原题号']);w.writerows(allrows)
lines=['# CPA 四科学习模块与知识点清单','',
'依据用户提供的 2026 年《经济法》《财务成本管理》《税法》《审计》教材目录和正文编排。会计题库本轮不改动。',
'',f'四科共 70 章、340 节、{sum(s["totalQuestions"] for s in summary.values())} 道题，其中本轮新增 {sum(s["addedQuestions"] for s in summary.values())} 道。新增题以简答、辨析和计算为主，均有参考答案与解析；保留原有单选、多选和简答题。','',
'覆盖口径：340 节均有练习题，下面列出每节实际涉及的知识点。目录逐节覆盖不等于已经穷尽每条细则、所有例外、例题或跨章综合考法；请按清单检查具体覆盖内容。','',
'来源口径：新增题标注所属知识节的教材与 PDF 阅读范围，供回查使用，不冒充逐题精确页码；原有起步题保留原标注。税法扫描缺少印刷页 628—629，第 630 页起 PDF 页码偏移由 +9 改为 +7。相关信用等级题用官方文件补充，并单独列明来源。',
'',f'官方补充：[国家税务总局公告2025年第12号《纳税缴费信用管理办法》]({OFFICIAL})。','',
'## 练习方式','',
'- 章节学习默认显示当前章全部题目，可切换知识节。简答题对照答案后自评。',
'- 模拟为 45 分钟、20 题（10 单选、5 多选、5 简答），用于短练，不代表正式考试题型比例、时长和难度。',
'- 错题连续答对 3 次移出。科目切换保留本次未完成练习并暂停模拟计时；刷新或重新打开后继续上次作答，已提交学习记录保留在本浏览器。',
'- 每科可下载题库 CSV；知识点 CSV 提供知识点到题号的逐题映射。','',
'## 四科规模','', '|科目|章节|知识节|知识点条目（按节去重）|题目|本轮新增|','|---|---:|---:|---:|---:|---:|']
for key,s in BANK.items():
    c=s['coverage'];lines.append(f'|{s["name"]}|{c["chapters"]}|{c["sections"]}|{c["knowledgePoints"]}|{c["totalQuestions"]}|{c["addedQuestions"]}|')
for key,s in BANK.items():
    lines+=['',f'## {s["name"]}','','|学习模块|对应章节|','|---|---|']
    for name,nums in s['modules']:lines.append('|'+name+'|'+'；'.join(f'第 {n} 章 {s["chapters"][n-1]["title"]}' for n in nums)+'|')
    for ci,ch in enumerate(s['chapters']):
        lines+=['',f'### 第 {ci+1} 章 {ch["title"]}','', '|知识节|题数|实际知识点|教材 / PDF 阅读范围|','|---|---:|---|---|']
        for row in [r for r in coverage if r['subject']==key and r['chapter']==ci+1]:
            lines.append(f'|{row["section"]}|{row["questions"]}|'+ '；'.join(row['knowledgePoints'])+f'|{row["source"]["printedPage"]} / {row["source"]["pdfPage"]}|')
(OUT/'study-guide.md').write_text('\n'.join(lines)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
