# Wallet: грамблсы

Контракт сервиса `wallet-backend` ([ADR-011](../03-decisions/adr/011-wallet-grumbles.md)). Этап 1: без денег. Меняется только вместе с кодом и тестами `apps/wallet-backend`.

## Единица и суммы

- Единица одна — `GRM` (грамблсы; EN grumble / grumbles; RU грамблс, грамблса, грамблсов). Целые числа, без дробей и scale. Поле `unit` есть в каждой строке на будущее; неизвестная единица — 400 `VALIDATION_FAILED` с `fieldErrors.unit`.
- Суммы в DTO — строки целого числа, как minor в [HTTP-контракте](http-errors.md): `"1250"`. Сумма команды — от 1 до 10¹⁵ − 1. В журнале и ответах `amount` со знаком: `+` зачисление, `−` списание.
- Кошелёк — пара (пользователь, единица). Его нет, пока не было первой операции: чтение отвечает балансом `"0"` и `exists: false`.
- Переводов между пользователями и вывода нет. Рулетка ставит те же грамблсы через внутренний API ([ADR-011](../03-decisions/adr/011-wallet-grumbles.md)).

## Журнал и счета

| Таблица | Что хранит | Гарантии |
|---|---|---|
| `wallets` | user_id + unit (PK), balance, state (`active` / `restricted`), restricted_reason, version, created_at, updated_at | `balance >= 0`; кэш журнала, меняется только операцией в той же транзакции |
| `wallet_tx` | id, user_id, unit, kind, source, object_ref, ref, amount со знаком, balance_before, balance_after, wallet_version, counter_account, reason, actor_id, meta, correlation_id, created_at | только INSERT: у роли приложения нет UPDATE, DELETE и TRUNCATE, триггер отклоняет их у любой роли; `balance_after = balance_before + amount`, `balance_after >= 0`, unique (user_id, unit, wallet_version) |
| `wallet_refs` | ref (PK), operation, tx_id, request_fingerprint, created_at | идемпотентность и надгробия; только INSERT; отдельно от журнала, чтобы журнал можно было резать на партиции |
| `system_accounts` | code + unit (PK), balance | вторая нога каждой операции |
| `users` | user_id, status, status_version, access_version | проекция Identity для блокировки и команд админки |
| `reconciliation_issues`, `reconciliation_runs`, `audit_log` | расхождения сверки, проходы сверки, команды операторов | — |

Строка `wallet_tx` — нога игрока; вторая нога — системный счёт `counter_account` с суммой `−amount`, его баланс меняется в той же транзакции. Поэтому для каждой единицы сумма балансов всех кошельков и всех системных счетов равна нулю.

У каждой операции есть источник `source` — какой сервис и зачем: `roulette`, `daily-bonus`, `battleship-shop`, `pay` (внутренний API) или `admin` (команды админки) — и необязательная ссылка на объект `object_ref`: `round:1207`, `order:<uuid>` (до 200 символов `[A-Za-z0-9._:-]`). Откат наследует источник и объект своего списания.

| Операция | kind | ref | Игрок | Второй счёт |
|---|---|---|---|---|
| Начисление оператором (оператор, промо, компенсация) | `grant` | `grant:{commandId}` | +N | `issued_bonus` −N |
| Списание оператором | `adjust` | `adjust:{commandId}` | −N | `adjust` +N |
| Установка баланса оператором | `grant` или `adjust` на разницу | `set:{commandId}` | ±разница | как у `grant` / `adjust` |
| Списание по внутреннему API (покупка, ставка) | `debit` | задаёт вызывающий, например `order:{orderId}` | −N | `spent` +N |
| Зачисление по внутреннему API: выплаты рулетки, возвраты | `credit` | задаёт вызывающий | +N | `spent` −N |
| Зачисление ежедневного бонуса (`source: daily-bonus`) | `credit` | `daily:{userId}:{claimNo}` | +N | `issued_bonus` −N |
| Откат списания | `reversal` | `rollback:{ref}` | +N | счёт списания (`spent`) −N |

`issued_purchase` (этап 2, пакеты: зачисление с `source: pay`) и `expired` (сгорание бонусов, если владелец его введёт) заведены сразу и пока не двигаются. Списание по API не проходит, если кошелёк `restricted`; начисление, зачисление, откат и списание оператором проходят в любом состоянии.

Порядок блокировок: строки кошельков в порядке (user_id, unit), затем строки системных счетов в порядке code. Операция — одна транзакция PostgreSQL READ COMMITTED.

## Идемпотентность по ref

- `ref`: 1–200 символов `[A-Za-z0-9._:-]`. Префиксы `grant:`, `adjust:`, `set:` и `rollback:` ставит сам сервис; во внутреннем API они дают 400.
- Отпечаток запроса — sha256 от операции, игрока, единицы, суммы (у установки — целевого баланса) и источника. Причина, `objectRef`, `meta` и `correlationId` в него не входят: повтор с другим текстом причины — тот же запрос.
- Операция сначала занимает ref в `wallet_refs` (отпечаток и id будущей строки журнала), потом проводит, всё в одной транзакции. Сохранённый ответ — строка журнала, на которую указывает ref: она не меняется. Повтор с тем же отпечатком возвращает её с `replayed: true` и ничего не пишет; одновременный повтор ждёт коммита первого. Тот же ref с другим отпечатком или другой операцией — 409 `IDEMPOTENCY_CONFLICT`, `fieldErrors.ref: ["conflict"]`.
- Отказ (402, 423, 400) не сохраняется: после пополнения тот же ref можно повторить.
- Откат списания с ref X: если списание X есть — обратная проводка `reversal` с ref `rollback:X`. Если списания нет — надгробие: строка X с операцией `tombstone`; опоздавшее списание с этим ref получает 409 `IDEMPOTENCY_CONFLICT`, `fieldErrors.ref: ["rolled_back"]`. Повтор отката возвращает прежний ответ. Откат ref начисления или зачисления — 422 `UNPROCESSABLE`, `fieldErrors.ref: ["not_debit"]`.
- Одновременные списание и откат одного ref упорядочивает уникальный индекс `wallet_refs`: второй ждёт коммита первого и видит его результат.

## Внутренний API

Потребители — payments (покупки, этап 3) и roulette-backend (ставки, выплаты, отмены). Только из кластера: заголовок `Authorization: Bearer <INTERNAL_API_TOKEN>` (общий сервисный токен, `createServiceTokenGuard`), без пользовательской сессии. Тело — JSON.

| Route | Вход | Ответ 200 |
|---|---|---|
| `POST /v1/internal/debit` | `ref`, `userId`, `unit`, `amount`, `source`, `objectRef?`, `reason?` (до 500), `meta?` (объект до 2 КБ), `correlationId?` | операция: `txId`, `ref`, `userId`, `unit`, `kind`, `source`, `objectRef`, `amount` (со знаком), `balanceBefore`, `balanceAfter`, `createdAt`, `replayed` |
| `POST /v1/internal/credit-batch` | `unit`, `source` (одна пачка — один источник), `items` (1–1 000: `ref`, `userId`, `amount`, `objectRef?`, `reason?`, `meta?`), `correlationId?` | `{ items: [операция] }` в порядке запроса |
| `POST /v1/internal/rollback` | `ref` списания, `reason?`, `correlationId?` | `{ ref, state: "reversed" \| "tombstoned", reversal: операция \| null, replayed }` |
| `POST /v1/internal/balances` | `unit`, `userIds` (1–1 000) | `{ items: [{ userId, unit, balance, state, exists }] }` по одному на id в порядке запроса; игрок без кошелька — `"0"`, `exists: false`, `restricted`, если аккаунт заблокирован. Только чтение, для сокета рулетки без пользовательского токена |

`source` во внутреннем API — `roulette`, `daily-bonus`, `battleship-shop` или `pay`; без него или с `admin` — 400. Ежедневный бонус — пачка из одной строки с `source: daily-bonus`.

Пачка — всё или ничего: конфликт любой строки даёт 409 с `fieldErrors["items.<i>.ref"]`, и ни одна строка не записана; повтор пачки целиком возвращает прежние операции. Одинаковые ref внутри пачки — 400. Строки одного игрока применяются по порядку.

Ошибки сверх [общих](http-errors.md):

| Code | HTTP | Когда |
|---|---|---|
| `INSUFFICIENT_FUNDS` | 402 | баланса не хватает на списание (кошелька нет — баланс 0); `retryable: false` |
| `WALLET_RESTRICTED` | 423 | списание по API из кошелька в `restricted` (аккаунт заблокирован или удалён); проверяется раньше нехватки |
| `IDEMPOTENCY_CONFLICT` | 409 | `ref: conflict` — тот же ref с другими данными; `ref: rolled_back` — ref уже откатан |

## API игрока

Сессия пользователя, только свой кошелёк (INV-10).

| Route | Вход | Ответ |
|---|---|---|
| `GET /v1/me/wallet` | `unit?` (по умолчанию `GRM`) | `unit`, `balance`, `state`, `exists`, `updatedAt` |
| `GET /v1/me/wallet/history` | `unit?`, `cursor?`, `limit?` (25, до 100) | `items`: `id`, `kind`, `source`, `amount`, `balanceBefore`, `balanceAfter`, `createdAt`; `nextCursor` |

Игрок видит источник (рулетка, бонус, магазин), но не причину, `ref`, объект, `meta` и автора: это внутренние данные оператора и сервисов.

## API админки

`wallet.read` — чтение, `wallet.adjust` — команды; по умолчанию оба только у owner ([identity-access](identity-access.md)).

| Route | Право | Вход | Ответ |
|---|---|---|---|
| `GET /v1/admin/overview` | `wallet.read` | `unit?` | на руках у игроков, число кошельков и `restricted`, операции за 24 часа по видам, обороты за 24 часа по источникам (операций, пришло, ушло), системные счета, открытые расхождения, последний проход сверки |
| `GET /v1/admin/wallets` | `wallet.read` | `unit?`, `state?`, `userId?`, `cursor?`, `limit?` | кошельки по `updated_at` убыв., `nextCursor` |
| `GET /v1/admin/wallets/{userId}` | `wallet.read` | `unit?`, `source?`, `cursor?`, `limit?` | кошелёк (или `exists: false` и ноль) и журнал, при `source` — только этого источника: вид, источник, объект, ref, сумма, было → стало, второй счёт, причина, автор, meta, correlationId, время |
| `POST /v1/admin/wallets/{userId}/grant` | `wallet.adjust` | `unit`, `amount`, `reason`, `commandId` (UUID), `preview?` | `preview: true` — `{ preview, balanceBefore, balanceAfter }` без записи; иначе операция |
| `POST /v1/admin/wallets/{userId}/adjust` | `wallet.adjust` | то же | то же; нехватка — 402 и в предпросмотре |
| `POST /v1/admin/wallets/{userId}/set-balance` | `wallet.adjust` | `unit`, `balance` (целевой, от 0), `reason`, `commandId`, `preview?` | под блокировкой кошелька разница начисляется (`grant`) или списывается (`adjust`) одной операцией; тот же баланс — 422 `balance: unchanged`, разница больше лимита — 400 `amount: too_large`; предпросмотр — «было → станет» |
| `GET /v1/admin/reconciliation` | `wallet.read` | — | открытые и недавно закрытые расхождения, последние проходы |
| `GET /v1/admin/audit` | `wallet.read` | `cursor?` | команды операторов: кто, что, кому, сумма, причина, requestId |

Команды: причина обязательна (`adminReasonSchema`), сумма не больше `WALLET_ADMIN_MAX_AMOUNT` (инженерный default 1 000 000), токен не старше последнего accessVersion из событий Identity (иначе 401 и refresh), автор не заблокирован (иначе 403). ref команды — `grant:{commandId}`, `adjust:{commandId}` или `set:{commandId}`: повторная отправка той же формы не начисляет дважды. Источник команд — `admin`. Аудит (`wallet.grant`, `wallet.adjust`, `wallet.set`) пишется в транзакции операции.

## События

- Слушает (очередь `wallet.identity-events`): `identity.user.status.changed.v1` — `suspended` и `deleted` переводят кошельки пользователя в `restricted` с причиной `account_suspended` / `account_deleted`, `active` снимает только эти причины; `identity.role.binding.changed.v1` — accessVersion для команд. Статус старше сохранённого ничего не меняет. Баланс и журнал удалённого аккаунта сохраняются.
- Публикует: ничего, пока нет потребителя. Первым станет `wallet.credited.v1` (уведомление «начислено N грамблсов»), когда notifications получит шаблон.
- Этап 2: inbox `billing.grumbles-purchased.v1` (зачисление пакета, ref `pack:payment:{paymentId}`) и `billing.grumbles-reversed.v1`.

## Сверка и метрики

- Проход каждые 5 минут (`RECONCILE_INTERVAL_MS`): кошельки, изменённые после прошлого прохода, плюс 100 случайных; все системные счета; нулевая сумма по единице. Раз в сутки после `RECONCILE_FULL_HOUR_UTC` (default 2) — все кошельки.
- Виды расхождений: `balance_drift` — кэш кошелька не равен сумме журнала; `chain_break` — `balance_before` не равен `balance_after` предыдущей операции или версии идут с пропуском; `system_drift` — баланс системного счёта не равен минус сумме его ног; `zero_sum` — сумма всех счетов единицы не ноль. Одна открытая строка на (вид, subject); проход, нашедший subject чистым, закрывает её. Сверка ничего не чинит.
- Метрики (порт 9467): `wallet_operations_total{kind,result}` (`kind` — вид операции или `set`), `wallet_operation_duration_seconds{kind}`, `wallet_idempotent_replays_total{kind}`, `wallet_balance_total{unit}`, `wallet_reconciliation_issues{type}`, `wallet_reconciliation_last_success_timestamp_seconds`. Алерт — открытые расхождения больше нуля или сверка молчит дольше 30 минут.
