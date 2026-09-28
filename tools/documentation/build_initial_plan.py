"""One-time assembly of the v0.3 documentation pack. Refuses to overwrite task cards."""
from pathlib import Path
import json, re, shutil
from seed_task_details import TASKS
import seed_identity_notifications, seed_payments, seed_admin_ops, seed_hermes_release

ROOT = Path(__file__).resolve().parents[2]
LEGACY = Path(r'C:\Users\working\Desktop\outegro\planning')
DOCS = ROOT / 'docs'
if (DOCS/'04-delivery/task-index.json').exists():
    raise SystemExit('Initial pack already exists. Edit the canonical Markdown and task-index.json; do not regenerate over implementation edits.')

def put(rel, text):
    p = ROOT / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text.rstrip()+'\n', encoding='utf-8')

def link_from(src, target):
    import os
    return Path(os.path.relpath(ROOT/target, (ROOT/src).parent)).as_posix()

rows = {}
for name in ['14-atomic-roadmap.md','11-hermes-agent.md']:
    for line in (LEGACY/'chapters'/name).read_text(encoding='utf-8').splitlines():
        cells=[c.strip() for c in line.strip('|').split('|')]
        if cells and re.fullmatch(r'(?:L|DS|BE|ID|N|PAY|A|OPS|H|R|NEXT)-\d+', cells[0]):
            rows[cells[0]]={'title':cells[1], 'old_acceptance':cells[3] if len(cells)>3 else ''}
for id, title in {
 'BOOT-01':'Независимый корень и Git hygiene','BOOT-02':'Инвентаризация повторного использования',
 'BOOT-03':'Frontend workspace без backend зависимости','BOOT-04':'Рабочие команды и test harness',
 'W-01':'Схема wallet и double-entry ledger','W-02':'Подтверждённое пополнение','W-03':'Reserve, capture и release',
 'W-04':'Возвраты, reversal и debt','W-05':'Wallet UI и admin commands','W-06':'Wallet concurrency и reconciliation acceptance'
}.items(): rows[id]={'title':title,'old_acceptance':''}
assert set(rows)==set(TASKS), (set(rows)-set(TASKS),set(TASKS)-set(rows))

STAGES={
 '00-preparation':('Подготовка рабочего проекта',['BOOT'],'Создать независимый workspace, inventoried reuse и реальные команды проверки. Код backend пока не обновлять.'),
 '01-landing-design':('Лендинг и дизайн-система',['L','DS'],'Создать EN/RU landing и серебряную сцену с измеряемым качеством. Завершить Gate A до платформенной реализации.'),
 '02-backend-foundation':('Backend, Drizzle и доставка событий',['BE'],'Проверить совместимость, разделить DB roles, реализовать contracts/outbox/inbox до бизнес-сервисов.'),
 '03-identity':('Identity и доступы',['ID'],'Реализовать вход/сессии/SSO/permissions. ID-08 ждёт Payments; глава не означает линейную независимость от соседних этапов.'),
 '04-notifications':('Notifications',['N'],'Создать приватную auth delivery, обычные каналы и inbox. Billing templates завершаются после соответствующих events Payments.'),
 '05-payments':('Payments, Lava и subscriptions',['PAY'],'От API fixtures перейти к idempotent checkout, журналу, grants, подпискам и проверке merchant. Продажи отдельно от готовности кода.'),
 '06-admin':('Административная панель',['A'],'Дать владельцу поиск, диагностику цепочек и контролируемые domain commands с permission/reason/audit.'),
 '07-operations':('K3s и эксплуатация',['OPS'],'Один VPS, GitOps, data persistence, наблюдаемость, backup/restore. OPS-08 ждёт весь P0 stack, включая Hermes.'),
 '08-hermes':('Личный Hermes и каталог',['H'],'Plus route, private topics, typed catalog tools, фото и drafts. Full-stack resource test выполняется затем в OPS-08.'),
 '09-release':('Интеграция и production',['R'],'Связать UI и сервисы, пройти failure E2E, readiness, deploy и post-release review.'),
 '10-future':('Будущие приложения',['NEXT'],'После первого production собрать отдельное ТЗ Battleship. Не реализовывать игру в рамках текущего плана.'),
 '90-optional-wallet':('Условный этап wallet',['W'],'Не выполнять до явного выбора владельца и проверки merchant. Расширяет базовый scope и оценку.')
}
GROUPS={
 'BOOT':([0,3],['apps/','packages/','infra/local/','package.json','pnpm-workspace.yaml'],['http-errors'], 'Не копировать старые secrets/data/.git или ненужные приложения. Не настраивать production remote по догадке.'),
 'L':([0,1,2],['apps/landing-web/','packages/ui/'],['design-i18n'], 'Не добавлять pricing/фиктивные кейсы и не переписывать auth/payment backend ради лендинга.'),
 'DS':([1,2],['packages/ui/','apps/*-web/ (только gallery/shell)'],['design-i18n'], 'Не создавать независимые токены в каждом app; не маскировать недоступное действие только декоративной кнопкой.'),
 'BE':([3,8],['apps/*-backend/db/','packages/contracts/','packages/testkit/','infra/local/'],['http-errors','events','deployment'], 'Не мигрировать старые данные. Не создавать general repository с доступом ко всем logical DB.'),
 'ID':([4,8],['apps/auth-backend/src/','apps/auth-backend/db/','apps/id-web/','packages/contracts/'],['identity-access','http-errors','events'], 'Не выдавать роль по покупке, не отключать проверки reuse/CSRF/ownership и не называть неполный flow OIDC.'),
 'N':([5,8],['apps/notifications-backend/','apps/id-web/ (inbox/preferences)','packages/contracts/'],['notifications','http-errors','events'], 'Не логировать login code; не откатывать payment из-за недоставленного сообщения; не обещать exactly-once внешнего send.'),
 'PAY':([6,8],['apps/payments-backend/','apps/pay-web/','packages/contracts/','tests/fixtures/lava/'],['billing','http-errors','events'], 'Не доверять browser amount/status; не угадывать refund source; не вызывать реальное списание из обычного CI.'),
 'A':([7,4,6],['apps/admin-backend/','apps/admin-web/','packages/contracts/'],['identity-access','http-errors','billing'], 'Не читать соседние DB напрямую, не давать SQL/secret editor/impersonation, не заменять audit проекцией без source record.'),
 'OPS':([9,10],['infra/gitops/','infra/local/','apps/*/ (instrumentation/config)','docs/06-operations/'],['deployment','events'], 'Не применять manifests к legacy VPS; не добавлять второй node; не считать backup job success доказательством restore.'),
 'H':([11],['infra/agents/hermes/','apps/assistant-store/','packages/contracts/','tests/fixtures/assistant/'],['assistant','http-errors','deployment'], 'Не передавать agent платные fallback keys, host socket/kubeconfig и platform secrets; не считать chat name authority.'),
 'R':([12,15],['tests/e2e/','infra/gitops/ (release values)','apps/*-web/ (integration)','docs/09-evidence/'],['deployment','invariants'], 'Не переключать scope незаметно, не считать fixture real-provider проверкой и не deploy-ить только потому, что существует план.'),
 'NEXT':([13],['docs/ (будущий game brief)'],['invariants'], 'Не писать игровой код/правила/монетизацию до отдельного brief.'),
 'W':([6,7],['apps/payments-backend/ (wallet)','apps/pay-web/','apps/admin-web/','packages/contracts/'],['billing','http-errors','events'], 'Не включать scope молча. Не создавать P2P/withdrawal и не заменять ledger колонкой balance.')
}

# Bring the audited narrative across without importing any production credentials or source code.
chapters=[]
for f in sorted((LEGACY/'chapters').glob('*.md')):
    target=DOCS/'01-specification/chapters'/f.name
    text=f.read_text(encoding='utf-8').replace('Версия 0.2 ·','Версия 0.3 ·')
    if f.name.startswith('14-'):
        put('docs/08-references/archive/roadmap-v0.2.md',text)
        continue
    notice='> Версия 0.3: детальные действия, зависимости и test cases находятся в [карточках задач](../../04-delivery/README.md). Эта глава задаёт предметный контекст.\n\n'
    first,body=text.split('\n',1)
    put(target.relative_to(ROOT),first+'\n\n'+notice+body.lstrip())
    chapters.append((f.name,first.removeprefix('# ')))

refdir=DOCS/'08-references/research'; refdir.mkdir(parents=True,exist_ok=True)
safe=['package-versions.json','lava-openapi-2026-09-27.yaml','hermes-codex-runtime.md','hermes-docker.md','hermes-telegram.md',
 'lisa-clean.png','lisa-locomotive-ca-motion.png','lisa-locomotive-ca-mobile.png','boc-studio-desktop.png','boc-studio-scroll.png','boc-studio-scroll2.png','boc-studio-mobile.png',
 'bleibtgleich-dev-desktop.png','bleibtgleich-dev-motion.png','bleibtgleich-dev-mobile.png','1minus1-hero-settled.png','1minus1-com-scroll2.png','1minus1-mobile-settled.png']
for name in safe: shutil.copy2(LEGACY/'research'/name,refdir/name)
reference=(LEGACY/'reference-review.md').read_text(encoding='utf-8')
put('docs/08-references/reference-review.md',reference)
pres=DOCS/'08-references/presentations';pres.mkdir(parents=True,exist_ok=True)
shutil.copy2(LEGACY/'output/nick-lukashik-portfolio-v0.2-reviewed.pptx',pres/'portfolio-overview-v0.2.pptx')

index=[]
for id in TASKS:
    prefix=id.split('-')[0]
    stage=next(s for s,v in STAGES.items() if prefix in v[1])
    index.append({'id':id,'title':rows[id]['title'],'stage':stage,'status':'deferred' if prefix=='W' else 'planned',
      'scope':'optional-wallet' if prefix=='W' else 'future' if prefix=='NEXT' else 'base-release',
      'path':f'docs/04-delivery/{stage}/tasks/{id}.md', **TASKS[id]})
lookup={r['id']:r for r in index}

# Topological order is authoritative; stage numbers are grouping, not a false linear dependency.
order=[];left=set(lookup)
while left:
    ready=sorted(x for x in left if all(d in order for d in lookup[x]['dependencies']))
    if not ready: raise RuntimeError('Dependency cycle/missing ID: '+repr(left))
    order.extend(ready);left.difference_update(ready)
rank={id:i+1 for i,id in enumerate(order)}
index.sort(key=lambda r:rank[r['id']])

rollback={
 'UI':'Откатить конкретный app/shared UI diff к совместимой версии. Проверить потребителей общего package. Не удалять evidence прежнего измерения; новый профиль измеряется заново.',
 'DATA':'После появления данных не выполнять destructive down migration ради отката приложения. Проверить N/N-1 совместимость; использовать forward-fix. Финансовые/audit записи сохраняются, коррекция отдельной командой.',
 'OPS':'Остановить неуспешный rollout на согласованном target. Вернуть совместимый image/values либо выполнить forward-fix. Не удалять PVC/keys и не применять recovery к старому VPS.',
 'DOC':'Откатить только относящийся к задаче diff; сохранить пользовательские файлы и исследовательское evidence.'
}
test_catalog=['# Каталог test cases\n\nЭто план проверок, не результаты запусков. Источник конкретного сценария — task card.\n\n| TC-ID | Задача | Сценарий |\n|---|---|---|']
for r in index:
    id=r['id']; prefix=id.split('-')[0]; nums,paths,contracts,boundary=GROUPS[prefix]
    file=r['path']; rel=lambda p:link_from(file,p)
    required=['docs/00-start-here/project-context.md','docs/00-start-here/execution-protocol.md']+[f'docs/02-contracts/{x}.md' for x in contracts]
    r['required_docs']=required
    r['chapter_refs']=[f'docs/01-specification/chapters/{next(f.name for f in (LEGACY/"chapters").glob(f"{n:02d}-*.md"))}' for n in nums]
    dep='\n'.join(f'- [{d}]({rel(lookup[d]["path"])}) — {lookup[d]["title"]}; проверить actual report.' for d in r['dependencies']) or '- Hard dependencies отсутствуют. Работать только в новом корне.'
    ext='\n'.join(f'- `{x}`: см. [входные данные]({rel("docs/03-decisions/open-inputs.md")}). Fake часть допустима отдельно; external acceptance не отмечать pass.' for x in r['external']) or '- Специальные внешние входные данные для этой карточки не требуются; общий provider/environment context наследуется от зависимостей.'
    mandatory='\n'.join(f'- [{Path(p).stem}]({rel(p)})' for p in required)
    chapterlinks='\n'.join(f'- [Глава {n}]({rel(p)}) — читать связанные разделы при необходимости подробного предметного контекста.' for n,p in zip(nums,r['chapter_refs']))
    steps='\n'.join(f'{i}. {s}. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.' for i,s in enumerate(r['steps'],1))
    cases=[]
    ids=[]
    for i,(name,setup,action,expected) in enumerate(r['tests'],1):
        tc=f'TC-{id}-{i:02d}';ids.append(tc)
        cases.append(f'### {tc}: {name}\n\n- **Дано:** {setup}.\n- **Действие:** {action}.\n- **Ожидается:** {expected}.\n- **Доказательство:** записать фактическое состояние/response/DB assertion или screenshot в test report. Для негативного сценария проверить также отсутствие запрещённого side effect.\n- **Стартовый статус:** not-run.\n')
        test_catalog.append(f'| {tc} | [{id}]({link_from("docs/05-quality/test-catalog.md",file)}) | {name} |')
    r['test_case_ids']=ids
    rb=rollback['UI' if prefix in ['L','DS'] else 'OPS' if prefix=='OPS' else 'DOC' if prefix in ['BOOT','NEXT'] else 'DATA']
    card=f'''# {id}. {r['title']}

Status: {r['status']}
Scope: {r['scope']}
Stage: {r['stage']}

## Цель и контекст

{r['context']}

Задача будущей реализации. Наличие этой карточки не означает, что код/сервисы уже существуют. Выполнять одну карточку, при необходимости передавать её по checkpoints. Соседний незакрытый контракт нельзя заменить догадкой.

## Обязательное чтение

{mandatory}

### Предметная спецификация

{chapterlinks}

## Зависимости и готовность входа

{dep}

В начале прочитать отчёты зависимостей и проверить артефакты. `planned` не равно готово. При несовпадении фактического кода с отчётом записать конфликт, не продолжать зависимую mutation вслепую.

### Внешние inputs

{ext}

## Область изменений

Будущие пути относительно корня проекта (не утверждение о текущем существовании):

{chr(10).join('- `'+p+'`' for p in paths)}

Прочитать [карту legacy/new]({rel('docs/00-start-here/repository-map.md')}) перед переносом. Сначала `rg --files` и чтение существующего кода. Если точного файла ещё нет, создать минимальный модуль в этой области и записать выбранное имя в отчёте. Не создавать два параллельных модуля для одного use case.

**Вне scope:** {boundary}

## Пошаговое выполнение

### C1. Подготовить контракт и проверку

Записать input/output, ожидаемые ошибки, затронутый инвариант, файлы и способ проверки. Для поведения использовать meaningful failing case/fixture; для визуального решения — конкретный preview; для документации — source comparison. Проверить реальные package scripts через [command map]({rel('docs/05-quality/command-map.md')}).

### C2. Реализовать ограниченный результат

{steps}

### C3. Проверить

Пройти все TC этой карточки. Важен конечный business state, а не только HTTP 200. Для изменённого shared contract запустить проверки его consumers. Не заменять реальные DB concurrency tests моками. Все обращения к внешним provider в обычном CI — fake; real-provider evidence отдельно. Прочитать diff на secrets/лишние изменения.

### C4. Передать результат

Сохранить [task report]({rel('docs/07-templates/task-report.md')}) в `docs/09-evidence/{id}/<run-id>/report.md`: изменённые файлы, commit, команды, TC status, ограничения и resume point. Обновить status карточки и task-index.json согласованно. Если осталось обязательное blocked/not-run, task не done.

## Тест-кейсы

{chr(10).join(cases)}

## Критерии готовности

- [ ] Входные dependencies подтверждены фактическими артефактами.
- [ ] Все четыре предметных шага C2 выполнены, выбранные значения/контракты записаны.
- [ ] Все обязательные TC имеют pass с evidence, внешние проверки не подменены fixture.
- [ ] Видимые UI/errors/messages имеют EN/RU, если задача их меняет.
- [ ] Logs/audit содержат нужный correlation/result без секретов.
- [ ] Обновлены относящиеся contracts/runbooks/command map; лишний scope не добавлен.
- [ ] Отчёт объясняет ограничения, rollback и следующий task/checkpoint.

## Откат и остановка

{rb}

Если источник API/поведение провайдера неизвестен — выполнить документационный lookup по AGENTS.md и зафиксировать результат. Если требуется отсутствующий input — завершить независимую часть, оставить конкретный blocked TC и handoff. Не закрывать задачу обещанием «проверим позже».

## Команда для передачи модели

```text
Выполни только {id} в этом репозитории. Прочитай AGENTS.md и карточку задачи.
Проверь hard dependencies и обязательные контракты. Иди по C1–C4 и test cases.
Не расширяй scope, не меняй старый проект, не объявляй непроверенное успешным.
Сохрани report с точным resume point, если остановишься до завершения.
```
'''
    put(file,card)

# Store only execution metadata, not a second editable copy of the prose.
public_index=[]
for r in index:
    public_index.append({k:r[k] for k in ['id','title','stage','status','scope','path','dependencies','external','required_docs','chapter_refs','test_case_ids']})
put('docs/04-delivery/task-index.json',json.dumps({'version':'0.3','status_note':'All implementation work is planned; docs generated is not task done.','tasks':public_index},ensure_ascii=False,indent=2))
put('docs/05-quality/test-catalog.md','\n'.join(test_catalog))

for stage,(title,prefixes,context) in STAGES.items():
    here=f'docs/04-delivery/{stage}/README.md'; stage_tasks=[r for r in index if r['stage']==stage]
    lines=[f'# {title}',context,'## Вход и порядок','Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.',
      '| ID | Результат | Hard dependencies | Статус |','|---|---|---|---|']
    for r in stage_tasks:
        deps=', '.join(f'[{d}]({link_from(here,lookup[d]["path"])})' for d in r['dependencies']) or '—'
        lines.append(f'| [{r["id"]}](tasks/{r["id"]}.md) | {r["title"]} | {deps} | {r["status"]} |')
    lines += ['## Выход','Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.',
      '[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)']
    put(here,'\n\n'.join(lines[:4])+'\n\n'+'\n'.join(lines[4:]))

delivery=['# Этапы и задачи v0.3',
 '92 отдельные карточки: **85 для базового выпуска**, **1 для будущего ТЗ игры**, **6 условных wallet-задач**. По сравнению с 82 исходными пунктами добавлены 4 задачи подготовки, а ранее перечисленный одной строкой wallet вынесен в 6 карточек. Число карточек не означает завершённый код.',
 'У каждой карточки context, dependency links, required docs, область файлов, четыре предметных шага, checkpoints, конкретные test cases, DoD и rollback. [Machine index](task-index.json) содержит граф и статусы. [Каталог тестов](../05-quality/test-catalog.md) связывает все TC с задачами.',
 '## Этапы']
delivery += [f'- [{name}]({stage}/README.md): {context}' for stage,(name,_,context) in STAGES.items()]
delivery += ['## Порядок без циклов','Начать с BOOT-01. После Gate A можно выполнять backend и infrastructure foundation. Identity grant projection ждёт PAY-06. Billing templates ждут payment/subscription events. H-06 проверяет backup/alerts агента до H-11; OPS-08 ждёт H-11 и измеряет весь stack. Это убирает прежнюю неоднозначность «Hermes acceptance ждёт полный resource test, который ждёт Hermes».',
 '## Один допустимый топологический порядок',' → '.join(order),
 '## Выбор следующей задачи','Брать planned задачу, у которой все hard dependencies done и необходимые inputs доступны. Wallet со статусом deferred не становится ready автоматически после Payments. Отсутствие текущих completed tasks означает, что только BOOT-01 готова к старту реализации.',
 '## Оценка','Предыдущая оценка платформы 62–103 рабочих дня без резерва / 75–124 с резервом остаётся грубой оценкой, не обещанием скорости конкретной модели. Новые BOOT/checkpoint детали требуют повторной оценки после bootstrap. API/credentials/дизайн-review задержки и игры в оценку не включены. Более простая модель может потребовать больше ревью и повторений.']
put('docs/04-delivery/README.md','\n\n'.join(delivery))
put('docs/01-specification/chapters/14-atomic-roadmap.md','# Глава 14. Подробный план исполнения v0.3\n\n'+ '\n\n'.join(delivery[1:4])+'\n\n[Открыть этапы и карточки](../../04-delivery/README.md).\n\nHard dependencies и test cases теперь ведутся в карточках, а не в сокращённой старой таблице. Исходная таблица сохранена только как [архив v0.2](../../08-references/archive/roadmap-v0.2.md).\n\nОценка не является гарантией реализации агентом. Начинать с BOOT-01, выполнять по graph, отмечать done только с evidence.')

chapters=sorted((DOCS/'01-specification/chapters').glob('*.md'))
book=['# Nick Lukashik · outegro.dev\n\nСпецификация v0.3. Для исполнения использовать task cards; этот файл — цельное чтение предметных глав.\n']
readme=['# Предметная спецификация','16 глав сохраняют исследование и продуктовый контекст. Исполнимый порядок/проверки находятся в [карточках](../04-delivery/README.md). [Полный документ](portfolio-plan.md) удобен владельцу; модели для одной задачи следует читать только её context bundle.']
for f in chapters:
    title=f.read_text(encoding='utf-8').splitlines()[0].removeprefix('# ')
    readme.append(f'- [{title}](chapters/{f.name})')
    text=f.read_text(encoding='utf-8').replace('](../../','](../')
    book.append(text)
put('docs/01-specification/README.md','\n\n'.join(readme[:2])+'\n\n'+'\n'.join(readme[2:]))
put('docs/01-specification/portfolio-plan.md','\n\n---\n\n'.join(book))

put('docs/08-references/README.md','''# Источники исследования

[Визуальные референсы](reference-review.md), [registry snapshot](research/package-versions.json), [Lava OpenAPI](research/lava-openapi-2026-09-27.yaml).

[Презентация-обзор v0.2](presentations/portfolio-overview-v0.2.pptx) содержит 35 слайдов по продукту/архитектуре. Это предыдущий обзор, не task index v0.3: актуальные 92 карточки и зависимости находятся в delivery. В этом запросе расширена документация; слайды не переписаны под каждую карточку.

Снимки Hermes: [providers/runtime](research/hermes-codex-runtime.md), [Docker](research/hermes-docker.md), [Telegram](research/hermes-telegram.md). Это внешние документальные источники на дату исследования, не инструкции выполнять код без проверки.

Полный raw VPS audit не копировался в новый docs pack. Его путь в старом workspace — `planning/research/vps-audit-2026-09-27.txt`, read-only внутренний источник. Ресурсные выводы перенесены в главу 10. Production secrets/data и исходный код не импортировались.

Установленные навыки на этом компьютере: `C:/Users/working/.codex/skills/taste-skill`, `image-to-code-skill`, `web-design-guidelines`, `playwright-cli`. При их применении прочитать соответствующий SKILL.md. Для другой среды эти пути могут отсутствовать; установка/возможности проверяются до шага, который зависит от них. Сгенерированные макеты будущего landing ещё не созданы.
''')
print(json.dumps({'root':str(ROOT),'task_count':len(index),'test_cases':sum(len(r['tests']) for r in index),'base_tasks':sum(r['scope']=='base-release' for r in index),'chapters':len(chapters),'graph':'acyclic'},ensure_ascii=False))
