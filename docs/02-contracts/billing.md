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

## Решения реализации (payments-backend, 29.09.2026)

Проектные решения там, где контракт оставлял выбор. Меняются только вместе с кодом и тестами `apps/payments-backend`.

**Каталог.** Продукты и цены — в коде (`src/domain/catalog.ts`), при старте синхронизируются в `products`/`prices`. Новая сумма закрывает текущую версию цены (`validUntil`) и открывает следующую. Заказ хранит снимок: priceId, версию, сумму, валюту, offerId, service/feature, graceDays. Клиент покупает по `productKey` + `currency`, а не по priceId. Деньги — bigint в minor units. Сумма от Lava читается из текста числа (`String(n)` у JSON number); лишние знаки после запятой считаются ошибкой, округления нет.

**Checkout.** `POST /v1/checkout { productKey, currency, returnUrl? }`. Заголовок `Idempotency-Key` обязателен: 8–128 символов `[A-Za-z0-9._:-]`, область действия — пользователь + checkout. Fingerprint считается как sha256 от (productKey, currency, returnUrl). Тот же ввод возвращает тот же заказ, другой ввод с тем же ключом — 409 `IDEMPOTENCY_CONFLICT`. Ответ: `{ orderId, attemptId, state, status, paymentUrl }`. `returnUrl` принимается только с разрешённых origin (`PAY_WEB_URL` + `CHECKOUT_RETURN_ORIGINS`). В Lava уходят три адреса с `orderId` и `result`, это подсказка для UI (INV-17). Ответ Lava 4xx или запрос, который точно не ушёл (DNS, connection refused), дают `failed`. Timeout, обрыв после отправки, 5xx и нечитаемый 2xx дают `unknown`, повторного POST нет (INV-16). 2xx без `paymentUrl` или с не-https адресом тоже `failed`, invoice id при этом сохраняется. Уже купленную разовую покупку (активный purchase grant) и вторую живую подписку того же продукта (active, past_due, cancel_requested) купить нельзя, ответ 422 `ALREADY_OWNED`. Продажи закрыты, пока `CHECKOUT_ENABLED=false` (по умолчанию) или нет `LAVA_API_KEY`. Вебхуки и сверка работают всегда. Отдельного environment у Lava ID нет: sandbox не подтверждён, окружение — это отдельная БД деплоя.

**Повторная покупка (QA H1).** Checkout одного покупателя идёт по очереди: транзакция блокирует его строку `customers` (`FOR UPDATE`) и под блокировкой проверяет ключ, владение и открытую попытку. Открытая попытка — неоплаченный заказ того же продукта и валюты, у которого вызов Lava ещё идёт (`requesting`, не старше 2×timeout + 30 с) или готова страница оплаты (`ready` с `paymentUrl`, не старше часа). С любым Idempotency-Key возвращаются её заказ и `paymentUrl`, второго invoice нет; `returnUrl` остаётся от первой попытки. Час — инженерное значение: срок жизни invoice Lava не документирован, а неоплаченный invoice, который Lava перевела в FAILED, делает заказ `failed`. `unknown` и `ready` без `paymentUrl` не переиспользуются: страницы оплаты у покупателя для них нет.

Если Lava всё же подтвердила первую оплату того, что у покупателя уже есть (гонка, другая вкладка, страница из старой сессии), доступ второй раз не выдаётся. Первые оплаты одного покупателя применяются по очереди под той же блокировкой `customers`. Оплата записывается полностью: заказ `paid`, payment, запись журнала, `billing.payment.confirmed` и уведомление. Grant этого заказа или подписки создаётся сразу `revoked` с причиной `duplicate purchase`; `billing.grant.changed` уходит один раз, с этим состоянием и версией 1, и платёж его уже не откроет. Открывается issue `duplicate_purchase` (high, subject `payment:<paymentId>`), в `related` — заказ, платёж и то, что у покупателя уже было. Оператор возвращает деньги в кабинете Lava. Вторая подписка создаётся в `cancel_requested` с отменой к немедленной отправке: worker вызывает `DELETE /api/v1/subscriptions` для её родительского контракта, дальше повторы и issue — как у обычной отмены.

**Вебхук `POST /webhooks/lava`** (вне `/v1`, без сессии). Аутентификация — заголовок `X-Api-Key`, равный `LAVA_WEBHOOK_SECRET`; сравниваются SHA-256 дайджесты через timingSafeEqual. Basic не принимается. Без ключа или с неверным — 401, ничего не сохраняется. Ключи дедупликации:

- flat-события — `eventType:contractId:status`;
- отмена — `subscription.cancelled:contractId`;
- envelope — `event:<event_id>`;
- неизвестные и невалидные события — sha256 канонического JSON с отсортированными ключами;
- факты сверки — `reconcile:<invoiceId>:<STATUS>`.

Событие сначала записывается (unique), затем обрабатывается в своей транзакции. 200 возвращается после записи, со статусом `processed | ignored | unmatched | mismatch | quarantined | invalid | duplicate | failed`. Ошибка БД при записи даёт 5xx, и Lava повторяет доставку. Unmatched платёж или отмена повторно сопоставляются через 1, 5, 15 мин, 1, 6, 24 ч; issue заводится после 3 попыток. Unmatched refund и chargeback не повторяются, они ждут оператора в своём case.

**Предположения о Lava (проверить в PAY-12).** `contractId` первого платежа совпадает с `id` из `POST /api/v3/invoice`, с `parentContractId` продлений и с `contractId` в `DELETE /api/v1/subscriptions` — так в примерах OpenAPI. `subscription.cancelled` может называть родительский контракт или контракт продления; поиск идёт по родителю, по оплатам и по сохранённым событиям продления. `tier_id` в refund/chargeback — это offerId.

**Подписки и доступ.** Подписка создаётся первым подтверждённым платежом. MONTHLY — это +1 календарный месяц UTC, день обрезается (31 января → 28/29 февраля). Первый период начинается во время платежа у провайдера, но не позже now. Продление продолжает текущий paidUntil, а если подписка уже просрочена — начинается с момента платежа. На каждый контракт — один BillingPeriod. Grant подписки действует до paidUntil + graceDays продукта. У Premium grace 3 дня (решение владельца, отличается от общего default 0), grace действует и для отменённой подписки. Разовая покупка даёт бессрочный grant (`validUntil = null`). Без продления в момент paidUntil состояние `active` меняется на `past_due`, а в paidUntil + grace — на `expired`; grant тоже становится `expired`, с событием. Доступ проверяется по validUntil без cron (INV-12). Отказ продления старше последнего подтверждённого платежа игнорируется. Продление после истечения снова активирует expired grant; revoked grant платёж не восстанавливает. Отмена: до ответа Lava — `cancel_requested`, потом `cancelling` (autoRenew=false). При timeout вызов повторяется через 1, 5, 15 мин, 1, 6 ч, затем заводится issue; при 400/404 issue заводится сразу. `willExpireAt` от Lava сохраняется, paidUntil не меняется; расхождение больше суток — issue.

**Сверка.** Открытые попытки проверяются через 1, 2, 5, 15, 30 мин, 1, 2, 6, 12, 24 ч. Для `ready` запрашивается `GET /api/v2/invoices/{id}`; COMPLETED и FAILED применяются тем же кодом, что и вебхук. `requesting` дольше 2×timeout + 30 с считается `unknown`. Для `unknown` запрашивается `GET /api/v2/invoices` по email покупателя, который мы сами отправили: все статусы, окно от момента запроса −2 мин. Invoice принимается, только если он ровно один, не привязан к другой попытке и совпадает по сумме, валюте и типу; неоплаченный invoice должен быть создан не позже 15 мин после запроса. Иначе attempt остаётся `unknown`, после 3 проверок заводится issue `checkout_unknown`. Это инженерное правило, владелец может его ужесточить. Сверка подписок по `GET /api/v1/subscriptions/{id}` (пропущенное продление) не реализована — follow-up PAY-10.

**Возвраты и споры.** Refund применяется только при проверенной связи. Их три вида:

- точный contract id в payload (в документированном примере его нет);
- ровно одна заявка оператора «refund requested» на оплату того же offer (`tier_id`) с тем же email покупателя, валютой и суммой;
- ручная привязка оператором с причиной и audit.

Иначе case становится `unmatched`, заводится issue, похожие оплаты попадают в evidence. Полный возврат разовой покупки переводит payment и order в `refunded`, отзывает только её grant и пишет −amount в журнал. Возврат периода подписки помечает период `refunded` и пересчитывает paidUntil по оставшимся оплаченным периодам, без grace. Частичный возврат уходит в `review_required`. Chargeback открывает case `open`, grants не трогает; payment становится `disputed` только при точной связи.

**Admin.** Чтение требует `billing.read`. Ручной grant и отзыв — новое право `grants.assign`, по умолчанию только у owner. Отмена продления — `subscriptions.cancel`, заявка и привязка возврата — `refunds.request`. Команды требуют reason и пишут audit. Токен для команды должен быть не старше последнего accessVersion из событий Identity (`identity.role.binding.changed.v1`, `identity.user.status.changed.v1`), иначе 401 и refresh. У пользователя может быть только один активный ручной grant на (service, feature).

**События.** Публикуются `billing.payment.confirmed.v1`, `billing.subscription.changed.v1` и `billing.grant.changed.v1`; aggregateVersion grant растёт при каждом изменении. Вместе с подтверждением оплаты уходит `notifications.intent.requested.v1` (шаблон `billing.payment-confirmed`). `billing.refund.recorded.v1` и `billing.reconciliation.issue.v1` пока не публикуются: у них нет потребителей.

## Wallet

По умолчанию выключен. Условные W-01…06 не входят в обязательную base acceptance. Paid/refunded totals админки — история, не тратимый баланс. При включении требуются merchant support, double-entry ledger, serialization, reserve/capture/release и debt policy. Пользовательские переводы и вывод денег не входят в исходный wallet scope.
