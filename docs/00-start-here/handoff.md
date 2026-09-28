# Handoff: где остановились и как продолжить (28.09.2026)

Документ для продолжения работы на другом компьютере или в облачной сессии. Подробный план — [next-steps.md](next-steps.md), что нужно от владельца — [owner-checklist.md](owner-checklist.md).

## Состояние

| Часть | Статус | Проверки |
|---|---|---|
| `apps/landing-web` | готов (v0.2): cookie-язык, standalone, CSP, 3D | 58 e2e (Playwright), Lighthouse desktop 99 / mobile 86–87 |
| `packages/ui`, `packages/i18n` | готовы | — |
| `packages/contracts`, `packages/db`, `packages/nest-common` | готовы | 7 + 8 + 15 интеграционных тестов |
| `apps/auth-backend` | вход по коду, сессии и ротация refresh, роли, admin API, проекция грантов, SSO authorization code + PKCE | 40 тестов (ID-01/03/04/06/07/08/10) |
| `apps/notifications-backend` | intents, доставка email/Telegram с ретраями, inbox, настройки, приватная доставка кода | 22 теста (N-01/02/03) |
| `packages/bff` | вызовы сервисов из Next.js, httpOnly-cookie сессии, refresh в proxy, безопасный redirect, проброс User-Agent и IP клиента | 11 тестов |
| `apps/id-web` (порт 3002) | вход по коду, `/authorize` (SSO), профиль, сессии, inbox, настройки уведомлений; EN/RU, CSP с nonce | 6 e2e (ID-04/09/10) |
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

4. Запуск: `pnpm --filter @outegro/auth-backend dev` (порт 4001), `pnpm --filter @outegro/notifications-backend dev` (4002) и `pnpm --filter @outegro/id-web dev` (3002, кабинет — http://localhost:3002). Почта — http://localhost:8025. Локальные SSO-клиенты `pay-web` (3003) и `admin-web` (3004) прописаны в `OAUTH_CLIENTS` из `.env.example`; в старый `.env` строку нужно добавить вручную или пересоздать его через `pnpm env:local --force`.
5. Первый owner: войти один раз по email, затем `pnpm --filter @outegro/auth-backend build && node apps/auth-backend/dist/cli/grant-owner.js --email you@example.com --reason "initial owner"` (запускать из `apps/auth-backend`, где лежит `.env`).
6. Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm test` (нужен Docker), `pnpm exec playwright install chromium firefox webkit` и `pnpm test:e2e --workers=2`. E2E кабинета: `pnpm test:e2e:id` (нужны `infra:up`, миграции и `pnpm build`; сервисы Playwright поднимет сам или переиспользует запущенные).

`.env` сервисов не в git: `pnpm env:local` создаёт новые локальные ключи и общий сервисный токен. Секреты с другой машины переносить не нужно.

## Правила работы

- Коммиты только от имени владельца, conventional commits, без упоминания AI-инструментов.
- Стек зафиксирован в [ADR-009](../03-decisions/adr/009-backend-stack.md); refresh и доставка кода — [ADR-004](../03-decisions/adr/004-sso-refresh.md), [ADR-008](../03-decisions/adr/008-notification-auth-path.md).
- Nest-код: только value-импорты для внедряемых классов (Biome настроен так для `apps/*-backend` и `packages/nest-common`).
- Библиотечные API проверять через Context7 (`find-docs`), как описано в AGENTS.md.

## Следующие шаги (по порядку)

1. **Google OAuth и passkeys** в auth-backend (arctic, @simplewebauthn 14), когда будут Google-ключи.
2. **Привязка Telegram** (N-04): deep-link `/start <token>`, вебхук бота, запись `telegramChatId` в recipients.
3. **payments-backend + pay-web** (Lava), подписки, выдача грантов → `billing.grant.changed.v1` (Identity уже потребляет). pay-web входит через id-web: `/authorize` → `/auth/callback` → `POST /v1/oauth/token` из своего BFF (с `clientHeaders`), клиентский helper вынести в `@outegro/bff`.
4. **Этап 2 инфраструктуры** параллельно: VPS, K3s, Argo CD, CI → GHCR (см. next-steps).
5. **admin-web** поверх уже готовых admin-эндпоинтов Identity.

## Открытые вопросы к владельцу

- GitHub-организация (`outegro-dev` или `outegro`) и email для коммитов.
- Resend-аккаунт и подтверждение домена; Google OAuth client; бот для уведомлений; VPS.
