"""Validate first-party docs, task links/statuses/cases, and the dependency DAG."""
from pathlib import Path
from urllib.parse import unquote
import json,re,sys
ROOT=Path(__file__).resolve().parents[2]
if hasattr(sys.stdout,'reconfigure'): sys.stdout.reconfigure(encoding='utf-8')
errors=[]
data=json.loads((ROOT/'docs/04-delivery/task-index.json').read_text(encoding='utf-8'))
tasks=data['tasks'];by_id={t['id']:t for t in tasks}
if len(tasks)!=len(by_id): errors.append('Duplicate task IDs')
all_cases=[]
required_headers=['Цель и контекст','Обязательное чтение','Зависимости и готовность входа','Область изменений','Пошаговое выполнение','Тест-кейсы','Критерии готовности','Откат и остановка','Команда для передачи модели']
external_doc=(ROOT/'docs/03-decisions/open-inputs.md').read_text(encoding='utf-8')
for task in tasks:
    id=task['id'];file=ROOT/task['path']
    if not file.is_file(): errors.append(f'{id}: missing card');continue
    text=file.read_text(encoding='utf-8')
    if not text.startswith(f'# {id}.'): errors.append(f'{id}: wrong title ID')
    status=re.search(r'^Status: (\S+)$',text,re.M)
    if not status or status.group(1)!=task['status']: errors.append(f'{id}: status mismatch')
    if task['status'] not in ['planned','in_progress','review','done','blocked','deferred']: errors.append(f'{id}: invalid status')
    for h in required_headers:
        if f'## {h}' not in text: errors.append(f'{id}: missing section {h}')
    cases=re.findall(r'^### (TC-[A-Z]+-\d+-\d+):',text,re.M)
    if cases!=task['test_case_ids'] or len(cases)<3: errors.append(f'{id}: cases mismatch/minimum')
    for part in re.split(r'^### TC-',text,flags=re.M)[1:]:
        for label in ['**Дано:**','**Действие:**','**Ожидается:**','**Доказательство:**']:
            if label not in part: errors.append(f'{id}: incomplete case {label}')
    all_cases.extend(cases)
    for dep in task['dependencies']:
        if dep not in by_id: errors.append(f'{id}: missing dependency {dep}')
        if dep==id: errors.append(f'{id}: self dependency')
    for rel in task['required_docs']+task['chapter_refs']:
        if not (ROOT/rel).is_file(): errors.append(f'{id}: missing context {rel}')
    for e in task['external']:
        if f'| {e} |' not in external_doc: errors.append(f'{id}: unknown external input {e}')
    if task['status']=='done' and not list((ROOT/'docs/09-evidence'/id).glob('*/report.md')):
        errors.append(f'{id}: done without report')
if len(set(all_cases))!=len(all_cases): errors.append('Duplicate test case IDs')
done=set();left=set(by_id);layers=[]
while left:
    ready=sorted(x for x in left if all(d in done for d in by_id[x]['dependencies']))
    if not ready: errors.append('Dependency cycle or unknown dependencies: '+', '.join(sorted(left)));break
    layers.append(ready);done.update(ready);left.difference_update(ready)

# External snapshots and old archival source docs retain their original links; they are not owned docs.
owned=[ROOT/'README.md',ROOT/'AGENTS.md']+list((ROOT/'docs').rglob('*.md'))
checked_links=0
for file in owned:
    rel=file.relative_to(ROOT).as_posix()
    if '/08-references/research/' in rel or '/08-references/archive/' in rel: continue
    text=re.sub(r'```.*?```','',file.read_text(encoding='utf-8'),flags=re.S)
    for target in re.findall(r'(?<!!)\[[^\]\n]+\]\(([^\n)]+)\)',text):
        target=target.strip('<>')
        if re.match(r'^(?:https?://|mailto:|#|app:|codex:)',target): continue
        pathpart=unquote(target.split('#')[0])
        if not pathpart: continue
        resolved=(file.parent/pathpart).resolve()
        checked_links+=1
        if not resolved.exists(): errors.append(f'{rel}: broken local link {target}')
catalog=(ROOT/'docs/05-quality/test-catalog.md').read_text(encoding='utf-8')
for tc in all_cases:
    if f'| {tc} |' not in catalog: errors.append('Missing test catalog case '+tc)
summary={'result':'fail' if errors else 'pass','tasks':len(tasks),'base_release':sum(t['scope']=='base-release' for t in tasks),'optional_wallet':sum(t['scope']=='optional-wallet' for t in tasks),'future':sum(t['scope']=='future' for t in tasks),'test_cases':len(all_cases),'dependency_layers':len(layers),'local_links_checked':checked_links,'ready_by_recorded_status':[t['id'] for t in tasks if t['status']=='planned' and all(by_id[d]['status']=='done' for d in t['dependencies'])],'errors':errors,'claim_boundary':'Documentation structure only; no application, provider, FPS, resource or deployment tests executed.'}
print(json.dumps(summary,ensure_ascii=False,indent=2))
sys.exit(1 if errors else 0)
