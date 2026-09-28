# Пошаговый разбор PAY-03: создание checkout

Это алгоритм приложения, не SDK syntax Lava. Внешний запрос собирается adapter по PAY-01. Цель — один logical checkout при повторном запросе и отсутствии ответа провайдера.

## Предметные входы

Actor из verified session; priceId из body; idempotency key из header; environment из config. Не брать userId/amount/currency из browser как авторитет. Price должен быть enabled и соответствовать продаваемому продукту.

## Контрольные точки реализации

1. Создать `CreateCheckoutInput` и result union: ready с URL, pending/requesting, unknown, failed. Отдельный error для idempotency conflict.
2. Создать fake ProviderPort. Он считает calls и поддерживает режимы: ready, explicit rejection, accepted-then-timeout. Это позволяет доказать отсутствие второго POST.
3. Реализовать canonical input fingerprint по actor/action/price version, не raw JSON stringify с произвольным порядком полей.
4. В DB transaction попытаться создать idempotency record с unique(actor,action,key). Конфликт конкурентной вставки обрабатывать чтением существующей записи; SELECT перед INSERT не заменяет constraint.
5. Если record уже есть: сначала повторить permission/ownership check, сравнить fingerprint. Другой fingerprint — 409. Тот же — вернуть текущее состояние существующей attempt.
6. Для новой команды зафиксировать immutable Order price snapshot и CheckoutAttempt. Состояние requesting присваивать атомарно одному исполнителю. Конкурирующие callers не вызывают ProviderPort.
7. Commit до сети. Record уже существует даже если process падает до provider response.
8. Вызвать provider вне transaction. Timeout должен быть конечным и наблюдаемым; не держать DB row lock на весь HTTP call.
9. При ready проверить внешний URL по контракту origin, сохранить providerInvoiceId mapping и ready state с version check.
10. При явном rejection сохранить failed и нормализованный reason без секретов. Не сводить network timeout к rejected.
11. При accepted-then-timeout сохранить unknown. Повторный browser request возвращает existing unknown, а не снова вызывает create.
12. Reconciliation получает эту attempt и восстанавливает mapping только по доказанному external recovery contract. Пока его нет — операторский issue, без guessed invoice.
13. Если webhook пришёл раньше шага 9: PAY-04 уже сохранил unmatched event. После mapping reprocess связывает его с тем же Order.
14. Добавить logger fields requestId/correlationId/orderId/attemptId/provider-call-outcome. API keys/полный buyer payload не логируются.

## Точный пример теста гонки

Fixture: user-a, price USD 1000, key `fixture-checkout-1`. Две independent requests стартуют через barrier. Fake provider блокируется до того, как оба caller прошли validation. После разрешения response проверить: Order count=1, Attempt count=1, provider create call count=1, один и тот же logical order в ответах. Вторая response может быть requesting до завершения первой — это допустимо, если UI contract это описывает.

## Точный пример lost response

Fake записывает созданный invoice, затем выбрасывает timeout. После первого request Attempt=unknown. Повтор с тем же key возвращает тот же ID/state; provider create count остаётся 1. Ручная смена key не должна позволять бесконтрольно создавать duplicates без видимого UX существующей pending покупки; политику повторной новой покупки описать явно, не путать её с retry одной команды.

## Где остановиться

Нет подтверждённого Lava idempotency/recovery contract — реализовать unknown и issue. Не пытаться «починить» timeout бесконечным retry. PAY-03 может иметь работающий local contract, а PAY-12 всё ещё blocked по merchant.
