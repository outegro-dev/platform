# Event contract v1

```json
{
  "eventId": "00000000-0000-4000-8000-000000000001",
  "type": "billing.grant.changed.v1",
  "schemaVersion": 1,
  "occurredAt": "2026-09-27T12:00:00.000Z",
  "aggregateId": "00000000-0000-4000-8000-000000000002",
  "aggregateVersion": 2,
  "producer": "payments",
  "correlationId": "corr-fixture-001",
  "causationId": "cmd-fixture-001",
  "payload": {
    "grantId": "00000000-0000-4000-8000-000000000002",
    "userId": "00000000-0000-4000-8000-000000000003",
    "service": "fixture-product",
    "feature": "access",
    "sourceType": "purchase",
    "sourceId": "00000000-0000-4000-8000-000000000004",
    "state": "active",
    "validFrom": "2026-09-27T12:00:00.000Z",
    "validUntil": "2026-10-27T12:00:00.000Z"
  }
}
```

Все значения выше synthetic. Поля userId и sourceId — references, а не разрешение на действие. validUntil null разрешён только для явно бессрочного права. Consumers не превращают null в «неизвестный значит бесконечный».

## Каталог

| Event | Producer | Required payload | Consumers |
|---|---|---|---|
| identity.user.created.v1 | Identity | userId, locale, status | Admin, Notifications по политике, Payments |
| identity.user.locale.changed.v1 | Identity | userId, locale | Notifications/Admin/Payments |
| identity.user.contact.changed.v1 | Identity | userId, email nullable, emailVerified | Notifications и Payments (email покупателя для invoice и отмены подписки в Lava); остальные события без PII |
| identity.session.revoked.v1 | Identity | userId, sessionId, reason | Admin/audit |
| notifications.intent.requested.v1 | Любой сервис (в свой exchange) | sourceEventId, templateKey, category, recipient.userId, locale?, channels?, data | Notifications |
| identity.user.status.changed.v1 | Identity | userId, status, accessVersion | Access projections/Admin/Payments |
| identity.role.binding.changed.v1 | Identity | bindingId, userId, roleKey, scope, state, accessVersion | Admin/cache invalidation/Payments (accessVersion для admin-команд) |
| billing.payment.confirmed.v1 | Payments | paymentId, orderId, userId, money, confirmedAt | Notifications/Admin |
| billing.subscription.changed.v1 | Payments | subscriptionId, userId, state, paidUntil, autoRenew | Notifications/Admin |
| billing.grant.changed.v1 | Payments | См. пример | Identity/Admin/future apps |
| billing.refund.recorded.v1 | Payments | refundId, paymentId nullable until match, money, state | Admin/Notifications после verified match |
| billing.reconciliation.issue.v1 | Payments | issueId, kind, severity, relatedIds | Admin/ops |
| notifications.delivery.changed.v1 | Notifications | deliveryId, intentId, userId, channel, state | Admin |

## Алгоритм outbox

1. Начать DB transaction сервиса.
2. Проверить idempotency/source uniqueness и transition.
3. Записать domain row, audit при необходимости, outbox event с постоянным eventId.
4. Commit. Broker недоступен не отменяет уже committed факт.
5. Relay в короткой transaction claim-ит bounded batch с lease token, commit.
6. Publish outside transaction, дождаться publisher confirm.
7. Mark published только если lease token всё ещё актуален. Crash до mark допускает повтор того же eventId.

## Алгоритм inbox

1. Validate version/schema. Invalid отправить в quarantine с redacted reason.
2. В DB transaction проверить/создать unique(consumer,eventId), применить domain effect и processed marker вместе.
3. Commit, затем broker ack. Повтор processed event подтверждается без повторного эффекта.
4. Transient failure использует один выбранный bounded retry механизм. Poison не возвращается бесконечно в ту же queue.
5. Для projection aggregateVersion <= current игнорировать как already-applied/stale; разрыв версии проверяется по контракту, при необходимости authoritative reload.

У разных consumers отдельные очереди; конкурирующие workers одной очереди не означают broadcast всем сервисам. Source billing IDs и DB constraints остаются вторым барьером, даже если eventId случайно изменился на стороне отправителя.
