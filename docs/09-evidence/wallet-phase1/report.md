# Отчёт: кошелёк, этап 1 (W-01, W-02, W-03, W-06)

- Статус: review (ветка `feat/wallet`, PR в outegro-dev/platform)
- Task cards: [W-01](../../04-delivery/90-optional-wallet/tasks/W-01.md), [W-02](../../04-delivery/90-optional-wallet/tasks/W-02.md), [W-03](../../04-delivery/90-optional-wallet/tasks/W-03.md), [W-06](../../04-delivery/90-optional-wallet/tasks/W-06.md)
- Commit/ref: ветка `feat/wallet` от master a76b59c
- Environment/runtime: Windows 11, Node 24, pnpm 12.3.4, Docker Desktop (Testcontainers: postgres:18.6-alpine, valkey 9.1-alpine, rabbitmq 4.3-alpine), локально `pnpm infra:up`
- Прочитанные contracts/ADR: ADR-003, ADR-005, ADR-007, ADR-009, ADR-010, wallet-proposal, billing, events, http-errors, identity-access, invariants
- Решения владельца 28.10.2026: отдельный сервис, валюта «грамблсы», EN grumble / grumbles, код `GRM`, RU грамблс / грамблса / грамблсов, значок «Штамп G»; рулетка ставит те же грамблсы ([ADR-011](../../03-decisions/adr/011-wallet-grumbles.md))

## Изменения

- `docs/`: ADR-011, ADR-007 → superseded, контракт [wallet.md](../../02-contracts/wallet.md), права `wallet.read` / `wallet.adjust` в identity-access и главе 7.7, коды 402 / 423 и маршруты в http-errors, потребитель Wallet в events, billing «Wallet», глава 6.11, open-inputs (`GRUMBLE-PACKS`, `GRUMBLE-PRICES`), карточки W-01…W-06 под этапы 1–3, каталог TC.
- `packages/contracts`: producer `wallet`, коды `INSUFFICIENT_FUNDS` (402) и `WALLET_RESTRICTED` (423), права `wallet.read` / `wallet.adjust` (только owner), DTO `@outegro/contracts/wallet`.
- `packages/nest-common`: необязательный `jsonLimit` в `configureApp` / `bootstrapService` (пачка зачислений до 1 000 строк больше 100 КБ по умолчанию); другие сервисы не меняются.
- `packages/ui`: `GrumbleIcon` и токен `--coin-shadow` в zine.css (чернила на бумаге, красный в тёмном тоне).
- `apps/wallet-backend` (новый): порт 4007, метрики 9467, БД `wallet`. Миграции `0000_init` (Drizzle) и `0001_journal_guards` (системные счета `GRM`, триггер append-only, REVOKE UPDATE/DELETE/TRUNCATE на `wallet_tx`, `wallet_refs`, `audit_log` у роли-владельца). `WalletLedger` (grant, adjust, debit, credit-batch, rollback), внутренний API под сервисным токеном без лимита запросов, API игрока, API админки с предпросмотром, консьюмер Identity, сверка (воркер + сервис), метрики.
- `apps/admin-web`: раздел «Кошелёк» (обзор, кошельки, карточка с журналом, сверка), команды «Начислить» и «Списать» с предпросмотром баланса, вкладка «Кошелёк» в карточке пользователя, плитка здоровья, EN/RU, фейковая платформа и e2e.
- Local dev: `infra/local/postgres/init.sql` (роль и БД `wallet`), `tools/dev/generate-env.mjs`, `.env.example` обоих приложений.

Отступление от плана: в `wallet_refs` нет колонки `response`. ref занимается до того, как известен баланс «после», а UPDATE этой таблицы запрещён, поэтому сохранённый ответ — неизменяемая строка журнала, на которую указывает ref. Внутренние пути — `/v1/internal/*` (глобальный префикс `/v1`, как `/v1/internal/users/lookup` в auth-backend), а не `/internal/v1/*` из плана; сессия рулетки предупреждена.

## Checkpoints

| Checkpoint | Результат | Evidence |
|---|---|---|
| C1 контракт | Контракт и ADR записаны до кода | `docs/02-contracts/wallet.md`, ADR-011 |
| C2 реализация | Сервис, админка, значок, контракты | файлы выше |
| C3 проверки | Таблица ниже | команды и тесты |
| C4 handoff | Этот отчёт, PR | — |

## Проверки

| TC-ID/команда | Environment | Фактический результат | Статус | Evidence |
|---|---|---|---|---|
| TC-W-01-01 | Testcontainers PG 18, сервис под ролью-владельцем БД, не суперпользователем | UPDATE/DELETE/TRUNCATE журнала и refs — 42501 у роли приложения; у суперпользователя — исключение триггера | pass | `ledger.test.ts` «never lets the application role or the owner change the journal» |
| TC-W-01-02 | то же | после каждой операции кэш = журнал, версии без разрывов, системные счета = минус их ноги, сумма `GRM` = 0 | pass | `ledger.test.ts`, `invariants()` в `test/harness.ts` |
| TC-W-01-03 | то же | CHECK отклоняет отрицательный баланс и неверную формулу; неизвестная единица, неверные суммы и зарезервированные ref — 400 | pass | `ledger.test.ts` |
| TC-W-01-04 | то же | suspended → 423, старое событие и повтор без эффекта, новое active снимает; удалённый аккаунт сохраняет баланс | pass | `ledger.test.ts` «accounts from Identity» |
| TC-W-02-01 | то же | баланс 50, 100 одновременных списаний: 50 × 200, 50 × 402, баланс 0, «после» 0…49 без повторов | pass | `ledger.test.ts` |
| TC-W-02-02 | то же | повтор — тот же ответ с `replayed`, 10 одновременных повторов — один txId, другая сумма — 409 conflict, отказ 402 не сохраняется | pass | `ledger.test.ts` |
| TC-W-02-03 | то же | откат до списания — надгробие, позднее списание 409 rolled_back; откат списания — одна reversal; 20 гонок debit/rollback — все грамблсы вернулись | pass | `ledger.test.ts` |
| TC-W-02-04 | то же | пачка с конфликтом — 409 и ни одной записи; повтор — `replayed`; 1 001 строка — 400; две пачки по 1 000 и 50 списаний одновременно — без deadlock | pass | `ledger.test.ts` |
| TC-W-02-05 | то же | внутренний API без токена, с чужим и пользовательским токеном — 401; игрок не видит reason/ref/meta | pass | `ledger.test.ts` |
| TC-W-03-01 | то же | кэш изменён суперпользователем → `balance_drift` + `zero_sum`, метрика 1; повторный проход не дублирует issue; после исправления закрыто; `system_drift` и `chain_break` | pass | `admin.test.ts` |
| TC-W-03-02 | то же | предпросмотр без записи, начисление, повтор формы без второй операции, списание больше баланса 402, аудит | pass | `admin.test.ts` |
| TC-W-03-03 | то же | billing_operator — 403, устаревший токен — 401, заблокированный автор — 403, лимит суммы — 400 | pass | `admin.test.ts` |
| TC-W-03-04 | admin-web production build + фейковая платформа, Chromium | обзор, список, карточка, начисление через диалог, отказ при нехватке, права, RU; axe без serious/critical, без горизонтального скролла, без сдвигов вёрстки, desktop/phone/RU | pass | `e2e/wallet.spec.ts`, `e2e/screens.spec.ts` (скриншоты `apps/admin-web/e2e/screenshots/wallet*`, `user-wallet*`) |
| TC-W-06-01 | Testcontainers PG 18 | 1 000 случайных команд, seed 20261028: инварианты после каждой, ответы совпадают с моделью, пройдены все ветки | pass | `acceptance.test.ts` |
| TC-W-06-02 | то же | полная сверка после прогона — 0 расхождений | pass | `acceptance.test.ts` |
| TC-W-06-03 | то же | повтор всех применённых команд — `replayed`, журнал и балансы без изменений | pass | `acceptance.test.ts` |
| Локальный запуск | `pnpm infra:up`, `node dist/db/migrate.js`, `node dist/main.js` | health/deep up (postgres, valkey, rabbitmq); credit 1000 → debit 250 → 402 на 5000 → rollback; метрики на 9467 | pass | вывод curl в PR |
| `pnpm test` | turbo, все пакеты и сервисы (Testcontainers) | 29 из 29 задач, код выхода 0 | pass | — |
| admin-web e2e | production build + фейковая платформа, Chromium, 2 воркера | весь набор 265 тестов: новые ожидания раздела «Кошелёк» в dashboard и navigation | pass | `apps/admin-web/e2e` |
| `pnpm lint` | весь репозиторий | код выхода 0 | pass | — |
| `pnpm typecheck` | turbo, 31 задача | код выхода 0 | pass | — |
| `python tools/documentation/validate.py` | docs | `pass` | pass | — |

## Ограничения и незавершённое

- Выкатки нет: стадия Dockerfile, bake, `tools/ci/scope.mjs`, gitops (БД `wallet`, Sealed Secret с `INTERNAL_API_TOKEN`, NetworkPolicy, ServiceMonitor, правило алерта, дашборд Grafana, `WALLET_API_URL` у admin-web) — только с согласия владельца.
- Аудит кошелька не входит в общую ленту `/audit` админки: команды видны в журнале кошелька (автор и причина) и в `GET /v1/admin/audit` сервиса.
- Системный счёт — одна строка на код, поэтому операции платформы с одним счётом идут по очереди. Для этапа 1 этого хватает; при росте нагрузки — шардированные строки счёта.
- Этапы 2 (W-04) и 3 (W-05) не начаты: ждут `GRUMBLE-PACKS` и `GRUMBLE-PRICES`.

## Откат

До выкатки — revert PR. После выкатки — только вперёд: журнал, refs и аудит не удаляются; сервис можно остановить, не трогая БД.

## Следующая задача / resume point

Ревью PR владельцем → решение о выкатке (gitops, CI) → W-04 по команде владельца.
