# Handoff: где остановились и как продолжить (29.09.2026)

Документ для продолжения работы на другом компьютере или в облачной сессии. Что нужно от владельца — [owner-checklist.md](owner-checklist.md), эксплуатация — [production.md](../06-operations/production.md). Задачи и статусы — доска [outegro.dev](https://github.com/orgs/outegro-dev/projects/1) (issue на каждую карточку `docs/04-delivery`).

## Состояние

| Часть | Статус | Проверки |
|---|---|---|
| `apps/landing-web` | v0.2 + next/font без сдвигов; «Проекты» — Морской бой; постеры только WebP (AVIF ронял сервер по памяти); статусы «Платформы» по факту production | 67 e2e (3 браузера), CLS 0 |
| `packages/ui`, `packages/i18n` | шрифты через next/font, pending-кнопки, FormMessage, Skeleton, Spinner | — |
| `packages/contracts`, `packages/db`, `packages/nest-common` | + протокол Морского боя (в том числе отмена `abandoned`), `ALREADY_OWNED`, версии ключей шаблонов; метрики на отдельном порту 9464 и correlation логов и событий (OPS-04); access-токен только с `typ: at+jwt` (ID-10) | 20 + 11 + 32 теста |
| `packages/bff` | + `sso.ts`: вход приложений через id.outegro.dev (PKCE) | 19 тестов |
| `packages/battleship-engine` | правила, партия (state machine), боты 4 уровней, Elo | 23 теста |
| `apps/auth-backend` | + Google (ID-02), admin overview/audit, внутренний lookup; ротация ключей публикует только публичную часть; уведомления о привязке Google | 59 тестов |
| `apps/notifications-backend` | + Telegram (N-04), admin API; шаблоны оплат и безопасности EN/RU (N-06) | 65 тестов |
| `apps/payments-backend` (4003) | Lava: checkout, вебхуки, сверка, подписки, возвраты, гранты, admin API; повтор неоплаченного checkout, отказ во второй копии, `duplicate_purchase`, отзыв гранта отменяет продление в Lava; квитанции покупателю | 122 теста |
| `apps/battleship-backend` (4004) | игровой сервер; оба игрока не вернулись — партия отменяется (`abandoned`), вернувшийся вовремя выигрывает; логи и метрики сокетов | 115 тестов |
| `apps/id-web` (3002) | + Google, «Безопасность», Telegram в уведомлениях; CSRF-проверки (ID-10) | 26 e2e |
| `apps/battleship-web` (3005) | MobX-сторы, GameSocket, расстановка, бой, анимации, лидерборд, профиль, магазин, EN/RU | 103 unit + 69 e2e |
| `apps/pay-web` (3003) | покупки, страница возврата с Lava, подписки, каталог; «уже ваше» по коду `ALREADY_OWNED` | 119 unit + 32 e2e |
| `apps/admin-web` (3004) | операторская консоль: пользователи, платежи (issues с EN/RU названиями), уведомления, Морской бой, обзор | 59 unit + 136 e2e |
| Production | outegro.dev, id., battleship., pay., admin., hooks. — K3s за Cloudflare; Argo CD; бэкапы в R2; мониторинг Prometheus + Loki; watchdog с алертами в Telegram | CI → GHCR → gitops → Argo |

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

## Решения QA (сделано 29.09)

- Морской бой: оба игрока не вернулись за 60 с (после рестарта или нет) — партия отменяется (`abandoned`) без рейтинга; если второй игрок вернулся в свои 60 с — проигрывает ушедший первым.
- Платежи: второй checkout того же товара возвращает первую неоплаченную попытку; купленное или активную подписку купить повторно нельзя (`ALREADY_OWNED`); если Lava всё же подтвердила вторую оплату — грант не выдаётся, issue `duplicate_purchase` для возврата, квитанции нет. Отзыв гранта подписки отменяет продление в Lava (`DELETE /api/v1/subscriptions`), сбой — issue `renewal_cancel_failed` с повтором; списание после отзыва — `renewal_after_revoke`.

## Нужно от владельца

- Проверить «Начать игру» в Морском бое (маршрут `/ws` исправлен; сокет из вкладки владельца подключился в 13:14 UTC).
- Вход в Grafana: создать секрет администратора самому или сделать вход через SSO админки (`admin.outegro.dev/grafana`). Пока Grafana и Alertmanager выключены, Prometheus и Loki — через туннель ([README gitops](https://github.com/outegro-dev/gitops#мониторинг)).
- Restore drill (OPS-07): временный кластер `pg-drill` только из бэкапа R2, сверка с `pg`, удаление — нужно разрешение на запуск в production.
- ID-10 изменил поведение: приостановленный аккаунт не может сам отключить продление, пока жив его токен (до 5 минут); отключает оператор. Подтвердить или вернуть.
- Отчёты N-06, ID-10 и OPS-04 (`docs/09-evidence/…/report.md`) не сохранены: агентам запрещена запись таких файлов, тексты у ведущего; карточки в статусе `review`/`in_progress`.
- Ранее: первая реальная оплата Lava (Silver Fleet 50 ₽), ротация трёх секретов из лога сессии, группа Hermes в Telegram.
