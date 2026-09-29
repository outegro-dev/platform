# Метрики, логи и correlation сервисов

Состояние на 29.09.2026: [OPS-04](../04-delivery/07-operations/tasks/OPS-04.md). Сервисы отдают метрики и пишут связанные логи. В production развёрнуты Prometheus (scrape порта 9464 через PodMonitor `services`, правила из `gitops/platform/monitoring/extra/rules.yaml`), Loki и Alloy — см. [production](production.md#мониторинг-prometheus-и-loki). Grafana и Alertmanager выключены до решения о входе в Grafana; алерты доставляет watchdog. Требования — [глава 9](../01-specification/chapters/09-observability.md), разделы 9.3 и 9.4.

## Порт метрик

- auth-backend, notifications-backend, payments-backend и battleship-backend поднимают отдельный HTTP listener на `METRICS_PORT` (по умолчанию `9464`, `0` — выключен). Он отвечает только на `GET /metrics` в текстовом формате Prometheus 0.0.4; другой путь — 404, другой метод — 405.
- На порту приложения `/metrics` нет (404), поэтому Ingress, который маршрутизирует приложение, не может опубликовать метрики. Порт 9464 открывать только Prometheus внутри кластера (NetworkPolicy).
- Локально порты разведены в `.env.example`: 9461 auth, 9462 notifications, 9463 payments, 9464 battleship; `pnpm env:local` добавит их в существующие `.env`. В интеграционных тестах `METRICS_PORT=0`.
- У каждой серии есть метка `service` с именем сервиса. Если scrape-конфиг сам добавляет target-метку `service` (ServiceMonitor), нужен `honorLabels: true`, иначе метка сервиса станет `exported_service`.
- Проверка в кластере: `kubectl -n outegro port-forward deploy/auth-backend 9464`, затем `curl -s localhost:9464/metrics`.

## Правила меток

- Значения меток — только малые фиксированные множества: шаблон маршрута, метод, класс статуса, канал, исход, известный тип события, очередь, режим матча.
- Никогда: userId, orderId, email, requestId, traceId, eventId, id контракта или счёта. Они остаются в логах.
- `route` — шаблон маршрута (`/v1/me/sessions/:id`), не сырой путь. Запрос, который не обслужил ни один handler (неизвестный путь, тело, отклонённое до маршрутизации), — `unmatched`. Метод вне GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS — `other`. `/health` и `/health/deep` не учитываются.
- Тесты каждого сервиса проверяют выдачу `/metrics`: ни одно значение метки не похоже на UUID, email или токен.
- Денежных сумм в метриках нет: суммы в разных валютах не складываются, деньги — в журнале и админке.

## Общие метрики

| Метрика | Тип | Метки | Смысл |
|---|---|---|---|
| `http_server_requests_total` | counter | method, route, status_class | HTTP-запросы; status_class — 2xx, 3xx, 4xx, 5xx |
| `http_server_request_duration_seconds` | histogram | method, route, status_class | Время ответа; бакеты от 5 мс до 10 с, границы 0.3 и 0.5 с — цели 9.7 |
| `messaging_events_consumed_total` | counter | queue, outcome | Потреблённые события: processed, retried (ушло в retry-очередь), dead_lettered (в `.dlq`, включая нечитаемые) |
| `messaging_event_lag_seconds` | histogram | queue | От `occurredAt` события до успешной обработки: задержка проекций, в том числе grant-lag |
| `outbox_pending_events` | gauge | — | Закоммиченные, но не опубликованные события |
| `outbox_oldest_pending_age_seconds` | gauge | — | Возраст самого старого из них; 0 — очередь пуста |
| `metrics_read_errors_total` | counter | reader | Неудачные или долгие чтения gauge из БД во время scrape |
| `process_*`, `nodejs_*` | — | — | Стандартные метрики процесса и Node: CPU, память, heap, event loop lag и utilization, GC, handles, версия |

Gauges из БД (outbox, очереди, checkout, provider inbox) читаются на каждом scrape одним дешёвым запросом по частичному индексу, с тайм-аутом 2 с. При ошибке их значения становятся неизвестными (NaN или нет серии), растёт `metrics_read_errors_total`, остальной scrape отдаётся.

## auth-backend

| Метрика | Тип | Метки | Смысл |
|---|---|---|---|
| `identity_sign_in_attempts_total` | counter | method (email, google), result | Попытки входа. result: success, invalid_code, expired, too_many_attempts (код), rejected (Google отказал, email не подтверждён), conflict (нужна привязка), rate_limited, forbidden (аккаунт не активен), unavailable (Google недоступен или выключен), error |
| `identity_login_codes_total` | counter | result (accepted, failed) | Код входа передан в Notifications: принят провайдером или не доставлен |

## notifications-backend

| Метрика | Тип | Метки | Смысл |
|---|---|---|---|
| `notifications_deliveries_total` | counter | channel (email, telegram), outcome | Записанный исход попытки: sent (принято провайдером, не «прочитано»), retried, failed, expired, unknown |
| `notifications_deliveries_queued` | gauge | channel | Ждут отправки: pending, retry_wait, leased |
| `notifications_delivery_oldest_queued_age_seconds` | gauge | channel | Возраст самой старой ожидающей доставки |
| `notifications_action_links_dropped_total` | counter | template (ключ шаблона из реестра) | Ссылка `actionUrl` не на наш сайт отброшена при приёме; сообщение ушло со ссылкой шаблона. Считается после записи intent, повторная доставка события не считается |

Канал, приостановленный оператором, держит доставки в очереди — возраст растёт намеренно. Коды входа идут не через очередь, а синхронно: их видно в `identity_login_codes_total`.

## payments-backend

| Метрика | Тип | Метки | Смысл |
|---|---|---|---|
| `payments_webhooks_total` | counter | type, outcome | Вебхуки Lava. type — payment.success, payment.failed, subscription.recurring.payment.success, subscription.recurring.payment.failed, subscription.cancelled, refund.success, chargeback.initiated или other. outcome: accepted (сохранён), rejected_auth, rejected_schema, duplicate, error (не сохранён, Lava получит 5xx и повторит) |
| `payments_provider_events_unprocessed` | gauge | status (received, unmatched, failed) | Provider inbox: сохранённые события, ещё не применённые |
| `payments_provider_event_oldest_unprocessed_age_seconds` | gauge | status | Возраст самого старого из них |
| `payments_checkouts_pending` | gauge | state (requesting, ready, unknown) | Checkout, заказ которого ещё pending и который reconciliation продолжает проверять |
| `payments_checkout_oldest_pending_age_seconds` | gauge | state | Возраст самого старого такого checkout |
| `payments_reconciliation_last_success_timestamp_seconds` | gauge | — | Unix-время последнего завершённого прохода reconciliation; 0 до первого прохода после старта |
| `payments_grants_activated_total` | counter | source (purchase, subscription, manual) | Grant стал активным: новый или после истечения; продление срока не считается |

HTTP 200 на вебхук — durable acceptance, а не обработанный платёж: обработку показывает provider inbox. `unmatched` законно ждёт часами (webhook раньше checkout, возврат ждёт оператора); `received` и `failed` должны уходить за минуты. `ready` — покупатель ещё не оплатил, `unknown` — ответ Lava потерян, его ищет reconciliation. Счётчик grant увеличивается после коммита транзакции, которая активировала grant: откат с повтором worker'ом не считается дважды. Это всё равно счётчик для rate, не для сверки: сверка — по grants и журналу.

## battleship-backend

| Метрика | Тип | Метки | Смысл |
|---|---|---|---|
| `battleship_game_sockets` | gauge | — | Открытые игровые сокеты `/ws` |
| `battleship_socket_upgrades_refused_total` | counter | status | Отказы в upgrade: 401 тикет, 403 origin или аккаунт, 404 путь, 429 больше 8 сокетов на игрока, 503 остановка или сбой |
| `battleship_live_matches` | gauge | mode (bot, quick, private) | Матчи в расстановке или бою |
| `battleship_matches_finished_total` | counter | mode, outcome | fleet_destroyed, resigned, timeout, disconnected; placement_timeout и moderation — без результата |

## Логи и correlation

- JSON-строки Pino в stdout (Alloy → Loki): `service`, `level`, `time`, `message`, `context` и поля строки.
- Id запроса — `x-request-id` вызывающего (BFF, другой сервис) или новый UUID. Он возвращается в заголовке ответа и в теле ошибки. Каждая строка внутри запроса несёт `requestId`, `req.id` и `correlationId` (для HTTP-запроса он равен requestId). Access-лог `/health` не пишется.
- Событие обрабатывается в контексте своего `correlationId`; событие без него начинает цепочку со своего `eventId`. Consumer пишет на каждое событие `Event handled` (queue, eventId, type, correlationId, attempt, lagMs) или `Event handling failed` (плюс target и err); все строки обработчика несут `correlationId`.
- Событие, записанное в outbox во время запроса или обработки события, получает `correlationId` цепочки и `causationId` — id запроса или id потреблённого события. Явные значения сервиса сильнее: payments ставит в события оплаты correlationId заказа, то есть id запроса checkout.
- Фоновые проходы (outbox relay, delivery worker) и таймер окончания grant в battleship-backend (`player.updated` в момент `validUntil`) идут вне контекста запроса или события, которые их запустили, и не наследуют их id.
- Редактируются заголовки authorization, cookie, set-cookie и поля password, code, token, accessToken, refreshToken, secret. Тела запросов не логируются.

### Как найти цепочку покупки

1. По `x-request-id` запроса checkout (он же `correlationId` заказа в админке): строки payments с этим `requestId` и строки `Event handled` в auth-backend, battleship-backend и notifications-backend с этим `correlationId`. Пример LogQL (имена меток зависят от Alloy): `{namespace="outegro"} | json | correlationId="<id>"`.
2. Вебхук — отдельный запрос: у событий оплаты `causationId` — его request id; по нему `| json | requestId="<causationId>"` видна обработка вебхука.
3. Задержку между этапами дают время строк и `lagMs`.

## Предложения для alert-правил

Большая часть развёрнута в `gitops/platform/monitoring/extra/rules.yaml` (группа `outegro.services`); стартовые пороги из 9.5, уточнить после baseline.

| Сигнал | Выражение |
|---|---|
| Outbox не публикует | `max by (service) (outbox_oldest_pending_age_seconds) > 300` 5 минут |
| Provider inbox стоит | `max(payments_provider_event_oldest_unprocessed_age_seconds{status=~"received\|failed"}) > 300` |
| Вебхуки отклоняются | `increase(payments_webhooks_total{outcome=~"rejected_auth\|rejected_schema\|error"}[15m]) > 0` |
| Reconciliation не работает | `payments_reconciliation_last_success_timestamp_seconds > 0 and time() - payments_reconciliation_last_success_timestamp_seconds > 300` |
| Потерянный ответ Lava | `payments_checkout_oldest_pending_age_seconds{state="unknown"} > 1800` |
| Коды входа не доставляются | `increase(identity_login_codes_total{result="failed"}[10m]) > 0` |
| Письма стоят в очереди | `notifications_delivery_oldest_queued_age_seconds{channel="email"} > 900` |
| Ссылки producer-а не на наш сайт (например, разный `PAY_WEB_URL`) | `increase(notifications_action_links_dropped_total[15m]) > 0` |
| DLQ растёт | `increase(messaging_events_consumed_total{outcome="dead_lettered"}[15m]) > 0` |
| 5xx | `sum by (service, route) (rate(http_server_requests_total{status_class="5xx"}[5m])) > 0` 10 минут |
| Медленная приёмка вебхука | `histogram_quantile(0.95, sum by (le) (rate(http_server_request_duration_seconds_bucket{service="payments-backend", route="/webhooks/lava"}[10m]))) > 0.5` |

## Не сделано

Grafana с dashboards и Alertmanager (ждут решения о входе), NetworkPolicy для порта 9464. Трассировка (OpenTelemetry) в этот шаг не входит.
