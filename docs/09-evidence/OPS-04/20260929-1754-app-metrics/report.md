# Отчёт OPS-04

- Статус: in_progress. Прикладная часть (метрики, логи, correlation в сервисах) сделана и проверена; развёртывание Prometheus, Grafana, Alertmanager, Loki и Alloy в этом прогоне не выполнялось.
- Task card: [OPS-04](../../../04-delivery/07-operations/tasks/OPS-04.md).
- Commit/ref: ветка `feat/service-metrics` от `master` 9f4adc4; b58a5d3 (correlation), 0ca0314 (модуль метрик и подключение сервисов), 07f305c (auth), 345ad2a (notifications), f15f327 (payments), 6e7ffcf (battleship), 4dc8506 (документация). Dirty files: нет.
- Environment/runtime: Windows 11, Node 26.8.1 локально (production и CI — Node 24), pnpm 12.3.4, Docker Desktop 29.7.2; Testcontainers: PostgreSQL 18.6, Valkey 9.1, RabbitMQ 4.3.
- Прочитанные contracts/ADR: [deployment](../../../02-contracts/deployment.md), [events](../../../02-contracts/events.md), [глава 9](../../../01-specification/chapters/09-observability.md) (9.3, 9.4, 9.5, 9.7), карточка OPS-04.
- Dependency evidence: BE-04 и OPS-01 в task-index — planned, но их артефакты есть: envelope с `correlationId`/`causationId` и контракт ошибок в `packages/contracts`, работающий кластер — [production](../../../06-operations/production.md). Конфликт статусов записан.

## Изменения

- `packages/db`: контекст correlation (`runWithCorrelation`, `currentCorrelation`, `runDetached`); `enqueueEvent` заполняет недостающие `correlationId`/`causationId` из контекста запроса или потреблённого события; `outboxBacklog`.
- `packages/nest-common`: `MetricsModule` (свой registry с меткой `service` и метриками процесса, listener на `METRICS_PORT`, HTTP-метрики по шаблону маршрута, чтение gauge из БД на scrape с тайм-аутом); `metricsEnvSchema`; `configureApp` назначает id запроса, открывает контекст correlation, ставит HTTP-метрики; `correlationId` в строках логов; строка лога на каждое потреблённое событие; счётчик и lag потребления; gauges outbox; таймеры relay вне контекста. Зависимость `@prometheus-io/client` 0.16.1 (`prom-client` в npm — deprecated, заменён этим пакетом).
- Сервисы: `METRICS_PORT` в env-схемах, `MetricsModule` в `AppModule`, `.env.example` (9461–9464), `METRICS_PORT=0` в тестах; метрики домена в `src/common/metrics.ts`; delivery worker notifications планирует проходы вне контекста.
- Документация: [observability](../../../06-operations/observability.md), раздел «Метрики» в [deployment](../../../02-contracts/deployment.md), статус in_progress.
- Миграций нет; контракт событий не менялся, поля envelope теперь заполняются.

## Checkpoints

| Checkpoint | Результат | Evidence |
|---|---|---|
| C1 контракт/исходное поведение | События без correlationId (кроме оплаты), успешная обработка событий не логировалась, метрик не было | код до 9f4adc4 |
| C2.1 correlation в сервисах | done | b58a5d3, тесты |
| C2.2 стек Prometheus/Grafana/Alertmanager/Loki/Alloy | not-run: вне поручения этого прогона | — |
| C2.3 retention/cardinality/redaction | частично: cardinality ограничена в коде, редакция логов проверена; retention стека не сделан | observability.md, тесты |
| C2.4 метрики и логи без userId-меток | частично: выдача `/metrics` проверена во всех сервисах; Grafana/Loki не проверялись | тесты |
| C3 проверки | pass для прикладной части | ниже |
| C4 handoff | этот отчёт | — |

## Проверки

| TC-ID/команда | Environment | Фактический результат | Статус | Evidence |
|---|---|---|---|---|
| TC-OPS-04-01 Correlation | Testcontainers | id запроса checkout → correlationId событий оплаты и grant, id запроса вебхука → causationId (payments); запрос → событие → consumer → следующее событие с одним correlationId (nest-common); события входа несут id запроса (auth). Поиск в Loki не выполнялся | blocked (частично pass) | billing.test.ts, messaging.test.ts, login.test.ts |
| TC-OPS-04-02 PII | Testcontainers | Authorization, код и email не попадают в логи, requestId в каждой строке запроса; в `/metrics` всех сервисов нет меток, похожих на UUID, email или токен. Метки Loki не проверялись | blocked (частично pass) | logging.test.ts, тесты idLikeLabelValues |
| TC-OPS-04-03 Retention | — | стек не развёрнут | not-run | — |
| db test | локально | 11/11 | pass | — |
| nest-common test | Testcontainers | 27/27 | pass | — |
| auth-backend test | Testcontainers | 52/52 | pass | — |
| notifications-backend test | Testcontainers | 41/41 | pass | — |
| payments-backend test | Testcontainers | 109/109 | pass | — |
| battleship-backend test | Testcontainers | 105/105 | pass | — |
| typecheck, biome check ., nest build, validate.py | локально | без ошибок | pass | — |

## Ограничения и незавершённое

- Не сделано: scrape порта 9464, NetworkPolicy, Alloy → Loki, retention и лимиты, dashboards, alert-правила (предложения — в observability.md).
- `@opentelemetry/api` разрешён как optional peer у next, drizzle-orm и vitest (lockfile); SDK нет, web-приложения не пересобирались.
- Старые локальные `.env` без `METRICS_PORT` дают EADDRINUSE на 9464 при двух сервисах — выполнить `pnpm env:local`.
- `payments_grants_activated_total` считается в транзакции (откат с повтором — двойной счёт); время последней reconciliation — 0 после рестарта до первого прохода; тело, отклонённое до маршрутизации, — `unmatched`.
- При ServiceMonitor нужен `honorLabels: true`.

## Откат

`git revert` коммитов ветки; миграций нет. Listener выключается `METRICS_PORT=0` без отката. Заполненные correlationId/causationId соответствуют envelope v1.

## Следующая задача / resume point

OPS-04, развёртывание в gitops: scrape 9464, NetworkPolicy, Alloy → Loki (метки потоков без id), retention 7 дней с лимитом, dashboards по 9.3, alert-правила из observability.md, затем TC-OPS-04-01…03 в кластере.

## Приёмка ведущим (29.09)

Ветка слита в master (`2de9a63`), CI зелёный, выкачено в production. В gitops после этого: Prometheus, Loki и Alloy развёрнуты (приложение `monitoring`, retention 7 дней с лимитом размера, Alloy → Loki с метками `namespace`, `app`, `container`, `pod`, `level`), PodMonitor `services` снимает порт 9464, группа правил `outegro.services` по предложениям из observability.md. Остаются Grafana с dashboards (вход через SSO админки — в работе), Alertmanager и NetworkPolicy для порта 9464.
