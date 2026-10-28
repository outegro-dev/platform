# Отчёт W-05

- Статус: blocked — код за выключенным флагом, ждёт GRUMBLE-PRICES (цены скинов, решение по Premium)
- Task card: [W-05](../../../04-delivery/90-optional-wallet/tasks/W-05.md)
- Commit/ref и dirty files: ветка `feat/wallet-shop` поверх `feat/wallet-packs` (W-04), коммит 0fdc359 и документы следом; не смёржено
- Environment/runtime: Windows 11, Node 24, PostgreSQL 18.6 / Valkey / RabbitMQ в Testcontainers, кошелёк — HTTP-фейк его внутреннего API (`apps/payments-backend/src/test/fake-wallet.ts`), его поведение сверено с тестами wallet-backend
- Прочитанные contracts/ADR: [ADR-011](../../../03-decisions/adr/011-wallet-grumbles.md), [wallet](../../../02-contracts/wallet.md), [billing](../../../02-contracts/billing.md)
- Dependency evidence: W-04 — [20261028-packs-flag](../../W-04/20261028-packs-flag/report.md) (пакеты для пути «не хватает»); PAY-06 — grants и их события, тесты payments зелёные (162)

Команда владельца 28.10.2026: этапы 2–3 писать кодом за выключенным флагом, без выдуманных цен (INV-03).

## Изменения

- `apps/payments-backend`: `POST /v1/checkout/grumbles` (Idempotency-Key, только `productKey`); таблица `wallet_orders` (миграция 0004, только добавляет); клиент внутреннего API кошелька (debit, rollback, balances) с таймаутом 5 с; `priceGrumbles` в каталоге; конфигурация `GRUMBLE_PRICES_ENABLED`, `GRUMBLE_PRICES`, `WALLET_API_URL`.
- `apps/pay-web`: кнопка «Купить за N грамблсов» под денежной, подтверждение, итог, недостача со ссылкой на пакет на той же странице; фокус переходит между кнопками.
- Отступление от ADR-011, записанное в нём: заказ за грамблсы — своя таблица, а не `orders` с `funding = wallet`. Денежные заказы, платежи, `financial_entries` и сверка с Lava остаются только денежными, и `GRM` в них попасть не может.

## Checkpoints

| Checkpoint | Результат | Evidence |
|---|---|---|
| C1 контракт/исходное поведение | описан | [billing](../../../02-contracts/billing.md), [wallet-rollout](../../../06-operations/wallet-rollout.md) |
| C2.1 цены и Premium | blocked: GRUMBLE-PRICES нет; цена в тестах — фикстура | `GRUMBLE_PRICES={}` в `.env.example` |
| C2.2 заказ, списание, grant, откат | сделано | `apps/payments-backend/src/grumble-checkout.test.ts` |
| C2.3 путь нехватки | сделано без хранимого намерения: ответ с недостачей и пакетом, возврат к той же покупке — повторное нажатие | тот же тест, скриншоты pay-web |
| C2.4 UI | pay-web — сделано; battleship-web — нет | `catalog-grumbles-short--*.png` |
| C3 проверки | зелёные | ниже |
| C4 handoff | этот отчёт | — |

## Проверки

| TC-ID/команда | Environment | Фактический результат | pass/fail/blocked/not-run | Evidence |
|---|---|---|---|---|
| TC-W-05-01 | Testcontainers + фейк кошелька | одно списание по `order:{id}` с источником `battleship-shop`, заказ `paid`, grant `purchase`, событие `billing.grant.changed.v1`; денежных заказов и записей журнала нет; тот же ключ — тот же ответ без второго списания | pass | «debits once by the order's ref…», «answers the same key…» |
| TC-W-05-02 | то же | баланс 100 при цене 500: `short`, недостача 400, пакет `grumbles-1000`, заказа нет; после пополнения та же покупка проходит; отказ кошелька в гонке даёт тот же ответ | pass | «says how many are missing…», «turns a debit refused in a race…» |
| TC-W-05-03 | то же | сбой grant: списание откатано тем же ref, баланс прежний, заказ `failed: grant_failed`, grant нет; потерянный ответ списания откатан, кошелёк недоступен — 503 без заказа | pass | «gives the grumbles back…», «rolls back a debit whose answer was lost…», «…when it is down» |
| TC-W-05-04 | то же | купленное — 422 `ALREADY_OWNED` без списания; два одновременных клика — один заказ, одно списание, один grant | pass | «refuses what the buyer owns…», «makes one order and one debit…» |
| `pnpm test` payments-backend | Testcontainers | 162 passed | pass | — |
| `pnpm test` pay-web | Vitest | 150 passed | pass | — |
| pay-web `screens -g catalog` | Playwright | 16 passed: каталог с ценой в грамблсах и нехватка, desktop/mobile EN/RU | pass | скриншоты не коммитятся |
| `pnpm exec biome check .`, `pnpm turbo run typecheck` | локально | 0 ошибок | pass | — |

## Ограничения и незавершённое

- Цен и решения по Premium нет (GRUMBLE-PRICES). Premium сейчас включает все скины на время подписки: при выборе цены скина это надо учесть. Подписка и пакеты за грамблсы не продаются.
- Намерение покупки с TTL не хранится в payments: после нехватки игрок пополняет пакетом на той же странице каталога и нажимает «Купить за N грамблсов» снова. Возврат со страницы оплаты пакета ведёт на обычную страницу результата, а не к подтверждению скина.
- Кнопки в магазине battleship-web нет: battleship-web ведёт в каталог pay-web, где кнопка есть.
- Заказы за грамблсы не видны в «Покупках» pay-web и в карточке заказа админки payments: их видно в журнале кошелька (`debit`, `order:{id}`) и по grant. Квитанции нет.
- Заказ, оставшийся `pending` (ответ списания потерян и откат не прошёл), доводит повтор с тем же ключом; фонового воркера для таких заказов нет.
- На мобильных скриншотах pay-web поверх страницы видна скип-ссылка. Это артефакт съёмки, он есть и на существующих экранах (`subscriptions-cancelled`); проверка показала, что фокус после ответа на кнопке покупки.

## Откат

До включения флага — revert PR: миграция 0004 только добавляет таблицу. После покупок — только вперёд: `GRUMBLE_PRICES_ENABLED=false` убирает кнопку и цены, купленные grant и журнал кошелька остаются.

## Следующая задача / resume point

W-05: получить GRUMBLE-PRICES и решение по Premium, задать в gitops `WALLET_API_URL`, `GRUMBLE_PRICES` и `GRUMBLE_PRICES_ENABLED=true` у payments (после W-04), купить скин со своего кошелька. Потом — список заказов за грамблсы в pay-web и админке, кнопка в battleship-web.
