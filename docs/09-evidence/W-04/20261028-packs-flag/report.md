# Отчёт W-04

- Статус: blocked — код за выключенным флагом, ждёт GRUMBLE-PACKS и реальной покупки (TC-W-04-04)
- Task card: [W-04](../../../04-delivery/90-optional-wallet/tasks/W-04.md)
- Commit/ref и dirty files: ветка `feat/wallet-packs` от `master` 13e466d (этап 1 уже в production), коммит c1eb9d3 и документы следом; не смёржено
- Environment/runtime: Windows 11, Node 24, PostgreSQL 18.6 / Valkey / RabbitMQ в Testcontainers
- Прочитанные contracts/ADR: [ADR-011](../../../03-decisions/adr/011-wallet-grumbles.md), [wallet](../../../02-contracts/wallet.md), [billing](../../../02-contracts/billing.md), [events](../../../02-contracts/events.md), [wallet-proposal](../../../03-decisions/wallet-proposal.md) §4
- Dependency evidence: W-06 — этап 1 в production 28.10.2026 ([wallet-rollout](../../../06-operations/wallet-rollout.md)); PAY-03, PAY-05, PAY-09 — существующие checkout, settlement и возвраты payments, их тесты зелёные (152)

Команда владельца 28.10.2026: этапы 2–3 писать кодом за выключенным флагом, без выдуманных цен (INV-03).

## Изменения

- `packages/contracts`: события `billing.grumbles-purchased.v1` и `billing.grumbles-reversed.v1`; виды операций `purchase` и `clawback`; зарезервированный префикс ref `pack:`; поле `debt` у кошелька в админке; вид расхождения `debt_drift`.
- `apps/payments-backend`: продукт `grumble_pack` из `GRUMBLE_PACKS` (JSON, проверяется при старте) только при `GRUMBLE_PACKS_ENABLED=true`; колонка `grumbles` у `products` и `orders` с CHECK (миграция 0003, только добавляет); оплаченный пакет не выдаёт grant, а кладёт в outbox `billing.payment.confirmed.v1` и `billing.grumbles-purchased.v1`; пакет покупается повторно; возврат пакета, весь или частью, применяется сам и просит назад оплаченные этой суммой грамблсы (округление вниз, части считаются от уже возвращённых денег); сопоставленный chargeback просит назад то, что не забрали возвраты.
- `apps/wallet-backend`: очередь `wallet.billing-events`; `purchase` по `pack:payment:{paymentId}` против `issued_purchase` и лот `wallet_lots`; `clawback` по `pack:case:{caseId}` — сколько есть, до запрошенного, остаток в `wallets.debt` и `restricted` с причиной `debt`; погашение долга следующим пакетом `pack:repay:{paymentId}`; аккаунт должника, возвращённый в `active`, остаётся `restricted`; лоты и возвраты только INSERT (миграция 0002, REVOKE); сверка `debt_drift`.
- `apps/admin-web`: подписи видов, причины и расхождения, долг в карточке кошелька. `apps/pay-web`: пакеты в каталоге группой «Кошелёк» с монетой грамблсов.

Потребители событий — только wallet. Этап 1 в production не меняется, пока миграции 0002/0003 не выкачены; обе только добавляют.

## Checkpoints

| Checkpoint | Результат | Evidence |
|---|---|---|
| C1 контракт/исходное поведение | события, виды, ref, долг описаны | [wallet](../../../02-contracts/wallet.md), [billing](../../../02-contracts/billing.md), [events](../../../02-contracts/events.md) |
| C2.1 пакеты владельца | blocked: GRUMBLE-PACKS нет; цены только в тестах | `GRUMBLE_PACKS=[]` в `.env.example` |
| C2.2 зачисление | сделано | `apps/wallet-backend/src/packs.test.ts`, `apps/payments-backend/src/packs.test.ts` |
| C2.3 возврат и chargeback | сделано; отчёт об обязательствах по валютам — нет | те же тесты |
| C2.4 реальная покупка | blocked | — |
| C3 проверки | зелёные | ниже |
| C4 handoff | этот отчёт | — |

## Проверки

| TC-ID/команда | Environment | Фактический результат | pass/fail/blocked/not-run | Evidence |
|---|---|---|---|---|
| TC-W-04-01 | Testcontainers | событие дважды, тот же платёж под другим eventId и 6 одновременных доставок дают одну операцию `purchase`, один лот; кэш равен журналу, сумма счетов 0 | pass | wallet `packs.test.ts` «is credited once…», «…when two deliveries race»; payments «opens no access and asks the wallet to credit it once» |
| TC-W-04-02 | Testcontainers | заказ без вебхука остаётся `pending`, события зачисления нет | pass | payments «is never a credit before the provider confirms it» |
| TC-W-04-03 | Testcontainers | частичный возврат 33 из 99 ₽ просит 333, остаток 667; кейсы вместе не больше пакета; chargeback после траты 700 из 1000 забирает 300, долг 700, `restricted`; следующий пакет гасит долг и снимает ограничение; история не удаляется | pass | wallet «takes back a partial refund…», «leaves what was spent as a debt…», «pays a debt off in parts…»; payments «asks back the share of each partial refund…», «asks back on a chargeback…» |
| TC-W-04-04 | production | не выполнялся: нет офферов Lava | blocked | — |
| TC-W-04-05 | Testcontainers | `currency: GRM` в checkout — 400; инвойс и `financial_entries` только в валюте оплаты | pass | payments «is sold in money only…», «opens no access…» |
| `pnpm test` wallet-backend | Testcontainers | 43 passed | pass | — |
| `pnpm test` payments-backend | Testcontainers | 152 passed | pass | — |
| `pnpm test` admin-web, pay-web, contracts | Vitest | 202, 149, 35 passed | pass | — |
| pay-web `screens -g catalog` | Playwright | 12 passed, каталог с пакетами desktop/mobile EN/RU | pass | `catalog-packs--*.png` (не коммитятся) |
| `pnpm exec biome check .`, `pnpm turbo run typecheck` | локально | 0 ошибок | pass | — |

## Ограничения и незавершённое

- Пакетов, цен и офферов нет (GRUMBLE-PACKS): цены в тестах — фикстуры, приёмка с реальным провайдером не отмечена.
- Chargeback без номера контракта (так выглядит документированный пример Lava) остаётся несопоставленным оператору, как у остальных продуктов: оператор забирает грамблсы командой «Списать» в админке.
- Нет отчёта об обязательствах по валютам и списка лотов в админке: лоты видны строками `purchase` в журнале кошелька. Нет квитанции о покупке пакета: у Notifications нет шаблона.
- Порядок трат (сначала бонусные, потом купленные) не вводился: долг считается от баланса целиком. Это решение владельца, если понадобится возвращать «неистраченный купленный остаток» точнее.

## Откат

До включения флага — revert PR: миграции 0002 (wallet) и 0003 (payments) только добавляют и с пустыми данными ничего не ломают. После первых покупок — только вперёд: лоты, возвраты и журнал не удаляются, флаг `GRUMBLE_PACKS_ENABLED=false` убирает пакеты из каталога, не трогая купленное.

## Следующая задача / resume point

W-04: получить от владельца GRUMBLE-PACKS, записать в gitops `GRUMBLE_PACKS` и `GRUMBLE_PACKS_ENABLED=true` у payments (после выкатки wallet с очередью `wallet.billing-events`), купить самый маленький пакет своей картой (TC-W-04-04). Затем W-05 (этап 3, ветка `feat/wallet-shop`).
