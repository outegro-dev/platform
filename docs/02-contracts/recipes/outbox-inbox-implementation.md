# Пошаговый разбор BE-05/06: надёжные события

## Минимальные таблицы

Outbox: eventId PK, type, schemaVersion, aggregateId/version, payload, createdAt, status, leaseToken, leaseUntil, attempts, publishedAt. Inbox: consumer+eventId unique, status, processedAt, optional claim metadata. Доменные source keys независимы от этих таблиц.

## Relay

1. Выбрать пачку pending/expired-lease rows в короткой transaction с поддерживаемой PostgreSQL locking стратегией.
2. Записать новый случайный leaseToken, leaseUntil и attempt count. Не использовать один процессный bool как межпроцессную блокировку.
3. Commit и освободить connection. Publish messages с прежним eventId и publisher confirms.
4. Mark published условным UPDATE по eventId+leaseToken; stale worker не перезаписывает новую claim.
5. При nack/timeout оставить retryable state с bounded backoff. Не считать отсутствие exception broker confirm.
6. После crash recovery подбирает expired lease. Повтор delivery допустим и ожидаем.

## Consumer

1. Parse schema/version и отделить permanent schema problem от transient dependency error.
2. Для обычного локального DB effect начать transaction.
3. INSERT inbox identity. При unique conflict проверить processed state; не повторять effect.
4. Применить domain transition с его unique/version constraints.
5. Записать processed marker и domain outbox при необходимости, commit.
6. Ack брокеру после commit. При process crash до ack повтор будет no-op business effect.

Handler с внешним side effect не помещает send внутрь такой transaction. Он создаёт локальный intent, а delivery worker делает отдельный lease/send workflow. Иначе «атомарный inbox» не делает внешний email exactly-once.

## Fault matrix

| Точка сбоя | Что должно остаться | Что происходит после restart |
|---|---|---|
| До business commit | Нет business change и event | Команда может безопасно повториться по idempotency |
| После commit до publish | Domain+pending outbox | Relay отправит |
| После confirm до mark | Domain+unmarked outbox | Повтор того же eventId |
| Consumer до commit | Нет domain effect/processed | Redelivery применит |
| Consumer после commit до ack | Effect+processed | Redelivery no-op+ack |
| Stale relay после новой lease | Новый lease owner | Старый UPDATE не меняет state |

Проверять через реальные DB connections и управляемые failpoints. Не имитировать constraints одной Map в unit test.
