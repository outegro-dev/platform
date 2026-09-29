# Handoff: где остановились и как продолжить (29.09.2026)

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
- Новое приложение: цель в `Dockerfile` и в списке `APPS` в `docker-bake.hcl`, манифест и запись `images` в gitops — CI сам обновит все образы `outegro/*`.
- Стек — [ADR-009](../03-decisions/adr/009-backend-stack.md). Библиотечные API — через Context7, как в AGENTS.md.

## Решения QA (сделано 29.09)

- Морской бой: оба игрока не вернулись за 60 с (после рестарта или нет) — партия отменяется (`abandoned`) без рейтинга; если второй игрок вернулся в свои 60 с — проигрывает ушедший первым.
- Платежи: второй checkout того же товара возвращает первую неоплаченную попытку; купленное или активную подписку купить повторно нельзя (`ALREADY_OWNED`); если Lava всё же подтвердила вторую оплату — грант не выдаётся, issue `duplicate_purchase` для возврата, квитанции нет. Отзыв гранта подписки отменяет продление в Lava (`DELETE /api/v1/subscriptions`), сбой — issue `renewal_cancel_failed` с повтором; списание после отзыва — `renewal_after_revoke`.

## В работе на момент переноса (29.09, ~17:05 UTC)

- CI master `94a8152`: лендинг v0.3 и исправления по ревью (честные квитанции, ссылки, часы при форфейте, отключение продления при блокировке аккаунта). После зелёного CI Argo выкатывает сам; проверить: `outegro.dev`, `outegro.dev/stack`, миграция `battleship-migrate` (колонка `pending_forfeit`).
- Ветка `feat/cross-site-navigation` (не слита): общее меню аккаунта в `@outegro/ui`, battleship-web (меню, «что у меня есть» и «Управлять подпиской» → pay), `safeReturnUrl` в `@outegro/bff`; pay-web и id-web — частично. Доделать, прогнать тесты всех трёх приложений, слить, задать env новых URL в gitops, если понадобятся.
- Hermes: управляемая политика (`gitops/apps/agents/hermes-policy`) — без терминала/файлов/кода, модель только Codex, ответы только в группе владельца и в личке. Владелец проверяет ответ в General и `/sethome`; для TC-H-04-01 нужен второй аккаунт Telegram.
- После этого — приоритизация бэклога вместе с владельцем (18 карточек в Todo, 9 In Progress).

## Нужно от владельца

- Войти в Grafana: `admin.outegro.dev/grafana` (вход через админку).
- Hermes: написать в General, выполнить `/sethome`, проверить, что он не видит файлов и терминала.
- Ротация трёх секретов из лога сессии — отложена владельцем.
