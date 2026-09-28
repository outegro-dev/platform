# ADR-003: владельцы данных

Status: proposed engineering default.

Identity владеет users/sessions/roles; Payments — orders/payments/subscriptions/grants/journal; Notifications — intents/delivery/inbox/preferences; Admin — read projections/jobs; assistant-store — личный каталог. Одна физическая PostgreSQL, logical DB и роли раздельные. Sync commands через domain API, async facts через outbox/RabbitMQ/inbox.

Paid feature не admin role. Admin не читает чужие БД напрямую. Identity хранит grant projection с version/expiry. Изменение этой границы требует обновления contracts, permission matrix, events и tests, не одного импорта repository из соседнего app.
