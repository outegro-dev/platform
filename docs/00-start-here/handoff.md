# Handoff: где остановились и как продолжить (28.09.2026)

Документ для продолжения работы на другом компьютере или в облачной сессии. Подробный план — [next-steps.md](next-steps.md), что нужно от владельца — [owner-checklist.md](owner-checklist.md).

## Состояние

| Часть | Статус | Проверки |
|---|---|---|
| `apps/landing-web` | готов (v0.2): cookie-язык, standalone, CSP, 3D, политика конфиденциальности `/privacy` | 64 e2e (Playwright, 3 браузера), Lighthouse desktop 99 / mobile 86–87 |
| `packages/ui`, `packages/i18n` | готовы | — |
| `packages/contracts`, `packages/db`, `packages/nest-common` | готовы | 7 + 8 + 15 интеграционных тестов |
| `apps/auth-backend` | вход по коду, сессии и ротация refresh, роли, admin API, проекция грантов, SSO authorization code + PKCE | 40 тестов (ID-01/03/04/06/07/08/10) |
| `apps/notifications-backend` | intents, доставка email/Telegram с ретраями, inbox, настройки, приватная доставка кода; письма ведут в кабинет (сеансы, настройки) | 23 теста (N-01/02/03) |
| `packages/bff` | вызовы сервисов из Next.js, httpOnly-cookie сессии, refresh в proxy, безопасный redirect, проброс User-Agent и IP клиента | 11 тестов |
| `apps/id-web` (порт 3002) | вход по коду, `/authorize` (SSO), профиль, сессии, inbox с пагинацией, настройки уведомлений; EN/RU, CSP с nonce, свои 404 и страница ошибки, раскладка для телефона | 10 e2e (ID-04/09/10, axe, телефон) |
| Локальная инфраструктура | `pnpm infra:up`: Postgres 18, Valkey 9, RabbitMQ 4, Mailpit | — |

Проверено вручную: вход в id-web по коду из Mailpit, смена языка профиля (письма приходят на новом языке), отзыв чужого сеанса, inbox, настройки уведомлений, SSO-редирект с кодом и обмен кода на токены (повтор отклоняется).

## Развернуть на новой машине

1. Установить Node.js 24+, `corepack enable` (pnpm 12.3.4), Docker, Python 3.13 в PATH.
2. Получить репозиторий (GitHub-клон или `git clone outegro-platform.bundle outegro-dev-showcase`).
3. В папке репозитория:

   ```text
   git config user.name "Nick Lukashik"
   git config user.email "coping.barrel@gmail.com"
   pnpm install
   pnpm infra:up
   pnpm env:local
   pnpm build
   pnpm --filter @outegro/auth-backend db:migrate
   pnpm --filter @outegro/notifications-backend db:migrate
   ```

4. Запуск: `pnpm --filter @outegro/auth-backend dev` (порт 4001), `pnpm --filter @outegro/notifications-backend dev` (4002) и `pnpm --filter @outegro/id-web dev` (3002, кабинет — http://localhost:3002). Почта — http://localhost:8025. Локальные SSO-клиенты `pay-web` (3003) и `admin-web` (3004) прописаны в `OAUTH_CLIENTS` из `.env.example`.
5. Первый owner: войти один раз по email, затем `pnpm --filter @outegro/auth-backend build && node apps/auth-backend/dist/cli/grant-owner.js --email you@example.com --reason "initial owner"` (запускать из `apps/auth-backend`, где лежит `.env`).
6. Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test` (нужен Docker), `pnpm exec playwright install chromium firefox webkit` и `pnpm test:e2e --workers=2`. E2E кабинета: `pnpm test:e2e:id` (нужны `infra:up`, миграции и `pnpm build`; сервисы Playwright поднимет сам или переиспользует запущенные).

`.env` сервисов не в git: `pnpm env:local` создаёт новые локальные ключи и общий сервисный токен, а в уже существующие файлы дописывает переменные, появившиеся в `.env.example`, не трогая секреты. Секреты с другой машины переносить не нужно. Исключение — SSH-ключ нового VPS (`~/.ssh/outegro_vps`): его переносят вручную или добавляют на сервер второй ключ.

## Правила работы

- Коммиты только от имени владельца, conventional commits, без упоминания AI-инструментов.
- Стек зафиксирован в [ADR-009](../03-decisions/adr/009-backend-stack.md); refresh и доставка кода — [ADR-004](../03-decisions/adr/004-sso-refresh.md), [ADR-008](../03-decisions/adr/008-notification-auth-path.md).
- Nest-код: только value-импорты для внедряемых классов (Biome настроен так для `apps/*-backend` и `packages/nest-common`).
- Библиотечные API проверять через Context7 (`find-docs`), как описано в AGENTS.md.

## Следующие шаги (по порядку)

1. **Bootstrap VPS (OPS-01)**, как только будет сервер: пользователь `deploy`, SSH по ключу, firewall, K3s, Traefik с `externalTrafficPolicy: Local`, cert-manager с токеном Cloudflare. Требования к адресу клиента — [deployment.md](../02-contracts/deployment.md#адрес-клиента).
2. **Google OAuth и passkeys** в auth-backend (arctic, @simplewebauthn 14), когда будут Google-ключи. Callback принимает id-web: `/login/google/callback`.
3. **Привязка Telegram** (N-04): deep-link `/start <token>`, вебхук бота, запись `telegramChatId` в recipients.
4. **payments-backend + pay-web** (Lava), подписки, выдача грантов → `billing.grant.changed.v1` (Identity уже потребляет). pay-web входит через id-web: `/authorize` → `/auth/callback` → `POST /v1/oauth/token` из своего BFF (с `clientHeaders`), клиентский helper вынести в `@outegro/bff`.
5. **CI и GitOps** (этап 2): GitHub Actions → GHCR, репозиторий `gitops`, Argo CD (см. next-steps).
6. **admin-web** поверх уже готовых admin-эндпоинтов Identity.

## Открытые вопросы к владельцу

Полный список с путями по меню — [owner-checklist.md](owner-checklist.md). Коротко: VPS (провайдер, IP), Cloudflare (зона, NS, токен, R2), GitHub-организация и email для коммитов, Resend, Google OAuth client, боты Telegram.
