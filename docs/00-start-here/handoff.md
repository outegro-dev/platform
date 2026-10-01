# Handoff: где остановились и как продолжить (01.10.2026)

Документ для продолжения работы на другом компьютере или в облачной сессии. Что нужно от владельца — [owner-checklist.md](owner-checklist.md), эксплуатация — [production.md](../06-operations/production.md). Задачи и статусы — доска [outegro.dev](https://github.com/orgs/outegro-dev/projects/1) (issue на каждую карточку `docs/04-delivery`).

## Состояние

| Часть | Статус | Проверки |
|---|---|---|
| `apps/landing-web` | v0.3: сразу после hero — «Проекты» с реальными экранами Морского боя, «Платформа» — только работающее, услуги, процесс, форматы работы; страница `/stack`; ссылки на сайты платформы; CSP на всех страницах; постеры только WebP | 110 e2e (3 браузера), CLS 0 |
| `packages/ui`, `packages/i18n` | шрифты через next/font, pending-кнопки, FormMessage, Skeleton, Spinner | — |
| `packages/contracts`, `packages/db`, `packages/nest-common` | + протокол Морского боя (в том числе отмена `abandoned`), `ALREADY_OWNED`, версии ключей шаблонов; метрики на отдельном порту 9464 и correlation логов и событий (OPS-04); access-токен только с `typ: at+jwt` (ID-10) | 20 + 11 + 32 теста |
| `packages/bff` | + `sso.ts`: вход приложений через id.outegro.dev (PKCE) | 19 тестов |
| `packages/battleship-engine` | правила, партия (state machine), боты 4 уровней, Elo | 23 теста |
| `apps/auth-backend` | + Google (ID-02), admin overview/audit, внутренний lookup; ротация ключей публикует только публичную часть; уведомления о привязке Google | 59 тестов |
| `apps/notifications-backend` | + Telegram (N-04), admin API; шаблоны оплат и безопасности EN/RU (N-06) | 65 тестов |
| `apps/payments-backend` (4003) | Lava: checkout, вебхуки, сверка, подписки, возвраты, гранты, admin API; повтор неоплаченного checkout, отказ во второй копии, `duplicate_purchase`, отзыв гранта отменяет продление в Lava; квитанции покупателю | 122 теста |
| `apps/battleship-backend` (4004) | игровой сервер; оба игрока не вернулись — партия отменяется (`abandoned`), вернувшийся вовремя выигрывает, пока ждёт форфейт — часы стоят, форфейт переживает рестарт (`matches.pending_forfeit`); логи и метрики сокетов | 127 тестов |
| `apps/id-web` (3002) | + Google, «Безопасность», Telegram в уведомлениях; CSRF-проверки (ID-10) | 26 e2e |
| `apps/battleship-web` (3005) | MobX-сторы, GameSocket, расстановка, бой, лидерборд, профиль, магазин, EN/RU; на главной доска играет бой; легенда доски, отметка последнего выстрела, понятные состояния хода | 115 unit + 84 e2e |
| `apps/pay-web` (3003) | покупки, страница возврата с Lava, подписки, каталог; «уже ваше» по коду `ALREADY_OWNED` | 119 unit + 32 e2e |
| `apps/admin-web` (3004) | операторская консоль; пустые состояния внутри карточек; вход в Grafana (`/api/grafana/auth`, право `monitoring.read`: owner — Admin, остальные — Viewer) | 125 unit + 154 e2e |
| Production | outegro.dev, id., battleship., pay., admin., hooks. — K3s за Cloudflare; Argo CD; бэкапы в R2 (восстановление проверено: 81 с); Prometheus, Loki, Grafana (`admin.outegro.dev/grafana`); watchdog с алертами в Telegram; Hermes под управляемой политикой | CI → GHCR → gitops → Argo |

## Развернуть на новой машине

0. macOS: Homebrew, `brew install node@24 gh git`, Docker Desktop, приложение Claude Code; `gh auth login`. Доступ к серверу: ключ `~/.ssh/outegro_vps` и запись `Host outegro-prod` в `~/.ssh/config` владелец переносит сам из менеджера паролей (ключ и IP не хранятся в git).
1. Node.js 24+, `corepack enable` (pnpm 12.3.4), Docker.
2. `git clone https://github.com/outegro-dev/platform outegro-dev-showcase` и `outegro-dev/gitops`.
3. В папке платформы:

   ```text
   git config user.name "Nick Lukashik"
   git config user.email "coping.barrel@gmail.com"
   pnpm install
   pnpm infra:up
   pnpm env:local
   pnpm build
   ```

   Миграции: `node --env-file=.env dist/db/migrate.js` в `apps/auth-backend`, `notifications-backend`, `payments-backend`, `battleship-backend` (базы и роли создаёт `infra/local/postgres/init.sql` на чистом томе).
4. Порты: auth 4001, notifications 4002, payments 4003, battleship 4004; id-web 3002, pay-web 3003, admin-web 3004, battleship-web 3005, лендинг 3000. Почта — http://localhost:8025.
5. Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test` (нужен Docker), e2e каждого приложения — `pnpm --filter @outegro/<app> test:e2e`.

## Правила работы

- Коммиты только от имени владельца, conventional commits, без упоминания AI-инструментов и без `Co-Authored-By`; lint проверять кодом возврата (в пайпе ошибка теряется).
- Секреты — только Sealed Secrets; значения не печатать и не коммитить. Старый VPS и проект OuteGro — только чтение. Реальные платежи делает владелец.
- Выкатка изменений контракта уведомлений: сначала notifications-backend, потом производители (payments, auth).
- Новое приложение: цель в `Dockerfile`, в `BUILD_APPS` там же, в списке `APPS` в `docker-bake.hcl` и в `tools/ci/scope.mjs`, манифест и запись `images` в gitops. CI собирает и выкатывает только затронутые приложения (`turbo --affected`); изменение вне `apps/` и `packages/` (кроме docs) пересобирает всё.
- Одна рабочая копия на репозиторий: ветки — в `outegro-dev-showcase` и `outegro-gitops`. Незаконченное — в ветку `wip/*` на GitHub, а не в отдельную папку.
- Стек — [ADR-009](../03-decisions/adr/009-backend-stack.md). Библиотечные API — через Context7, как в AGENTS.md.

## Решения QA (сделано 29.09)

- Морской бой: оба игрока не вернулись за 60 с (после рестарта или нет) — партия отменяется (`abandoned`) без рейтинга; если второй игрок вернулся в свои 60 с — проигрывает ушедший первым.
- Платежи: второй checkout того же товара возвращает первую неоплаченную попытку; купленное или активную подписку купить повторно нельзя (`ALREADY_OWNED`); если Lava всё же подтвердила вторую оплату — грант не выдаётся, issue `duplicate_purchase` для возврата, квитанции нет. Отзыв гранта подписки отменяет продление в Lava (`DELETE /api/v1/subscriptions`), сбой — issue `renewal_cancel_failed` с повтором; списание после отзыва — `renewal_after_revoke`.

## Сделано 29.09 вечером

- В production: лендинг v0.3 и `/stack` (CSP на всех страницах), исправления по ревью (честные квитанции, ссылки, часы при форфейте, форфейт переживает рестарт — колонка `matches.pending_forfeit`, продление отключается при блокировке или удалении аккаунта), доска и легенда Морского боя, пустые состояния и вход в Grafana в админке.
- Слита и выкатывается ветка навигации между сайтами: `AccountMenu` в `@outegro/ui` в Battleship, pay и id, «Управлять подпиской» и «Ваши покупки» в Battleship, путь назад из pay в приложение (`og_return`, только разрешённые origin), «Ваши приложения» в id. Новые env (`PAY_URL`, `BATTLESHIP_URL`, `ADMIN_URL`) имеют production-значения по умолчанию.
- Hermes: управляемая политика (`gitops/apps/agents/hermes-policy`) — без терминала/файлов/кода, модель только Codex, ответы только в группе владельца и в личке; осталось принять TC владельцем (`/sethome`, второй аккаунт для TC-H-04-01).
- Доска: 72 Done, 8 In Progress, 16 Todo. Дальше — приоритизация с владельцем.

## Сделано 30.09–01.10

- Passkeys (ID-05): вход и добавление на id.outegro.dev (SimpleWebAuthn, RP `id.outegro.dev`), нельзя удалить последний способ входа, уведомления о добавлении и удалении; Signal API сообщает устройству об удалённых ключах и новом имени.
- CI: проверяются и собираются только затронутые пакеты, gitops обновляет теги только у них; Argo опрашивает git раз в минуту. Изменение одного бэкенда — около 6 минут до production.
- Мелочи: `Object.hasOwn` в `RolesService.grant` и шаблонах уведомлений; внутренний lookup отдаёт `version`, payments хранит locale и email с версией (миграция `0002_customer_profile_versions`); pay-web, battleship-web и id-web спрашивают Identity перед входом по cookie (`@outegro/bff` `sign-in.ts`); админка подписывает проигрыш по таймеру расстановки.
- Восстановление из бэкапа проверено (OPS-07, 81 с), алерт WAL заменён на `PostgresWalArchiveBehind`.

## Найдено по ходу (follow-up)

- Снятие passkey оператором (потерянное устройство): ветка `wip/admin-passkey-revoke` — право `passkeys.revoke` и тесты; не написаны `GET /v1/admin/users/:id/passkeys`, `POST .../passkeys/:passkeyId/revoke` (причина, аудит, `security.passkey-revoked.v1`, правило последнего способа), вкладка в админке, `credentialId` в `GET /v1/me/passkeys`.
- Уведомление `security.sign-in.v1` о входе по passkey и Google (способ, время, браузер и ОС).
- notifications `RecipientsService`: locale, email и статус получателя — «последний пишет», упорядочить по версии, как в payments.

## Нужно от владельца

- Проверить passkey на своём устройстве: id.outegro.dev → «Безопасность» → добавить ключ доступа, выйти, войти по нему.
- UptimeRobot (бесплатно): 5 мониторов на `/health` сайтов (OPS-05).
- Lava: отмена подписки и возврат на реальном аккаунте (PAY-12).
- Hermes работает только для владельца в его группе (решение 01.10, проверки с чужих аккаунтов не нужны — [отчёт H-04](../09-evidence/H-04/20261001-0530-prod/report.md)). `/sethome` и вопрос про инструменты сделаны; осталось: попытка заставить прочитать ключи, две темы (H-04-03, H-07). Разрешить починку `config.yaml`, который Hermes сломал при `/sethome`.
- Ротация трёх секретов из лога сессии — отложена владельцем.
