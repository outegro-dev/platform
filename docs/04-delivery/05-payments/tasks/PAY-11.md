# PAY-11. Pay web/история/подписки

Status: planned
Scope: base-release
Stage: 05-payments

## Цель и контекст

Pay web должен честно различать статус платежа, подписки и доступность функции.

Задача будущей реализации. Наличие этой карточки не означает, что код/сервисы уже существуют. Выполнять одну карточку, при необходимости передавать её по checkpoints. Соседний незакрытый контракт нельзя заменить догадкой.

## Обязательное чтение

- [project-context](../../../00-start-here/project-context.md)
- [execution-protocol](../../../00-start-here/execution-protocol.md)
- [billing](../../../02-contracts/billing.md)
- [http-errors](../../../02-contracts/http-errors.md)
- [events](../../../02-contracts/events.md)

### Предметная спецификация

- [Глава 6](../../../01-specification/chapters/06-payments-subscriptions.md) — читать связанные разделы при необходимости подробного предметного контекста.
- [Глава 8](../../../01-specification/chapters/08-data-events.md) — читать связанные разделы при необходимости подробного предметного контекста.

## Зависимости и готовность входа

- [DS-05](../../01-landing-design/tasks/DS-05.md) — Сборка shell id/pay/admin; проверить actual report.
- [PAY-03](PAY-03.md) — Idempotent checkout state machine; проверить actual report.
- [PAY-07](PAY-07.md) — Subscription root/renew/period model; проверить actual report.
- [PAY-08](PAY-08.md) — Cancel workflow и paid-until UX; проверить actual report.
- [PAY-09](PAY-09.md) — Refund/dispute inbox и unmatched; проверить actual report.
- [ID-08](../../03-identity/tasks/ID-08.md) — Коммерческая grant projection; проверить actual report.

В начале прочитать отчёты зависимостей и проверить артефакты. `planned` не равно готово. При несовпадении фактического кода с отчётом записать конфликт, не продолжать зависимую mutation вслепую.

### Внешние inputs

- Специальные внешние входные данные для этой карточки не требуются; общий provider/environment context наследуется от зависимостей.

## Область изменений

Будущие пути относительно корня проекта (не утверждение о текущем существовании):

- `apps/payments-backend/`
- `apps/pay-web/`
- `packages/contracts/`
- `tests/fixtures/lava/`

Прочитать [карту legacy/new](../../../00-start-here/repository-map.md) перед переносом. Сначала `rg --files` и чтение существующего кода. Если точного файла ещё нет, создать минимальный модуль в этой области и записать выбранное имя в отчёте. Не создавать два параллельных модуля для одного use case.

**Вне scope:** Не доверять browser amount/status; не угадывать refund source; не вызывать реальное списание из обычного CI.

## Пошаговое выполнение

### C1. Подготовить контракт и проверку

Записать input/output, ожидаемые ошибки, затронутый инвариант, файлы и способ проверки. Для поведения использовать meaningful failing case/fixture; для визуального решения — конкретный preview; для документации — source comparison. Проверить реальные package scripts через [command map](../../../05-quality/command-map.md).

### C2. Реализовать ограниченный результат

1. Подключить checkout/result/history/subscriptions typed API. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.
2. Показывать pending/unknown/paid/failed и отдельно grant activating. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.
3. Реализовать cancel confirmation и refund case status без неподтверждённой кнопки automatic refund. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.
4. Добавить empty catalog, EN/RU, ownership и polling с прекращением после terminal state. **Контроль:** сохранить конкретный diff/артефакт этого шага; сверить с контрактом и связанными TC ниже перед переходом дальше.

### C3. Проверить

Пройти все TC этой карточки. Важен конечный business state, а не только HTTP 200. Для изменённого shared contract запустить проверки его consumers. Не заменять реальные DB concurrency tests моками. Все обращения к внешним provider в обычном CI — fake; real-provider evidence отдельно. Прочитать diff на secrets/лишние изменения.

### C4. Передать результат

Сохранить [task report](../../../07-templates/task-report.md) в `docs/09-evidence/PAY-11/<run-id>/report.md`: изменённые файлы, commit, команды, TC status, ограничения и resume point. Обновить status карточки и task-index.json согласованно. Если осталось обязательное blocked/not-run, task не done.

## Тест-кейсы

### TC-PAY-11-01: Return spoof

- **Дано:** URL success=true, payment pending.
- **Действие:** Открыть result.
- **Ожидается:** Доступ не выдан, показан backend pending.
- **Доказательство:** записать фактическое состояние/response/DB assertion или screenshot в test report. Для негативного сценария проверить также отсутствие запрещённого side effect.
- **Стартовый статус:** not-run.

### TC-PAY-11-02: Пусто

- **Дано:** Нет товаров и покупок.
- **Действие:** Открыть pay.
- **Ожидается:** Честный empty state без придуманного pricing.
- **Доказательство:** записать фактическое состояние/response/DB assertion или screenshot в test report. Для негативного сценария проверить также отсутствие запрещённого side effect.
- **Стартовый статус:** not-run.

### TC-PAY-11-03: Чужой order

- **Дано:** Подменён URL ID.
- **Действие:** Открыть страницу/API.
- **Ожидается:** Чужие суммы/данные не показаны.
- **Доказательство:** записать фактическое состояние/response/DB assertion или screenshot в test report. Для негативного сценария проверить также отсутствие запрещённого side effect.
- **Стартовый статус:** not-run.

### TC-PAY-11-04: Grant lag

- **Дано:** Payment paid, Identity ещё не обновлён.
- **Действие:** Открыть result.
- **Ожидается:** Отображается активация, после projection статус обновлён.
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

После появления данных не выполнять destructive down migration ради отката приложения. Проверить N/N-1 совместимость; использовать forward-fix. Финансовые/audit записи сохраняются, коррекция отдельной командой.

Если источник API/поведение провайдера неизвестен — выполнить документационный lookup по AGENTS.md и зафиксировать результат. Если требуется отсутствующий input — завершить независимую часть, оставить конкретный blocked TC и handoff. Не закрывать задачу обещанием «проверим позже».

## Команда для передачи модели

```text
Выполни только PAY-11 в этом репозитории. Прочитай AGENTS.md и карточку задачи.
Проверь hard dependencies и обязательные контракты. Иди по C1–C4 и test cases.
Не расширяй scope, не меняй старый проект, не объявляй непроверенное успешным.
Сохрани report с точным resume point, если остановишься до завершения.
```
