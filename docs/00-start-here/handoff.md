# Handoff: где остановились и как продолжить (29.09.2026)

Документ для продолжения работы на другом компьютере или в облачной сессии. Что нужно от владельца — [owner-checklist.md](owner-checklist.md), эксплуатация — [production.md](../06-operations/production.md). Задачи и статусы — доска [outegro.dev](https://github.com/orgs/outegro-dev/projects/1) (issue на каждую карточку `docs/04-delivery`).

## Состояние

| Часть | Статус | Проверки |
|---|---|---|
| `apps/landing-web` | v0.2 + next/font без сдвигов, в «Проектах» — ссылка на Морской бой | 66 e2e (3 браузера), CLS 0 |
| `packages/ui`, `packages/i18n` | шрифты через next/font, pending-кнопки, FormMessage, Skeleton, Spinner | — |
| `packages/contracts`, `packages/db`, `packages/nest-common` | + протокол Морского боя, событие матча, права `battleship.*`, `grants.assign`; пул PostgreSQL переживает рестарт БД | 19 + 9 + 16 тестов |
| `packages/bff` | + `sso.ts`: вход приложений через id.outegro.dev (PKCE) | 19 тестов |
| `packages/battleship-engine` | правила, партия (state machine), боты 4 уровней, Elo | 23 теста |
| `apps/auth-backend` | + вход через Google и привязка (ID-02), admin overview/audit, внутренний lookup пользователя | 55 тестов |
| `apps/notifications-backend` | + привязка Telegram (N-04, вебхук `hooks.outegro.dev/telegram`), admin API (доставки, повтор, шаблоны, пауза каналов, тест себе) | 39 тестов |
| `apps/payments-backend` (4003) | Lava: checkout, вебхуки, сверка, подписки, возвраты, гранты, admin API; прошёл QA (6 багов исправлено) | 104 теста |
| `apps/battleship-backend` (4004) | игровой сервер: WebSocket `/ws`, подбор, боты, комнаты, рейтинг, статистика, admin API; прошёл QA (блокер и 2 high исправлены) | 105 тестов |
| `apps/id-web` (3002) | + Google, «Безопасность», Telegram в уведомлениях; формы без сдвигов, скелетоны, состояния | 25 e2e |
| `apps/battleship-web` (3005) | MobX-сторы, GameSocket, расстановка, бой, анимации, лидерборд, профиль, магазин, EN/RU | 97 unit + 67 e2e |
| `apps/pay-web` (3003) | покупки, страница возврата с Lava, подписки, каталог | 117 unit + 32 e2e |
| `apps/admin-web` (3004) | в работе (ветка `feat/admin-web`); манифест в gitops готов, не включён | — |
| Production | outegro.dev, id., battleship., pay., hooks. — K3s за Cloudflare; Argo CD; бэкапы в R2; watchdog с алертами в Telegram | CI → GHCR → gitops → Argo |

## Развернуть на новой машине

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

- Коммиты только от имени владельца, conventional commits, без упоминания AI-инструментов; lint проверять кодом возврата (в пайпе ошибка теряется).
- Новое приложение: цель в `Dockerfile` и в списке `APPS` в `docker-bake.hcl`, манифест и запись `images` в gitops — CI сам обновит все образы `outegro/*`.
- Стек — [ADR-009](../03-decisions/adr/009-backend-stack.md). Библиотечные API — через Context7, как в AGENTS.md.

## Открытые решения после QA

- Морской бой: если после рестарта сервера оба игрока не вернулись за 60 с, рейтинговую партию проигрывает место «a» — предложено отменять без результата.
- Платежи: две покупки с разными ключами можно оплатить обе (повторная подписка) — предложено переиспользовать ожидающую попытку и открывать issue `duplicate_purchase`; отзыв гранта подписки не отменяет продление в Lava.
- Подробности — в issues доски.
