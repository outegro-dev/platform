# Проверки и доказательства

Карточка задачи содержит test cases с устойчивыми ID `TC-<TASK>-NN`, предусловием, действием и ожидаемым результатом. Сводный [каталог тестов](test-catalog.md) строится при подготовке плана. Реальные результаты пишутся только в `docs/09-evidence/`.

- [Command map](command-map.md)
- [Фикстуры](fixtures.md)
- [Сквозная матрица](e2e-matrix.md)
- [Критерии этапов](release-gates.md)
- [Тестовый отчёт](../07-templates/test-run.md)

## Уровни

Unit: чистая бизнес-логика money/interval/state/parser, без mock-копии реализации. Integration: реальные PostgreSQL/Redis/RabbitMQ в изолированной среде для uniqueness, transactions, locks, retry. Contract: schemas и sanitized provider fixtures, отдельно real-provider validation. E2E: браузер/BFF/services для готового сценария. Operational: restore, fault injection, resource profile. Visual/manual: композиция, motion, focus, реальные устройства.

Документационные задачи проверяются чтением источников, ссылками и consistency review. Для текста и структуры не писать искусственные unit tests. Проверки tools/documentation проверяют граф/ссылки/полноту карточек, не качество приложения.

## Конкурентные тесты

Использовать барьер старта минимум двух workers/requests и независимые DB connections. После завершения читать БД и outbox/inbox/journal напрямую тестовой ролью. Успех HTTP одного запроса недостаточен: проверить число committed effects и конечный инвариант. Не делать race test на случайном sleep без фиксации воспроизводимого окна сбоя.

## Fault injection

Контролируемые точки: до commit, после commit до ack, после provider acceptance до локальной записи, после claim до send. Fake provider умеет отвечать success/error/timeout и записывает число calls. Реальный провайдер не вызывается из обычного CI. Сеть/DB/broker выключать только в изолированной test среде.

## Evidence policy

Report содержит commit/ref, runtime versions, environment, command, exit code, TC results, attachments и limitations. Статусы cases: pass/fail/blocked/not-run. Файл screenshot без объяснения сценария не доказательство. Not-run не превращается в pass при красивом финальном сообщении модели. Удалять или редактировать secrets из логов до сохранения evidence.
