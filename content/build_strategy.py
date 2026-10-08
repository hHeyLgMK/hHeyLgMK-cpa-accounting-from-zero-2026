"""Build the imported strategy bank and stable display-number map."""
import csv
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / 'dist'
subject = json.loads((HERE / 'supplemental/strategy.json').read_text(encoding='utf-8'))
numbers = json.loads((HERE / 'question-numbers.json').read_text(encoding='utf-8'))
subject['questions'] = [q for chapter in subject['chapters'] for q in chapter['items']]
ids = set()
rows, coverage = [], []
for q in subject['questions']:
    assert q['id'] not in ids, q['id']
    ids.add(q['id'])
    assert q['stem'] and q['explain'] and q['knowledgePoint'], q['id']
    if q['type'] == 'written':
        assert q['sample'], q['id']
        answer = q['sample']
    else:
        assert len(q['options']) == 4 and len(set(q['options'])) == 4, q['id']
        indices = [q['answer']] if q['type'] == 'single' else q['answer']
        assert indices and all(isinstance(i, int) and 0 <= i < 4 for i in indices), q['id']
        answer = '、'.join('ABCD'[i] for i in indices)
    module = next(name for name, chapters in subject['modules'] if q['chapterIndex'] + 1 in chapters)
    source = q['source']
    number = numbers['strategy'][q['id']]
    kind = {'single':'单选', 'multi':'多选', 'written':'简答应用'}[q['type']]
    edition = q.get('edition', '起步题')
    rows.append([number, module, source['chapter'], q['studySection'], q['knowledgePoint'],
                 kind, q['stem'], *(q.get('options') or [''] * 4), answer, q['explain'],
                 source['printedPage'], source['pdfPage'], source.get('note', ''), edition, q['id']])
    coverage.append([module, q['chapterIndex'] + 1, q['chapterTitle'], q['studySection'],
                     q['knowledgePoint'], number, kind, edition, source['printedPage'], source['pdfPage'], q['id']])
assert subject['coverage']['totalQuestions'] == len(ids)
# Retain the APK's export field order for readable diffs.
subject = {key:subject[key] for key in ['name', 'modules', 'chapters', 'questions', 'coverage']}
(OUT / 'strategy.js').write_text('export const strategySubject = ' + json.dumps(subject, ensure_ascii=False, indent=2) + ';\n', encoding='utf-8')
(OUT / 'question-numbers.js').write_text('export const questionNumbers = ' + json.dumps(numbers, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
for name, header, values in [
    ('strategy-questions.csv', ['题号','学习模块','章节','知识节','知识点','题型','题目','A','B','C','D','答案','解析','教材页码','PDF页码','定位说明','题目批次','原题号'], rows),
    ('strategy-coverage.csv', ['学习模块','章序','章名','知识节','知识点','对应题号','题型','题目批次','教材页码','PDF页码','原题号'], coverage),
]:
    with (OUT / name).open('w', encoding='utf-8-sig', newline='') as f:
        writer = csv.writer(f, lineterminator='\n')
        writer.writerow(header)
        writer.writerows(values)
print(json.dumps({'strategyQuestions':len(ids), 'numberMappings':sum(len(v) for v in numbers.values())}))
