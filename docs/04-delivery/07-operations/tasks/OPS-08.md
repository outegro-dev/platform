# OPS-08. Ресурсный профиль 8 ГБ

Status: planned
Scope: base-release
Stage: 07-operations

## Цель и контекст

Budget 6748 MiB — гипотеза. Нужен full-stack тест до production readiness, включая Hermes.

Задача будущей реализации. Наличие этой карточки не означает, что код/сервисы уже существуют. Выполнять одну карточку, при необходимости передавать её по checkpoints. Соседний незакрытый контракт нельзя заменить догадкой.

## Обязательное чтение

- [project-context](../../../00-start-here/project-context.md)
- [execution-protocol](../../../00-start-here/execution-protocol.md)
- [deployment](../../../02-contracts/deployment.md)
- [events](../../../02-contracts/events.md)

### Предметная спецификация

- [Глава 9](../../../01-specification/chapters/09-observability.md) — читать связанные разделы при необходимости подробного предметного контекста.
- [Глава 10](../../../01-specification/chapters/10-k3s-infrastructure.md) — читать связанные разделы при необходимости подробного предметного контекста.

## Зависимости и готовность входа

- [OPS-03](OPS-03.md) — GitOps chart/migration job; проверить actual report.
- [OPS-05](OPS-05.md) — Dashboards/alerts/runbooks; проверить actual report.
- [OPS-07](OPS-07.md) — Restore rehearsal; проверить actual report.
- [ID-10](../../03-identity/tasks/ID-10.md) — Key rotation/revoke/CSRF tests; проверить actual report.
- [N-06](../../04-notifications/tasks/N-06.md) — Billing/security templates EN/RU; проверить actual report.
- [PAY-11](../../05-payments/tasks/PAY-11.md) — Pay web/история/подписки; проверить actual report.
- [A-07](../../06-admin/tasks/A-07.md) — Audit view и sensitive actions; проверить actual report.
- [H-11](../../08-hermes/tasks/H-11.md) — Тесты контекстов/альбомов/restart/restore/no-spend; проверить actual report.

В начале прочитать отчёты зависимостей и проверить артефакты. `planned` не равно готово. При несовпадении фактического кода с отчётом записать конфликт, не продолжать зависимую mutation вслепую.

### Внешние inputs

- Специальные внешние входные данные для этой карточки не требуются; общий provider/environment context наследуется от зависимостей.

## Область изменений

Будущие пути относительно корня проекта (не утверждение о текущем существовании):

- `infra/gitops/`
- `infra/local/`
- `apps/*/ (instrumentation/config)`
- `docs/06-operations/`

Прочитать [карту legacy/new](../../../00-start-here/repository-map.md) перед переносом. Сначала `rg --files` и чтение существующего кода. Если точного файла ещё нет, создать минимальный модуль в этой области и записать выбранное имя в отчёте. Не создавать два параллельных модуля для одного use case.

**Вне scope:** Не применять manifests к legacy VPS; не добавлять второй node; не считать backup job success доказательством restore.

## Пошаговое выполнение

### C1. Подготовить контракт и проверку

Записать input/output, ожидаемые ошибки, затронутый инвариант, файлы и способ проверки. Для поведения использовать meaningful failing case/fixture; для визуального решения — конкретный preview; для документации — source comparison. Проверить реальные package scripts через [command map](../../../05-quality/command-map.md).

### C2. Реализовать ограниченный результат

1. Развернуть все обязательные сервисы на согласованном 8-GB профиле. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.
2. Измерить idle, steady, bursts, rollout, backlog drain и один Hermes vision job. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.
3. Проверить CPU/RAM/disk/connection peaks и отсутствие starvation identity/payments. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.
4. Подобрать limits/concurrency; при нехватке зафиксировать vertical upgrade, не добавить второй узел. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.

### C3. Проверить

Пройти все TC этой карточки. Важен конечный business state, а не только HTTP 200. Для изменённого shared contract запустить проверки его consumers. Не заменять реальные DB concurrency tests моками. Все обращения к внешним provider в обычном CI — fake; real-provider evidence отдельно. Прочитать diff на secrets/лишние изменения.

### C4. Передать результат

Сохранить [task report](../../../07-templates/task-report.md) в `docs/09-evidence/OPS-08/<run-id>/report.md`: изменённые файлы, commit, команды, TC status, ограничения и resume point. Обновить status карточки и task-index.json согласованно. Если осталось обязательное blocked/not-run, task не done.

## Тест-кейсы

### TC-OPS-08-01: Нагрузка

- **Дано:** Весь P0 stack и контролируемые request/event rates.
- **Действие:** Провести baseline/peak прогон.
- **Ожидается:** Нет OOM и необъяснённых failures, запас измерен.
- **Доказательство:** записать фактическое состояние/response/DB assertion или screenshot в test report. Для негативного сценария проверить также отсутствие запрещённого side effect.
- **Стартовый статус:** not-run.

### TC-OPS-08-02: Agent pressure

- **Дано:** Hermes достигает своего лимита.
- **Действие:** Проверить core latency/health.
- **Ожидается:** Core сервисы сохраняют приоритет, agent bounded/paused.
- **Доказательство:** записать фактическое состояние/response/DB assertion или screenshot в test report. Для негативного сценария проверить также отсутствие запрещённого side effect.
- **Стартовый статус:** not-run.

### TC-OPS-08-03: Rollout

- **Дано:** App old/new overlap.
- **Действие:** Выполнить test update.
- **Ожидается:** Есть запас или документирован Recreate window, node не падает.
- **Доказательство:** записать фактическое состояние/response/DB assertion или screenshot в test report. Для негативного сценария проверить также отсутствие запрещённого side effect.
- **Стартовый статус:** not-run.


## Критерии готовности

- [ ] Входные dependencies подтверждены фактическими артефактами.
- [ ] Все четыре предметных шага C2 выполнены, выбранные значения/контракты записаны.
- [ ] Все обязательные TC имеют pass с evidence, внешние проверки не подменены fixture.
- [ ] Видимые UI/errors/messages имеют EN/RU, если задача их меняет.
- [ ] Logs/audit содержат нужный correlation/result без секретов.
- [ ] Обновлены относящиеся contracts/runbooks/command map; лишний scope не добавлен.
- [ ] Отчёт объясняет ограничения, rollback и следующий task/checkpoint.

## Откат и остановка

Остановить неуспешный rollout на согласованном target. Вернуть совместимый image/values либо выполнить forward-fix. Не удалять PVC/keys и не применять recovery к старому VPS.

Если источник API/поведение провайдера неизвестен — выполнить документационный lookup по AGENTS.md и зафиксировать результат. Если требуется отсутствующий input — завершить независимую часть, оставить конкретный blocked TC и handoff. Не закрывать задачу обещанием «проверим позже».

## Команда для передачи модели

```text
Выполни только OPS-08 в этом репозитории. Прочитай AGENTS.md и карточку задачи.
Проверь hard dependencies и обязательные контракты. Иди по C1–C4 и test cases.
Не расширяй scope, не меняй старый проект, не объявляй непроверенное успешным.
Сохрани report с точным resume point, если остановишься до завершения.
```
