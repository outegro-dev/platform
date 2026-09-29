# Отчёт ID-05

- Статус: review (все TC pass локально; `done` после QA и слияния ведущим, выкат — notifications-backend первым).
- Task card: [ID-05](../../../04-delivery/03-identity/tasks/ID-05.md)
- Commit/ref и dirty files: ветка `feat/passkeys` от master `56e77e2`. Коммиты: `a8af023` шаблоны notifications-backend, `1cf88d1` зависимости, `e5da700` auth-backend, `93f207d` id-web, `c9d6719` устойчивость тестов, `7cb5643` документация, evidence и статусы, `fb75aef` проверка имени без zod в браузере. Незакоммиченных файлов нет; локальные `.env*` от `pnpm env:local` в `.gitignore`.
- Environment/runtime: Windows 11, Node 26.8.1 (CI и образы — Node 24), pnpm 12.3.4, Docker 29.7.2. Integration: Vitest 5.0.2 и Testcontainers (`postgres:18.6-alpine`, `valkey/valkey:9.1-alpine`, `rabbitmq:4.3-alpine`). E2E: Playwright 1.63, Chromium с виртуальным аутентификатором CDP (`WebAuthn.addVirtualAuthenticator`), standalone-сборка id-web, auth-backend и notifications-backend из `dist` поверх `pnpm infra:up` (PostgreSQL 18.6, Valkey 9.1, RabbitMQ 4.3, Mailpit), миграции применены к локальной БД.
- Прочитанные contracts/ADR: project-context, execution-protocol, [identity-access](../../../02-contracts/identity-access.md), [http-errors](../../../02-contracts/http-errors.md), [events](../../../02-contracts/events.md), [notifications](../../../02-contracts/notifications.md), глава 4 (4.2, 4.3, 4.8), карточки ID-04, ID-07, ID-10, отчёты [ID-10](../../ID-10/20260929-1730-local/report.md) и [N-06](../../N-06/20260929-1723-local/report.md), handoff, DESIGN.md.
- Документация библиотек: Context7 `/masterkale/simplewebauthn` (changelog v14: единственное несовместимое изменение — минимальная версия Node) и исходники установленных `@simplewebauthn/server` 14.0.3 и `@simplewebauthn/browser` 14.0.0. Выводы, на которые опирается код: `requireUserVerification` по умолчанию `true`; структурные ошибки (origin, RP, challenge, тип, флаги UP/UV) бросают исключение, `verified: false` — только неверная подпись; проверка счётчика выполняется до проверки подписи; для usernameless-входа `allowCredentials` не передаётся; `userID` — байты; браузер отдаёт одну `NotAllowedError` на отмену, тайм-аут и «нет ключа»; при autofill библиотека по умолчанию требует поле с `autocomplete="…webauthn"`; `sendSignal` оборачивает Signal API.
- Dependency evidence: ID-04 в `task-index.json` — `planned`, отчёта нет, но код есть (`apps/auth-backend/src/oauth/`, `packages/bff/src/sso.ts`, id-web `/authorize`), TC-ID-04-01…04 зелёные в этом прогоне (`oauth.test.ts`, e2e TC-ID-04-01 и TC-ID-04-04). Используется как есть, как в отчёте ID-10. Конфликт документации (статусы ID-01…ID-04 не отражают код) записан здесь, чужие статусы не менялись.

## Изменения

C1, контракт. Регистрация: `POST /v1/me/passkeys/options` → `{ challengeId, options }`, `POST /v1/me/passkeys { challengeId, name, response }` → passkey. Вход: `POST /v1/login/passkey/options` → `{ challengeId, options }`, `POST /v1/login/passkey/verify { challengeId, response }` → пара токенов и профиль, как после кода. Управление: `GET /v1/me/passkeys`, `PATCH|DELETE /v1/me/passkeys/{id}`. Отказы: 422 `challenge: stale` (неизвестный, истёкший, использованный), 422 `passkey: rejected` (origin, RP, подпись, UV, user handle, счётчик), 422 `passkey: unknown`, 403 `session: reauthentication_required`, 409 `passkey: already_registered`, 422 `passkey: limit`, 409 `passkey: last_method`, 404 чужой или неизвестный id, 403 заблокированный аккаунт, 429 лимиты. Инварианты: challenge одноразовый и принадлежит своему пользователю и сессии; credential принадлежит одному аккаунту; отказ не создаёт сессию и не двигает счётчик; последний пригодный способ входа не удаляется. Исходное состояние: только значение `passkey` в `sessions.auth_method`, endpoints нет.

**auth-backend** (`e5da700`, `c9d6719`):

- `src/config/env.ts`, `config.ts`, `config.module.ts`: `WEBAUTHN_RP_ID` (по умолчанию `id.outegro.dev`), `WEBAUTHN_ORIGIN` (по умолчанию `https://id.outegro.dev`); `relyingParty()` при старте требует голый origin, HTTPS (HTTP только `localhost`), RP ID — хост origin или его родитель. `webauthnConfig`: rpName `outegro.dev`, challenge и таймаут ceremony 5 минут, окно свежести 5 минут, до 20 passkeys на аккаунт. `.env.example`: `localhost`, `http://localhost:3002`. Это C2.1: RP закреплён до первой регистрации.
- `src/db/schema.ts`, `drizzle/0002_passkeys.sql` (сгенерирована `pnpm db:generate --name passkeys`): таблица `passkeys` — `credential_id` (unique), `public_key` (bytea, COSE), `sign_count` (bigint), `transports`, `aaguid`, `rp_id`, `backup_eligible`, `backed_up`, `name`, `created_at`, `last_used_at`; FK на `users` с каскадом.
- `src/passkeys/challenge-store.ts`: challenge в Valkey (`wa:reg:<id>`, `wa:auth:<id>`, PX 5 минут), `take` — один `GETDEL`.
- `src/passkeys/passkeys.service.ts`, `passkeys.controller.ts`: ceremonies SimpleWebAuthn, свежесть, compare-and-set счётчика, user handle, лимиты, audit, уведомления через outbox; zod-схемы тела — W3C JSON-кодировка с пределами размеров из спецификации.
- `src/users/sign-in-methods.ts`: одно правило последнего способа входа для passkeys и для отвязки Google (`identities.service.ts` теперь учитывает passkeys).
- `src/common/metrics.ts`: `identity_sign_in_attempts_total{method="passkey"}`; использованный или истёкший challenge считается как `expired`.
- Тесты: `src/test/authenticator.ts` — программный аутентификатор (ES256, attestation `none`, discoverable credentials, флаги UV/BE/BS, счётчик), помощники в `src/test/harness.ts`, `src/passkeys.test.ts` (17), блок ID-05 в `src/adversarial.test.ts` (5).

**notifications-backend** (`a8af023`): `security.passkey-added.v1` и `security.passkey-removed.v1` (EN/RU, sample, схема `{ at }`) в `src/templates/registry.tsx`; тест в `src/billing-security.test.ts`; снимок шаблонов — только четыре новые записи.

**id-web** (`93f207d`, `fb75aef`):

- `src/app/login/passkey-sign-in.tsx`, `passkey-actions.ts`: кнопка «Sign in with a passkey» и autofill поля email (conditional mediation, свежий challenge каждые 4 минуты); неизвестный аккаунту passkey передаётся устройству через `signalUnknownCredential`.
- `src/app/account/security/passkeys-panel.tsx`, `passkey-actions.ts`, `page.tsx`: раздел «Passkeys»: добавить с именем (подсказка из браузера и ОС), переименовать и удалить через диалоги с подтверждением, даты добавления и последнего входа, отметка «Synced».
- `src/lib/passkeys.ts`, `passkey-ceremony.ts`, `passkey-name.ts`: коды ошибок сервера и браузера → сообщения EN/RU (cancelled, unsupported, not_allowed, stale, rejected, unknown, exists, last_method, limit, invalid_name, suspended, rate_limited, unavailable, offline, failed); проверка имени без zod в браузере.
- `src/lib/session.ts`, `login/actions.ts`, `login/google/callback/route.ts`, `proxy.ts`, `login/page.tsx`, `login-form.tsx`: `/login?reauth=1` доступен вошедшему пользователю, email подставлен; новая сессия (код, passkey, Google) заменяет прежнюю, прежняя завершается.
- `next.config.ts`: `Permissions-Policy` + `publickey-credentials-get=(self), publickey-credentials-create=(self)`; CSP не менялась.
- `src/messages/en.json`, `ru.json` (+ «Ключ доступа» в списке сеансов), `globals.css`.
- `e2e/passkeys.spec.ts` (6); в `e2e/support.ts` и `e2e/account.spec.ts` кнопка «Sign in» ищется точно (`exact: true`), иначе совпадает со «Sign in with a passkey».

**Документация** (`7cb5643`): [identity-access](../../../02-contracts/identity-access.md) (RP, свежесть, последний способ входа), [http-errors](../../../02-contracts/http-errors.md) (endpoints и коды), [notifications](../../../02-contracts/notifications.md) (producer identity), runbook [passkeys](../../../06-operations/passkeys.md) (C2.4: восстановление без email-only обхода admin), дополнение к [отчёту ID-10](../../ID-10/20260929-1730-local/report.md), статусы.

### Решения

1. **Свежесть.** Добавить passkey может сессия id.outegro.dev (`client_id IS NULL`), вход в которую был не больше 5 минут назад — окно admin step-up из identity-access.md. Сессия приложения по SSO отклоняется: её `created_at` — момент обмена кода, а не аутентификации. Иначе 403 `session: reauthentication_required`, id-web ведёт на `/login?reauth=1`; повторный вход кодом из письма или любым другим способом, новая сессия заменяет прежнюю. Challenge регистрации привязан к сессии и живёт 5 минут.
2. **Последний способ входа.** Пригодны: код на подтверждённый email (неподтверждённый не считается), каждая привязанная identity (Google), каждый passkey текущего RP. Удаление, после которого не остаётся ни одного, — 409 `last_method`, ничего не меняется. Проверка под `SELECT … FOR UPDATE` строки пользователя. Правило общее с отвязкой Google. Сейчас у каждого аккаунта подтверждённый email, поэтому на практике passkey всегда можно удалить; случай без подтверждённого email покрыт тестами.
3. **Challenge.** Valkey, случайный id, 5 минут (рекомендация W3C для ceremony с UV), забирается одним `GETDEL` до любой проверки.
4. **User handle.** 16 байт UUID аккаунта: стабилен, без email и имени; при входе должен совпасть с владельцем credential (WebAuthn §7.2, шаг 6).
5. **Счётчик.** Библиотека сравнивает счётчик до подписи, поэтому ей передаётся 0, а сравнение идёт после проверки подписи compare-and-set в транзакции, создающей сессию. Не выросший счётчик (кроме 0/0) — отказ и audit `passkey.counter_regression`.
6. **Уведомления без имени passkey.** Имя набирает тот, у кого сессия; в data только время, лишние поля отбрасывает схема шаблона.
7. **RP в строке.** `rp_id` у каждого passkey: при смене RP старые passkeys непригодны; credentials outegro.com не переносятся.

## Checkpoints

| Checkpoint | Результат | Evidence |
|---|---|---|
| C1 контракт/исходное поведение | Входы, выходы, отказы и инварианты записаны выше и в http-errors.md. Исходно endpoints нет | этот отчёт |
| C2 реализация | 1) RP и origin в конфиге с проверкой при старте; 2) challenge/verify регистрации и входа через SimpleWebAuthn; 3) список, имя, удаление, UV обязательна; 4) runbook восстановления, admin не восстанавливается одним письмом | `e5da700`, `93f207d`, `a8af023`, [runbook](../../../06-operations/passkeys.md) |
| C3 проверки | Все TC pass; наборы затронутых пакетов, e2e на локальном стеке, мутационная проверка защит, diff просмотрен на секреты | таблица ниже, [test-runs.txt](test-runs.txt) |
| C4 handoff | Отчёт, статус `review` в карточке, `task-index.json` и README этапа | `7cb5643` |

## Проверки

| TC-ID/команда | Environment | Фактический результат | pass/fail/blocked/not-run | Evidence |
|---|---|---|---|---|
| TC-ID-05-01 Passkey | Testcontainers, программный аутентификатор | Свежая сессия: 201, строка `passkeys` с `user_id` владельца, `rp_id = localhost`, AAGUID аутентификатора, `sign_count 0`; audit `passkey.registered`, outbox `security.passkey-added.v1` `{ at }`. Вход: 200, тот же `user.id`, новая сессия `auth_method = passkey`, токен открывает `/v1/me`, refresh работает, `last_used_at` записан, `/v1/oauth/authorize` и обмен кода pay-web проходят. Challenge регистрации: чужой пользователь и другая сессия того же пользователя — 422 `stale`, challenge сожжён; повтор использованного — 422 | pass | `passkeys.test.ts` |
| TC-ID-05-01 E2E | Chromium, виртуальный аутентификатор, локальный стек | Вход кодом → «Безопасность» → добавить «E2E laptop» → credential resident, `rpId localhost` → выход → «Sign in with a passkey» → `/account`, в «Сеансах» «Passkey» → переименовать → удалить («Keep it» ничего не меняет) → выход → тот же passkey: «This passkey is not linked to any account…». Отдельно: autofill поля email входит сам | pass | `e2e/passkeys.spec.ts` |
| TC-ID-05-02 Origin | Testcontainers | Assertion для origin `https://evil.test`, `https://id.outegro.dev` (не настроенный), `http://localhost:3003`, для RP `evil.test` и `outegro.dev` — 422 `passkey: rejected` каждый, токенов нет, сессии без изменений, `last_used_at` пуст, метрика `rejected` +5. Регистрация с чужого origin и для чужого RP — 422, строки нет. ID-10: сайт-двойник `id.outegro.dev.evil.test` — 422 | pass | `passkeys.test.ts`, `adversarial.test.ts` |
| TC-ID-05-03 Удаление | Testcontainers, реальная конкуренция PostgreSQL | Email не подтверждён, один passkey — 409 `last_method`, строка на месте. Со вторым один удаляется (204), второй — 409. Email подтверждён — последний удаляется (204). Audit `registered` ×2, `removed` ×2, уведомление `passkey-removed` по одному на удалённый id; удалённый passkey при входе — 422 `unknown`. Две параллельные попытки удалить два последних — ровно 204 и 409. Google + passkey без подтверждённого email: Google отвязывается, затем passkey — 409 | pass | `passkeys.test.ts` |
| TC-ID-05-04 Replay | Testcontainers | Тот же challenge повторно — 422 `stale`; тот же assertion под новым challenge — 422 `rejected`; неизвестный id — 422; сессий не прибавилось, метрика `expired` +2. Две параллельные проверки одного challenge — 200 и 422, одна сессия. TTL challenge ≤ 300 000 мс. ID-10: подменённый clientData — 422 | pass | `passkeys.test.ts`, `adversarial.test.ts` |
| Регрессия счётчика | Testcontainers | После входов со счётчиком 1 и 2 ответы со счётчиком 2, 1, 0 — 422, сессий не прибавилось, `sign_count` 2, три записи `passkey.counter_regression`; подлинный ключ со счётчиком 3 входит. Синхронизируемый passkey (всегда 0) входит повторно | pass | `passkeys.test.ts`, `adversarial.test.ts` |
| Credential другого пользователя | Testcontainers | Assertion credential A с user handle B и без user handle — 422, сессий нет. Регистрация credential id A пользователем B — 409 `already_registered`, строка A не изменилась. B не видит, не переименовывает и не удаляет passkey A (404) | pass | `passkeys.test.ts` |
| User verification | Testcontainers; Chromium | Регистрация и вход без флага UV — 422, строки и сессии нет; options требуют `residentKey` и `userVerification` `required`. E2E: проверка PIN не проходит — «cancelled or timed out», `/account` ведёт на вход | pass | `passkeys.test.ts`, `e2e/passkeys.spec.ts` |
| Свежесть и повторный вход | Testcontainers; Chromium | Через 5:00 после входа options выдаются, через 5:01 — 403 `reauthentication_required`; после нового входа — 200; сессия SSO — 403. ID-10: старая сессия, одни cookies, service token — отказ; challenge свежей сессии, завершённый старой, — 422. E2E: `/login?reauth=1` открывается вошедшему, email подставлен, вход passkey возвращает на `/account/sessions`, сеанс один | pass | `passkeys.test.ts`, `adversarial.test.ts`, `e2e/passkeys.spec.ts` |
| Лимиты | Testcontainers | Options входа: 31-й за минуту с адреса — 429; проверка входа: 21-я — 429; options регистрации: 21-я за час для аккаунта — 429 | pass | `passkeys.test.ts` |
| Passkey старого домена | Testcontainers | `rp_id = outegro.com`: `usable: false`, вход — 422 `unknown`, не считается способом входа, удаляется сам | pass | `passkeys.test.ts` |
| Уведомления | Testcontainers, fake email | EN и RU письма и inbox для added/removed, ссылка на `/account/security`, имя из лишнего поля не попало ни в письмо, ни в intent; повтор источника второго письма не даёт | pass | `billing-security.test.ts` |
| Заголовки и доступность | Chromium | `Permissions-Policy` с `publickey-credentials-get=(self)` и `-create=(self)`; CSP `script-src 'self' 'nonce-…' 'strict-dynamic'`, `connect-src 'self'`, `frame-ancestors 'none'`, без `unsafe-eval`; axe WCAG 2.2 AA на «Безопасности» — 0 нарушений; CLS < 0.02 | pass | `e2e/passkeys.spec.ts`, `e2e/account.spec.ts` |
| Телефон, RU | Chromium 375×812 | «Ключи доступа», «ещё не использовался», кнопки видны, горизонтальной прокрутки нет, «Войти с ключом доступа» | pass | `e2e/passkeys.spec.ts`, снимки |
| Мутационная проверка | Testcontainers | Ослаблены по очереди UV, origin, user handle, compare-and-set, GETDEL, правило последнего способа, свежесть, привязка к сессии — каждая мутация роняет свои тесты и только их | pass | [test-runs.txt](test-runs.txt) |
| `cd apps/auth-backend && pnpm test` | Testcontainers | 7 файлов, 81 тест (было 59), два прогона | pass | |
| `cd apps/notifications-backend && pnpm test` | Testcontainers | 5 файлов, 77 тестов (+1) | pass | |
| `cd apps/id-web && pnpm exec playwright test` | локальный стек | 37 тестов (31 + 6), после последнего коммита | pass | [test-runs.txt](test-runs.txt) |
| Миграция на локальной PostgreSQL 18.6 | `pnpm infra:up` | `migrations applied`, таблица и индексы как в схеме | pass | [test-runs.txt](test-runs.txt) |
| Typecheck auth-backend, notifications-backend, id-web | — | exit 0 | pass | |
| `pnpm exec biome check .` | — | exit 0 | pass | |
| `python tools/documentation/validate.py` | — | pass | pass | |

Снимки (WebP): [вход](desktop-login-en.webp), [вход на телефоне](mobile-login-en.webp), [«Безопасность»](desktop-security-en.webp), [на телефоне](mobile-security-en.webp), [RU](desktop-security-ru.webp), [RU на телефоне](mobile-security-ru.webp), [переименование](desktop-rename-dialog-en.webp), [на телефоне](mobile-rename-dialog-en.webp), [удаление, RU](desktop-remove-dialog-ru.webp), [на телефоне](mobile-remove-dialog-ru.webp), [повторный вход, RU](desktop-login-reauth-ru.webp), [на телефоне](mobile-login-reauth-ru.webp).

## Переменные окружения

- `WEBAUTHN_RP_ID` (auth-backend) — по умолчанию `id.outegro.dev`; в production задавать не нужно.
- `WEBAUTHN_ORIGIN` (auth-backend) — по умолчанию `https://id.outegro.dev`; в production задавать не нужно.
- Локально — `localhost` и `http://localhost:3002` из `.env.example`. Новых секретов нет.

## Порядок выката

1. notifications-backend. 2. auth-backend: Job миграции `0002_passkeys` (только новая таблица), затем сервис. 3. id-web. Если auth-backend выйдет раньше, intents с новыми ключами уйдут в DLQ как `unknown template`.

## Ограничения и незавершённое

1. Admin step-up с passkey (ID-07) не реализован; опора готова (`auth_method = passkey`, время входа, UV). Потерянный admin passkey восстанавливается по процедуре владельца, не письмом (runbook).
2. Восстановление пользователя без подтверждённого email, потерявшего последний passkey, — ручная процедура; инструмента оператора нет. Follow-up.
3. Signal API только после отказа `unknown`; после удаления и переименования не отправляется. Follow-up.
4. Повторный вход кодом из письма в e2e не прогнан: второй код тому же адресу раньше 60 секунд запрещён. Путь тот же, что у обычного входа кодом; замена сессии проверена повторным входом passkey, окно свежести — integration-тестами.
5. Вход по passkey не присылает уведомление о входе (follow-up N-06).
6. Имя провайдера по AAGUID не определяется.
7. E2E только в Chromium; Safari, Firefox и реальные устройства вручную не проверялись.
8. Node 26 один раз пишет ExperimentalWarning о `SubtleCrypto.supports` (проверка PQC в SimpleWebAuthn); на Node 24 проверить в логах первого выката.
9. Статусы ID-01…ID-04 в `task-index.json` не отражают код.
10. Локальная общая БД `outegro-local` получила миграцию `0002_passkeys`.

## Откат

Revert в обратном порядке: id-web, auth-backend без down-миграции (таблица остаётся, прежняя версия её игнорирует), notifications-backend — только пока в inbox нет сообщений с новыми ключами, иначе forward-fix. Финансовые данные не затрагиваются.

## Следующая задача / resume point

ID-05 выполнен до `review`, последний шаг — C4. Следующее: QA и слияние ведущим в порядке выката, затем `done`. Follow-up: step-up с passkey (ID-07), инструмент оператора для удаления потерянного passkey с audit, Signal API после удаления и переименования, ручная проверка на реальных устройствах. Файлы: `apps/auth-backend/src/passkeys/`, `apps/auth-backend/src/users/sign-in-methods.ts`, `apps/id-web/src/app/account/security/passkeys-panel.tsx`, `apps/id-web/src/app/login/passkey-sign-in.tsx`, [runbook](../../../06-operations/passkeys.md).

## Приёмка ведущим (30.09)

Слито двумя шагами: сначала шаблоны notifications-backend (`82a54f9`), затем auth-backend, миграция и id-web (`34b0f5e`); перед слиянием lint, typecheck всего репозитория и 81 тест auth-backend зелёные.
