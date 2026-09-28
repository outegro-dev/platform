# OPS-03. GitOps chart/migration job

Status: planned
Scope: base-release
Stage: 07-operations

## Цель и контекст

Shared chart должен запускать Drizzle migration ровно контролируемым job, не на каждом app start.

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

- [OPS-02](OPS-02.md) — PG/Redis/Rabbit PVC/roles/limits; проверить actual report.
- [BE-07](../../02-backend-foundation/tasks/BE-07.md) — Runtime/migration DB roles; проверить actual report.

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

1. Перенести один reviewed shared Helm chart и values для новых сервисов. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.
2. Заменить Prisma hook на release-specific migration Job с lock/deadline. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.
3. Настроить immutable image digests, sync ordering и readiness gates. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.
4. Проверить render/diff и failure rollout до фактического production sync. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.

### C3. Проверить

Пройти все TC этой карточки. Важен конечный business state, а не только HTTP 200. Для изменённого shared contract запустить проверки его consumers. Не заменять реальные DB concurrency tests моками. Все обращения к внешним provider в обычном CI — fake; real-provider evidence отдельно. Прочитать diff на secrets/лишние изменения.

### C4. Передать результат

Сохранить [task report](../../../07-templates/task-report.md) в `docs/09-evidence/OPS-03/<run-id>/report.md`: изменённые файлы, commit, команды, TC status, ограничения и resume point. Обновить status карточки и task-index.json согласованно. Если осталось обязательное blocked/not-run, task не done.

## Тест-кейсы

### TC-OPS-03-01: Migration failure

- **Дано:** Migration завершилась nonzero.
- **Действие:** Запустить test rollout.
- **Ожидается:** Зависимый app rollout не открыт как ready.
- **Доказательство:** записать фактическое состояние/response/DB assertion или screenshot в test report. Для негативного сценария проверить также отсутствие запрещённого side effect.
- **Стартовый статус:** not-run.

### TC-OPS-03-02: Resync

- **Дано:** Та же release revision уже применена.
- **Действие:** Выполнить sync повторно.
- **Ожидается:** Нет повторной destructive migration.
- **Доказательство:** записать фактическое состояние/response/DB assertion или screenshot в test report. Для негативного сценария проверить также отсутствие запрещённого side effect.
- **Стартовый статус:** not-run.

### TC-OPS-03-03: Images

- **Дано:** Production values.
- **Действие:** Проверить manifests.
- **Ожидается:** Нет mutable latest; source commit/digest прослеживается.
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
Выполни только OPS-03 в этом репозитории. Прочитай AGENTS.md и карточку задачи.
Проверь hard dependencies и обязательные контракты. Иди по C1–C4 и test cases.
Не расширяй scope, не меняй старый проект, не объявляй непроверенное успешным.
Сохрани report с точным resume point, если остановишься до завершения.
```
