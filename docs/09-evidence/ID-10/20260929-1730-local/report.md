# Отчёт ID-10

- Статус: review
- Task card: [ID-10](../../../04-delivery/03-identity/tasks/ID-10.md)
- Commit/ref и dirty files: ветка `test/identity-negative` от master `9f4adc4`. Код и тесты — `f920307`; runbook, лог тестов и статусы — `3299464`. Незакоммиченных файлов нет; локальные `.env*` от `pnpm env:local` (одноразовые ключи) в `.gitignore`.
- Environment/runtime: Windows 11, Node 26.8.1, pnpm 12.3.4, Docker 29.7.2. Integration: Vitest 5.0.2 и Testcontainers (`postgres:18.6-alpine`, `valkey/valkey:9.1-alpine`, `rabbitmq:4.3-alpine`). E2E id-web: Playwright 1.63, Chromium, standalone-сборка id-web, auth-backend и notifications-backend из `dist` поверх `pnpm infra:up` (PostgreSQL 18.6, Valkey 9.1, RabbitMQ 4.3, Mailpit).
- Прочитанные contracts/ADR: [identity-access](../../../02-contracts/identity-access.md), [http-errors](../../../02-contracts/http-errors.md), [events](../../../02-contracts/events.md), главы 4 и 8, [ADR-004](../../../03-decisions/adr/004-sso-refresh.md), execution-protocol, project-context.
- Документация библиотек (Context7 и установленные версии): jose `/panva/jose` — `jwtVerify({ typ })` требует заголовок и нормализует значение, `createRemoteJWKSet` перезагружает набор по незнакомому `kid` только после `cooldownDuration` (исходник 6.2.12 прочитан); Vitest `/websites/main_vitest_dev` и типы 5.0.2 — `vi.setSystemTime` без fake timers подменяет только `Date`; Next.js 16.3.6 — `node_modules/next/dist/docs/01-app/02-guides/data-security.md` и `server/app-render/action-handler.js`: server action сравнивает `Origin` с `Host`/`X-Forwarded-Host`, `Origin: null` сравнивается как хост `null` и отклоняется, запрос без `Origin` пропускается с предупреждением (браузеры отправляют `Origin` на любой POST).

### Dependency evidence

| Зависимость | Фактическое состояние | Вывод |
|---|---|---|
| ID-04 SSO/PKCE/BFF | Код есть: `apps/auth-backend/src/oauth/`, `packages/bff/src/sso.ts`, id-web `/authorize`. TC-ID-04-01…04 зелёные в этом прогоне. Отчёта в 09-evidence нет, в index `planned` | Используется как есть |
| ID-05 Passkeys | Не реализованы: нет endpoints и сервиса, только значение `passkey` в enum `sessions.auth_method` | Конфликт: зависимость не выполнена; негативных проверок passkey в ID-10 нет, проверять нечего |
| ID-07 Owner/step-up | Owner bootstrap (`cli/grant-owner.ts`) и защита последнего owner есть, TC-ID-07-01…03 зелёные. Step-up (TC-ID-07-04) не реализован: admin-команды защищены свежими правами из БД | Конфликт по step-up |
| ID-08 Grant projection | `grants.service.ts`, TC-ID-08-01…03 зелёные | Используется как есть |

Из-за ID-05 и step-up критерий карточки «dependencies подтверждены» не выполнен, поэтому статус `review`, а не `done`.

## Изменения

| Путь | Что изменено | Почему |
|---|---|---|
| `packages/nest-common/src/auth.ts` | `AccessTokenVerifier` требует `typ: at+jwt` | **Дефект:** JWT с `typ: JWT` или без `typ`, подписанный ключом Identity, с верными `iss`/`aud`, принимался как access-токен (TC-ID-10-03). Shared contract: прогнаны тесты всех сервисов с JWKS |
| `apps/auth-backend/src/keys/signing-keys.service.ts` | Ключи из `JWT_PREVIOUS_PUBLIC_KEYS` публикуются только публичными полями, `kid` — отпечаток RFC 7638, без повторов и копии текущего; ключ не EC P-256 останавливает запуск | **Дефекты** (TC-ID-10-01): JWK с приватной частью публиковался в JWKS вместе с `d`; ключ без `kid` публиковался без него, и токены этого ключа не проверялись (массовый 401 при ротации); повтор `kid` (анонсированный ключ, оставленный после переключения) дал бы `JWKSMultipleMatchingKeys` на каждом токене |
| `apps/auth-backend/src/config/env.ts` | Описание `JWT_PREVIOUS_PUBLIC_KEYS` | Переменная держит выведенный и анонсированный ключи |
| `apps/payments-backend/src/account/account.controller.ts`, `src/admin/current-access.guard.ts` | `POST /v1/me/subscriptions/{id}/cancel` проходит `CurrentAccessGuard`, как checkout и admin-команды | **Дефект** (TC-ID-10-04): приостановленный аккаунт с неистёкшим токеном отключал продление (200, вызов Lava), хотя глава 4.4 требует свежей проверки при изменении подписок |
| `apps/auth-backend/src/adversarial.test.ts` (новый, 9 тестов) | TC-ID-10-01…04 на уровне Identity | Интеграция с реальными PostgreSQL/Valkey/RabbitMQ |
| `packages/nest-common/src/auth.test.ts` (новый, 5 тестов) | Проверка через удалённый JWKS, как в payments/notifications/battleship | Ротация, лимит перезагрузок, путаница токенов, граница service/user |
| `apps/payments-backend/src/suspension.test.ts` (новый, 3 теста) | TC-ID-10-04 для покупок, подписок, grants, refunds | Чувствительные команды главы 4.4 живут в Payments |
| `apps/id-web/e2e/account.spec.ts`, `e2e/security.spec.ts` | TC-ID-10-02: origin `null` и same-site sibling; подделанный `state` в callback привязки Google | Реальный стек, production-сборка |
| `apps/auth-backend/src/oauth.test.ts` | Блок «negative auth checks (ID-10)» перенесён в `adversarial.test.ts` | Прежняя проверка audience ломала подпись, а не audience |
| `apps/auth-backend/src/test/harness.ts` | `boot(tokens)`: второй процесс auth-backend на тех же контейнерах | Реплики до, во время и после ротации |
| Harness payments, notifications, battleship; `nest-common/src/http.test.ts` | Тестовые токены с `typ: at+jwt`, как у Identity | Следствие проверки `typ` |
| `docs/06-operations/signing-keys.md` (+ ссылка в README), `docs/02-contracts/identity-access.md`, `docs/02-contracts/http-errors.md` | Runbook ротации; строка про ключ подписи; строка про cancel | C2 шаг 2; контракт не меняется молча |

Migrations нет. Event contract не менялся. UI-тексты не менялись (EN/RU не затронуты).

## Checkpoints

| Checkpoint | Результат | Evidence |
|---|---|---|
| C1 контракт/исходное поведение | Входы: access JWT (ES256, `kid`, `typ`, `iss`, `aud`, `sid`), JWKS, cookie-сессии BFF, service token. Ожидаемые отказы: 401 (нет/не тот токен или отозванная сессия), 403 (нет свежего права или аккаунт приостановлен), 400 (невалидный ввод). Инвариант: отказ без побочного эффекта. Новые тесты до исправлений: auth-backend 2/9 fail, nest-common 1/5 fail, payments 1/3 fail (ниже) | Эта сессия, те же файлы тестов |
| C2 реализация | 1) integration cases для `iss`/`aud`/`kid`/`typ`, revoke, свежести ролей, CSRF/Origin; 2) runbook ротации с анонсом, перекрытием и изъятием; 3) границы user/service/refresh-токенов; 4) evidence без токенов | `f920307`, [signing-keys.md](../../../06-operations/signing-keys.md), [test-runs.txt](test-runs.txt) |
| C3 проверки | Все TC pass; consumers изменённого verifier (payments, notifications, battleship) и id-web e2e зелёные; diff проверен на секреты | Таблица ниже |
| C4 handoff | Этот отчёт, статус `review` в карточке, index и README этапа | `3299464` |

## Проверки

| TC-ID/команда | Environment | Фактический результат | pass/fail/blocked/not-run | Evidence |
|---|---|---|---|---|
| TC-ID-10-01 Rotation, Identity | Testcontainers, 3 дополнительные реплики auth-backend | Анонс: JWKS `[текущий, следующий]`, у ключей только `kty/crv/x/y/kid/alg/use`, хотя следующий передан с приватной частью. Переключение: refresh выдаёт токен нового `kid`, он принимается; неистёкший токен прежнего ключа принимается (перекрытие); реплика, видевшая анонс, принимает новый токен, реплика без анонса — 401; токен прежнего ключа после `exp` — 401 и в перекрытии. Изъятие: JWKS `[новый]`, неистёкший токен прежнего ключа при живой сессии — 401, новый — 200 | pass | `adversarial.test.ts` |
| TC-ID-10-01 Rotation, другие сервисы | nest-common, локальный JWKS-сервер со счётчиком | Новый `kid` принят после одной перезагрузки; прежний ключ принимается, пока опубликован, и отклоняется после изъятия и устаревания кэша (10 мин); 20 параллельных и 20 последовательных чужих `kid` — одна загрузка, следующая только после паузы 30 с; анонсированный ключ — без загрузок, неанонсированный — отказ до конца паузы | pass | `nest-common/src/auth.test.ts` |
| TC-ID-10-02 CSRF, id-web | Playwright, реальный стек | Server action выхода, повторённый с действующими cookies от `https://evil.test`, `null` и `http://localhost:3003` (соседнее приложение того же site) — ≥ 400, сессия жива; тот же запрос со своего origin выходит (контроль). Callback привязки Google с чужим `state` при своём ожидающем запросе — редирект на `/account`, cookie запроса удалена, Identity не вызван; со своим `state` — вызов Identity (локально Google выключен → `google_unavailable`, контроль) | pass | `account.spec.ts`, `security.spec.ts` |
| TC-ID-10-02 CSRF, Identity | Testcontainers | `PATCH /v1/me` и `POST /v1/me/sessions/revoke-all` только с cookies `og_at`/`og_rt` и чужим `Origin` — 401, строка `users` без изменений, сессия жива; preflight с чужого origin без `Access-Control-Allow-*` | pass | `adversarial.test.ts` |
| TC-ID-10-02 SSO state/PKCE | Vitest | Чужой `state` — отказ без обмена кода, без запроса к Identity; нет ожидающего входа — отказ; код привязан к client и redirect, одноразовый, неверный PKCE verifier сжигает код без сессии | pass | `packages/bff/src/sso.test.ts`, `oauth.test.ts` TC-ID-04-02…04 (перепрогнаны) |
| TC-ID-10-03 Token confusion, Identity | Testcontainers, ключ Identity, живая сессия | Контрольная подделка без изъяна — 200. Чужой `aud`, чужой `iss`, `typ: JWT`, без `typ`, machine-токен (`sub` не UUID, без `sid`), `alg: none`, HS256 с публичным JWK и с публичным PEM как секретом, чужой ключ под `kid` Identity — 401 каждый; `PATCH /v1/me` с `typ: JWT` — 401, строка без изменений. Service token на `/v1/me`, admin status, `/v1/oauth/authorize` — 401; access-токен owner, refresh-токен и токен пользователя на `/v1/internal/users/lookup` — 401; refresh как bearer — 401; access вместо refresh — 400; цель активна, её refresh работает | pass | `adversarial.test.ts` |
| TC-ID-10-03 Token confusion, другие сервисы | nest-common, удалённый JWKS | Тот же набор плюс истёкший токен и `typ: id+jwt` — `UNAUTHENTICATED` без загрузки JWKS; service token на user route и user token на internal route — 401, контроли 200 | pass | `nest-common/src/auth.test.ts` |
| TC-ID-10-04 Revoke, Identity | Testcontainers | Приостановка через admin API: неистёкший токен на `GET/PATCH /v1/me`, `/v1/oauth/authorize`, `revoke-all` — 401, refresh — 401; строка пользователя не менялась после приостановки, кодов авторизации нет, сессия отозвана с `reason = admin`, в outbox `identity.user.status.changed.v1` с новым `accessVersion`. Приостановленный второй owner — 401 на выдачу роли. Приостановленный support с уцелевшей сессией (сбой между записями) — 403 на admin-команду по свежим правам, у цели нет ролей и сессия жива. Сессии, отозванные support, — 401 на `PATCH /v1/me` без изменений. Отозванная роль при токене с `roles: [support]` и живой сессии — 403, сессии цели целы | pass | `adversarial.test.ts` |
| TC-ID-10-04 Revoke, Payments | Testcontainers, fake Lava | Статус из `identity.user.status.changed.v1`: checkout — 403, заказа нет; отключение продления — 403, строка подписки не изменилась, вызова отмены в Lava нет; приостановленный owner: grant, refund-request, admin cancel — 403, нет ручного grant, refund, audit, изменения подписки и вызова Lava | pass | `suspension.test.ts` |
| До исправлений | те же тесты | auth-backend 2/9 fail: анонсированный ключ в JWKS с `kid: undefined` и с приватной `d`; `a plain JWT type: expected 200 to be 401`. nest-common 1/5 fail: токен с `typ: JWT` принят. payments 1/3 fail: `cancel` приостановленного аккаунта — 200 вместо 403 | fail (ожидаемо) | Эта сессия |
| `cd apps/auth-backend && pnpm test` | Testcontainers | 6 файлов, 56 тестов | pass | |
| `cd packages/nest-common && pnpm test` | Testcontainers | 4 файла, 21 тест | pass | |
| `cd packages/bff && pnpm test` | Vitest | 2 файла, 19 тестов | pass | |
| `cd apps/payments-backend && pnpm test` | Testcontainers | 6 файлов, 107 тестов | pass | |
| `cd apps/notifications-backend && pnpm test` | Testcontainers | 3 файла, 39 тестов | pass | |
| `cd apps/battleship-backend && pnpm test` | Testcontainers | 9 файлов, 104 теста | pass | |
| `cd apps/id-web && pnpm exec playwright test` | `pnpm infra:up`, `pnpm env:local`, миграции, `turbo run build` | 26 тестов | pass | [test-runs.txt](test-runs.txt) (тесты ID-10) |
| Typecheck: `tsc --noEmit` в nest-common, bff, auth-backend, payments, notifications, battleship; `pnpm run typecheck` в id-web | — | exit 0 | pass | |
| `pnpm exec biome check <изменённые файлы>` | — | exit 0 | pass | |
| `python tools/documentation/validate.py` | — | result pass | pass | |

## Ограничения и незавершённое

1. ID-05 (passkeys) и step-up из ID-07 не реализованы. Когда появятся, ID-10 нужно дополнить: origin/RP и replay assertion, повтор step-up proof.
2. Отзыв сессии (logout, revoke-all, reuse) не доходит до других сервисов: они принимают access-токен до истечения (≤ 5 мин) — принято в ADR-004. Приостановка и смена ролей доходят до Payments через проекцию `accessVersion` по событиям; при задержке outbox/RabbitMQ проекция отстаёт, синхронной проверки в Identity нет. Если владельцу нужна гарантия «свежести» для refunds/grants при недоступной шине — отдельная задача (внутренний endpoint проверки сессии с отказом при недоступности).
3. В Identity смена статуса и отзыв сессий — разные транзакции. При сбое между ними admin-команды всё равно отклоняются (свежие права, проверено), а собственные endpoints пользователя принимают его токен до истечения (≤ 5 мин); refresh отклоняется по статусу.
4. Другие сервисы держат изъятый ключ в кэше JWKS до 10 минут; при компрометации runbook требует их перезапуска.
5. Audit-записи Identity для статуса, ролей и отзыва сессий без `requestId` (в логах он есть). Предлагается как follow-up.
6. Вне ID-10: POST route handlers admin-web и battleship-web (у них своя проверка `fromThisApp`), server actions pay-web (проверка Next.js), WebSocket battleship.
7. Production-ротация не выполнялась (доступа нет): runbook проверен тестами, а не выполнением.
8. `docs/05-quality/command-map.md` устарел (строки Integration/E2E); в рамках ID-10 не менялся.
9. Изменение поведения Payments: приостановленный аккаунт не может отключить продление в пределах срока токена; затем он не может и войти. Отмену делает оператор (`subscriptions.cancel`). pay-web показывает 403 как «недоступно» — существующее сопоставление, UI не менялся.

## Откат

Код: `git revert f920307`, миграций и изменений данных нет. Все токены Identity несут `typ: at+jwt`, поэтому проверка совместима в обе стороны. При `JWT_PREVIOUS_PUBLIC_KEYS=[]` (текущий production default) JWKS до и после изменения одинаков. Документация: revert `3299464`.

## Следующая задача / resume point

ID-10 выполнен до `review`; последний шаг — C4. Для `done` нужно решение по зависимостям ID-05/ID-07 (step-up) либо их выполнение с дополнением негативных проверок. Открытые вопросы владельцу: пункты 2 и 9. Файлы для продолжения: `apps/auth-backend/src/adversarial.test.ts`, `packages/nest-common/src/auth.test.ts`, `apps/payments-backend/src/suspension.test.ts`, [runbook](../../../06-operations/signing-keys.md).

## Приёмка ведущим (29.09)

Ветка слита в master (`2a95109`), CI зелёный, выкачено в production. После слияния с метриками модуль теста `nest-common/src/auth.test.ts` получил `MetricsModule`, которого теперь требует `configureApp`; тест снова зелёный.

## Дополнение после ID-05 (30.09, ветка `feat/passkeys`)

Ограничение 1 закрыто наполовину: passkeys реализованы (ID-05, evidence в `docs/09-evidence/ID-05/20260930-0310-local/`), в `apps/auth-backend/src/adversarial.test.ts` добавлен блок «ID-05 passkeys» (5 тестов, всего 14): ceremony, пересланная сайтом-двойником (`id.outegro.dev.evil.test` как origin и как RP), — отказ без сессии; перехваченный assertion с тем же challenge, с новым и с подменённым clientData — отказ; копия аппаратного ключа с отставшим счётчиком — отказ и audit `passkey.counter_regression`; старая сессия, сессия приложения, одни cookies и service token не добавляют passkey; ключ без проверки PIN и passkey заблокированного владельца не создают сессию. Step-up из ID-07 по-прежнему не реализован, статус ID-10 — `review`.
