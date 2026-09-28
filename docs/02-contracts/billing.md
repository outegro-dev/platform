# Billing: инварианты и состояния

## Авторитетные данные

Browser выбирает priceId, а server определяет user/amount/currency/product. Order содержит immutable PriceVersion snapshot. Lava ID хранится с provider+environment. Email не служит ключом владения покупкой. Return URL не подтверждает оплату.

## CheckoutAttempt

| Из | Триггер | В | Side effect |
|---|---|---|---|
| created | Начинаем один разрешённый provider call | requesting | Attempt сохранена до сети |
| requesting | Проверенный invoice response | ready | Mapping и checkout URL сохранены |
| requesting | Однозначный rejection | failed | Нет нового платежа |
| requesting | Timeout/потеря response | unknown | Reconcile, не blind POST |
| unknown | Доказанный match provider invoice | ready или terminal | Продолжаем ту же attempt |
| любое | Повтор same idempotency input | без нового transition | Возврат прежнего logical result |

## Payment и journal

Pending → confirmed только по trusted provider fact + проверенным amount/currency/mapping. Поздний failed не делает confirmed обратно failed. Refund и dispute отдельные сущности и компенсирующие записи. Нельзя вручную менять pending на paid из админки. Commercial grant выдаётся в том же use case/transaction при соответствующем confirmed financial fact, с outbox.

## Subscription

Pending без оплаты не даёт доступа. Active означает подтверждённый оплаченный интервал. Past_due не продлевает его автоматически; grace default 0. Cancel_requested означает неизвестный/неподтверждённый результат отмены. Cancelling сохраняет оплаченный срок при выключенном renewal. Expired прекращает источник права. Suspended требует явного основания и не стирает независимые grants.

BillingPeriod unique по проверенному provider payment/period key. Даты берутся из contract mapping, не `now + 30 days`. Пограничный test использует `now == validUntil`: интервал полуоткрытый `[validFrom, validUntil)`, доступ уже отсутствует. Timezone display не меняет UTC predicate.

## Webhook processing

Credential проверяется до доверия payload. Настраиваемые способы по сохранённой Lava документации: Basic или X-Api-Key, не самодельная HMAC-схема. Raw payload хранить приватно с retention, журналу давать redacted reference. Unknown authorized event: quarantine + 2xx после durable commit. DB failure: non2xx. Invalid auth: non2xx. Invalid known payload сохраняется для диагностики только в допустимом объёме, business effect отсутствует.

Legacy events без event_id требуют semantic source key по проверенному contract/type/period плюс aggregate/source unique constraints. Raw hash помогает транспортной диагностике, но не заменяет business idempotency. Early webhook без invoice mapping остаётся unmatched, затем проверяется снова.

## Provider uncertainties

До PAY-12 не считать доказанными sandbox, create idempotency/recovery, все currency/method combinations, period mapping, refund initiation API и merchant available balance. Refund без однозначной покупки остаётся unmatched. Две одинаковые покупки одного email специально присутствуют в fixtures.

## Wallet

По умолчанию выключен. Условные W-01…06 не входят в обязательную base acceptance. Paid/refunded totals админки — история, не тратимый баланс. При включении требуются merchant support, double-entry ledger, serialization, reserve/capture/release и debt policy. Пользовательские переводы и вывод денег не входят в исходный wallet scope.
