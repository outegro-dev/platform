# Рулетка: HTTP, WebSocket, fair-roll, кошелёк, бонус дня и админка

Решение и причины — [ADR-012](../03-decisions/adr/012-roulette.md). Схемы — `@outegro/contracts/roulette`, математика и алгоритм номера — `@outegro/roulette-engine`. Здесь — что идёт по проводам.

## Единица и лимиты

- Ставки — грамблсами (`GRM`) из кошелька, выигрыш зачисляется туда же (решение владельца 28.10.2026, [ADR-012](../03-decisions/adr/012-roulette.md)).
- Лимиты стола в грамблсах (конфиг `ROULETTE_*`):
  - ставка от 10 до 100 000;
  - не больше 3 ставок игрока за раунд;
  - выплата на один цвет за раунд не больше 1 000 000.
- Выплаты: красное (1–7) и чёрное (8–14) ×2, зелёное (0) ×14, ставка входит в выплату.

## Раунд

| Фаза | Длительность | Что происходит |
|---|---|---|
| `betting` | 20 с | Ставки принимаются |
| `locked` | 1 с | Приём закрыт, движок ждёт незавершённые списания до 800 мс, раскрывает сид |
| `rolling` | 6 с | Лента крутится от `rollingAt` и останавливается на номере |
| `settled` | 3 с | Выплаты зачислены; в `nextRoundAt` открывается следующий раунд |

Номер раунда равен номеру звена цепочки сидов. Пустой раунд тоже крутится.

## HTTP (roulette-backend, `/v1`)

Вызывает BFF roulette-web с access-токеном пользователя, кроме публичных маршрутов.

| Маршрут | Доступ | Ответ |
|---|---|---|
| `GET /v1/me` | вход | `{ userId, nickname, balance, unit: "GRM" }`; `balance` — `null`, если кошелёк его не сообщил |
| `POST /v1/ws-tickets` | вход | `{ ticket, expiresAt }`: одноразовый тикет сокета на 30 с |
| `GET /v1/rounds?cursor&limit` | публично | `{ items: [{ round, number, color }], nextCursor }`, новые сначала, только `settled` |
| `GET /v1/rounds/{round}` | публично | `FairRound`: фаза, `commit`, `publicSeed`, `seed`, `number`, `color`, `previousSeed`, число ставок, сумма ставок и выплат |
| `GET /v1/fair` | публично | `{ commit, publicSeed, chainLength, lastRevealed }` |

Ошибки — по [HTTP-контракту](http-errors.md). Ник в списках ставок — свой ник рулетки «Player NNNN». Имя и email из Identity в рулетку не попадают.

## WebSocket (`/ws?ticket=…`)

- Сокет открывается только с разрешённого Origin и по свежему тикету, как в battleship-backend.
- Не больше 8 сокетов на игрока.
- Бюджет — 10 команд в секунду, всплеск до 20.

**Клиент** шлёт `{ type, seq, payload }`:

| type | payload |
|---|---|
| `bet.place` | `{ clientBetId: uuid, color: "red" \| "black" \| "green", amount }`. Новый `clientBetId` на каждый клик; повтор и двойной клик его повторяют |
| `ping` | `{ t }` |

**Сервер** шлёт `{ type, payload, ref? }`, где `ref` — `seq` команды, на которую это ответ:

| type | Кому | payload |
|---|---|---|
| `session.ready` | первым сообщением | игрок (ник, баланс или `null`), стол (лимиты, множители, длительности), текущий раунд, свои ставки в нём, последние 20 результатов, `serverTime` |
| `round.state` | всем, 4 раза в секунду и на каждой смене фазы | полный снимок `RoundView` |
| `bet.accepted` | игроку, с `ref`; без `ref` — его другим вкладкам | ставка и баланс после списания |
| `balance` | игроку, который ставил в раунде | `{ balance, round, payout }` после выплат; `balance` — `null`, если кошелёк его не сообщил |
| `error` | игроку | `{ code, ref }` |
| `pong` | игроку | `{ t, serverTime }` |

**`RoundView`:**

- `round`, `phase`;
- `bettingEndsAt`, `rollingAt`, `settleAt`, `nextRoundAt` — абсолютное время, клиент поправляет его смещением часов по `pong`;
- `result: { number, color, seed }` — с фазы `rolling`;
- `totals` по цветам: `count`, `sum`, `top` — до 7 крупнейших ставок с ником и суммой.

Сервер не нумерует кадры: каждый снимок полный, и потеря тика лечится следующим.

**Место остановки ленты** внутри плитки — `stopOffset(seed)` из `@outegro/roulette-engine`, поэтому у всех клиентов лента встаёт одинаково.

**Коды ошибок:**

| Код | Когда |
|---|---|
| `bad_message` | Сообщение не по контракту |
| `round_closed` | Ставка пришла после закрытия: Valkey, запись или «надгробие» в кошельке |
| `bet_too_small`, `bet_too_large` | Сумма вне лимитов стола |
| `too_many_bets` | Уже 3 ставки в этом раунде |
| `table_limit` | Исчерпан лимит выплаты на цвет |
| `insufficient_funds` | В кошельке не хватает грамблсов |
| `wallet_restricted` | Кошелёк заблокирован |
| `wallet_unavailable` | Кошелёк не ответил за 2 с; списание откатывается по `ref` |
| `account_blocked` | Аккаунт заблокирован |
| `rate_limited` | Превышен бюджет команд сокета |
| `internal` | Внутренняя ошибка |

Отказ никогда не двигает грамблсы.

## Путь ставки и закрытие

1. **Lua-резерв в Valkey.** Проверяются фаза, число ставок игрока и лимит выплаты на цвет; повторный `clientBetId` распознаётся. Ставка попадает в незавершённые.
2. **Списание** `WalletPort.debit` с `ref = roulette:bet:{betId}`. `betId` — UUID из SHA-256 от `userId` и `clientBetId`.
3. **Пачечная запись в Postgres.** Пачка пишется раз в 5 мс одной транзакцией. Транзакция держит строку раунда `FOR SHARE` и вставляет ставки только при статусе `betting`.
4. **Ответ игроку** — после коммита. Если раунд уже закрыт, списание откатывается и игрок получает `round_closed`.

Повтор того же `clientBetId` не списывает второй раз: он ждёт исход первой попытки и отвечает той же ставкой.

**Закрытие:**

1. Фаза в Valkey становится `locked`.
2. Движок до 800 мс ждёт незавершённые ставки.
3. `UPDATE rounds … status = 'locked'`. Этот запрос ждёт открытые пачки.
4. Незавершённые ставки, которых нет в записи, откатываются по `ref`. Опоздавшее списание получает 409, игрок — `round_closed`.

**Расчёт:** выигрыши уходят в `creditBatch` пачками до 1 000 с `ref = roulette:win:{betId}`, затем одна транзакция помечает ставки `won` / `lost` и закрывает раунд.

## fair-roll-backend (внутренний, порт 4100)

Сервисный токен `INTERNAL_API_TOKEN`, вызывает только roulette-backend.

| Маршрут | Ответ |
|---|---|
| `GET /v1/internal/chain` | `{ commit, publicSeed, chainLength, lastRevealed }` |
| `POST /v1/internal/rounds/{k}/reveal` | `{ round, seed, number, color }` |

Ошибки `reveal`:

| Код | Когда |
|---|---|
| 400 | `k < 1` или не число |
| 409 | `k` не следующий раунд и не повтор последнего |
| 422 | Цепочка исчерпана |

- **Секреты и параметры:** `FAIR_ROLL_ROOT` (64 hex), `FAIR_ROLL_CHAIN_LENGTH` (по умолчанию 1 000 000), `FAIR_ROLL_PUBLIC_SEED`.
- **Хранение:** коммит и публичный сид лежат в таблице `chains`, раскрытые раунды — в `reveals`. Порядок раскрытия переживает перезапуск.
- **Защита коммита:** если опубликованной цепочке сменить публичный сид или длину, сервис не стартует.

**Алгоритм номера:**

- `seed[k−1] = SHA-256(seed[k])`;
- номер = `HMAC-SHA256(key = seed[k], "publicSeed:k:attempt")`: первые 4 байта big-endian, значение `0xFFFFFFFF` отбрасывается, остаток — по модулю 15.

**Контрольный пример:** root 32 × `0x01`, цепочка 1 000 000, публичный сид `drand:1234567`:

- `seed[0] = 2158ee1c…1cd0`;
- раунд 1 → `seed = ca993cd7…4db13125`, номер 8, чёрное.

## Порт кошелька

Рулетка ходит во внутренний API wallet-backend (:4007, PR #143) с сервисным токеном. `WALLET_MODE=memory` — замена для запуска без кошелька, в production запрещена.

| Вызов | Тело | Ответ, который берёт рулетка |
|---|---|---|
| `POST /v1/internal/debit` | `{ ref: "roulette:bet:{betId}", userId, unit: "GRM", amount: "250", source: "roulette", objectRef: "round:{k}", meta: { round, color } }` | `balanceAfter` |
| `POST /v1/internal/credit-batch` | `{ unit: "GRM", source: "roulette", items: [{ ref: "roulette:win:{betId}", userId, amount, objectRef, meta }] }`, до 1 000 строк | `balanceAfter` и `replayed` каждой строки |
| `POST /v1/internal/rollback` | `{ ref }` | `state: reversed \| tombstoned` |

Суммы — строки целого числа. Ошибки:

| Ответ | Для рулетки |
|---|---|
| 402 `INSUFFICIENT_FUNDS` | `insufficient_funds` |
| 423 `WALLET_RESTRICTED` | `wallet_restricted` |
| 409 `IDEMPOTENCY_CONFLICT` (`conflict` или `rolled_back`) | `round_closed`: ставка опоздала или повтор не совпал |
| остальное, таймаут 3 с | `wallet_unavailable`, списание откатывается по `ref` |

`rollback` без списания ставит «надгробие», опоздавший `debit` получает 409. Внутреннего чтения баланса у кошелька пока нет (запрошено): до него баланс в `session.ready`, `/v1/me` и `balance` для проигравших — `null`.

## Valkey рулетки

Префикс `roulette:`. В production это отдельный инстанс.

| Ключ | Что |
|---|---|
| `leader` | id экземпляра-лидера, PX 5000 |
| `round:{k}` | hash: `phase`; по игроку `n:{userId}` (ставок в раунде) и `b:{userId}:{clientBetId}` (betId); по цвету `x:` (экспозиция), `s:` (сумма), `c:` (число ставок) |
| `round:{k}:pending` | незавершённые ставки |
| `round:{k}:top:{color}` | zset ставок по сумме |
| `round:{k}:lines` | ник и сумма для списков |

- Все ключи раунда живут час.
- Канал pub/sub — `roulette:events`. В нём кадры `round.state`, уже сериализованные.

## Админ-API roulette-backend (`/v1/admin`, admin-web)

| Маршрут | Право | Ответ |
|---|---|---|
| `GET /live` | `roulette.read` | `AdminLive`: раунд, онлайн по всем репликам, настройки стола, экспозиция цветов, касса за сутки и всего |
| `GET /rounds?cursor&limit` | `roulette.read` | раунды, новые сначала, с результатом кассы |
| `GET /rounds/{k}` | `roulette.read` | карточка: сид, предыдущий сид, коммит, проверка звена на сервере, крупнейшие ставки |
| `POST /rounds/{k}/void` | `roulette.void` | `{ reason, preview? }` → сколько ставок и грамблсов возвращено |
| `GET /players?q&cursor&limit`, `GET /players/{userId}` | `roulette.read` | оборот, выплаты, результат игрока, последние ставки |
| `GET /table` | `roulette.read` | `TableSettings`: лимиты, пауза, обслуживание, версия |
| `POST /table` | `roulette.manage` | `{ лимиты, paused, maintenance, expectedVersion, reason, preview? }` → `{ preview, before, after }` |
| `GET /services` | `roulette.read` | здоровье roulette-backend, fair-roll, daily-bonus, wallet; лидер и остаток аренды; возраст тика; режим кошелька |
| `GET /audit?cursor` | `roulette.read` | команды: кто, что, почему, когда |

- Команды проверяют актора через lookup Identity: токен старше последней смены ролей — 401, заблокированный актор — 403. Устаревшая версия — 409 `VERSION_CONFLICT`.
- Пауза: ставки отклоняются кодом `bets_paused`, раунды крутятся. Обслуживание: текущий раунд доигрывается, новый не открывается. Оба флага приходят в каждом `round.state` (`table.paused`, `table.maintenance`).
- Аннулированный раунд — фаза `voided`, результата в снимке нет, ставки в статусе `refunded`. Касса считает только `settled`.
- Внутренний статус `paying` (выигрыши уходят в кошелёк) наружу виден как `rolling`.

## Бонус дня (daily-bonus-backend, :4101)

Схемы — `@outegro/contracts/daily-bonus`.

| Маршрут | Доступ | Ответ |
|---|---|---|
| `GET /v1/daily` | вход | `{ available, nextAt, blocked, streak, streakBonusPercent, prizes }` |
| `POST /v1/daily/claim` | вход | `{ claimNo, prizeIndex, basePrize, prize, streak, nextAt, balance }` |
| `GET /v1/admin/daily` | `roulette.read` | настройки, средний приз, выдачи за сутки, подозрения (общая сеть или устройство) |
| `POST /v1/admin/daily/settings` | `roulette.manage` | `{ enabled, streaksEnabled, prizes, expectedVersion, reason, preview? }` |

BFF roulette-web передаёт адрес клиента (`x-forwarded-for`) и `x-device-id` из HttpOnly-куки `og_device`.

Ошибки `claim`:

| Ответ | Когда |
|---|---|
| 409 `CONFLICT`, `fieldErrors.nextAt` | ещё рано |
| 403 `FORBIDDEN`, `fieldErrors.reason` | `email_unverified`, `account_too_new`, `account_closed`, `disabled` |
| 429 `RATE_LIMITED`, `fieldErrors.reason` | `ip_limit` или `device_limit`: три бонуса в сутки на сеть или устройство уже взяты |
| 503 | кошелёк не ответил; выдача сохранена, повтор её завершит |

Начисление — `POST /v1/internal/credit-batch` кошелька: одна строка, `source: "daily-bonus"`, `ref: "daily:{userId}:{claimNo}"`, `objectRef: "claim:{claimNo}"`.

## Локальный запуск

1. **Базы.** `infra/local/postgres/init.sql` создаёт БД `roulette`, `fair_roll` и `daily` только на свежем томе. Если локальный Postgres уже работал, создайте их вручную (роли и пароли — как в `init.sql`).
2. **Переменные.** `pnpm env:local` дописывает `.env` для fair-roll-backend и roulette-backend: общий `INTERNAL_API_TOKEN` и свежий `FAIR_ROLL_ROOT`. В `OAUTH_CLIENTS` auth-backend появился клиент `roulette-web`; если `.env` auth-backend уже есть, допишите клиента туда вручную.
3. **Миграции:** `pnpm --filter @outegro/fair-roll-backend db:migrate` и `pnpm --filter @outegro/roulette-backend db:migrate` (после `build`).
4. **Запуск:** сначала fair-roll-backend (:4100), потом roulette-backend (:4006) и daily-bonus-backend (:4101), потом roulette-web (:3007). Для настоящих грамблсов — wallet-backend с ветки `feat/wallet` (:4007) и `WALLET_MODE=http` в обоих сервисах.

Кошелёк в памяти — одна реплика roulette-backend. Балансы сбрасываются при перезапуске.

## События

В RabbitMQ рулетка пока ничего не публикует и не слушает. Правило платформы — событие появляется вместе с потребителем.

Кандидаты:

- `roulette.round-settled.v1` — для проекций админки и топа недели;
- подписка на `identity.user.status.changed.v1` — блокировать аккаунт в рулетке.
