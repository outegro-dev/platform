# Отчёт R-02: E2E матрица и сценарии отказов

- Статус: done. TC-R-02-01, TC-R-02-02 — pass (локально и в CI); TC-R-02-03 — blocked и перенесён в H-11 (тесты продуктовой части Hermes): проверять нечего, пока H-08…H-10 не сделаны; TC-R-02-04 — этот отчёт.
- Task card: [R-02](../../../04-delivery/09-release/tasks/R-02.md)
- Commit: `2cb5cc2` (тесты), `9a1c98b` (исправление, найденное ими).
- Environment: Windows 11, Docker 29.7.2, Node 26.8.1; в CI — ubuntu-latest, Node 24. Сервисы — собранные `dist/main.js` (те же файлы, что в образах) четырёх бэкендов; PostgreSQL 18.6, Valkey 9.1, RabbitMQ 4.3, Mailpit через Testcontainers; Lava — HTTP-двойник `gate.lava.top` (`packages/system-tests/src/fake-lava.ts`: создание счёта, счёт, поиск счетов, отмена подписки). Брокер и SMTP — через TCP-прокси теста, чтобы их «отключать» без перенастройки сервисов.
- Запуск: `pnpm --filter @outegro/system-tests test` (нужен Docker и собранные бэкенды; turbo собирает их сам как зависимости пакета). В CI входит в `pnpm turbo run test`.

## Проверки

| TC | Что делает тест | Результат | Evidence |
|---|---|---|---|
| TC-R-02-01 Покупка | Вход по коду (Identity → Notifications → SMTP → код из Mailpit) → checkout `battleship-premium` (payments спрашивает Identity о покупателе, создаёт счёт в «Lava») → вебхук `payment.success` с секретом → заказ `paid` → Premium в профиле Battleship (событие гранта через RabbitMQ) → письмо об оплате (через RabbitMQ и SMTP) → owner (CLI `grant-owner`, роль в новом токене через refresh) видит в admin API заказ, счёт Lava, один платёж, один активный grant. Повтор того же вебхука: одно событие провайдера, одно письмо, один grant в Battleship | pass | `src/purchase.test.ts`, три прогона подряд по 45 с |
| TC-R-02-02 Fault: брокер | Брокер отрезан до вебхука: вебхук принят (200), заказ `paid`, grant в payments, события в outbox `pending`; Premium и письма нет. Брокер вернулся: Premium и ровно одно письмо | pass | там же |
| TC-R-02-02 Fault: почта | SMTP отрезан: заказ оплачен, Premium есть, доставка письма в `retry_wait`. SMTP вернулся: письмо пришло один раз | pass | там же |
| TC-R-02-03 Hermes | Квота после фото, черновик сохранён, модель на паузе | blocked | Продуктовая часть Hermes (H-08…H-11: фото, черновики, каталог) не реализована; проверять нечего. No-spend Hermes проверяется в H-05 |
| TC-R-02-04 Доказательство | Внешние проверки не выдаются за pass | см. ниже | — |

## Найдено и исправлено

- **Покупка сразу после регистрации.** Строка покупателя в payments создаётся событием `user.created`, а почта приходит отдельным событием. Если checkout успевал раньше второго, payments отвечал 422 «нужен подтверждённый email». Тест поймал это при одном из прогонов. Исправление `9a1c98b`: при отсутствии подтверждённой почты checkout спрашивает Identity и применяет ответ по правилу версий (новее — заменяет, позднее событие ничего не портит). Тест payments «a buyer whose contact event is still on its way can buy».

## Что не проверялось и почему (TC-R-02-04)

| Проверка | Статус | Почему |
|---|---|---|
| Настоящая Lava (оплата картой, вебхук от провайдера) | not-run в тесте | Реальные платежи делает только владелец. Покупка Premium владельцем 29.09 и отмена продления 01.10 прошли в production: подписка `cancelling`, Lava подтвердила отмену ответом на `DELETE /api/v1/subscriptions` |
| Возврат денег через Lava | not-run | Требует реального возврата владельцем (PAY-12) |
| Письма через Resend (production-провайдер) | not-run в тесте | В тесте SMTP; в production письма уходят (вход по коду работает) |
| Telegram-канал уведомлений | not-run | Внешний бот; в тесте не подключается |
| Hermes | blocked | См. TC-R-02-03 |
| Браузерные потоки (id-web, pay-web, battleship-web, admin-web) | вне этого теста | Покрыты e2e каждого приложения (Playwright): id-web 39, admin-web 159, pay-web 32, battleship-web 84 |
