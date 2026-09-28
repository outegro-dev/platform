# Payments, Lava и subscriptions

От API fixtures перейти к idempotent checkout, журналу, grants, подпискам и проверке merchant. Продажи отдельно от готовности кода.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [PAY-01](tasks/PAY-01.md) | Provider contract fixture suite | [BE-04](../02-backend-foundation/tasks/BE-04.md) | planned |
| [PAY-02](tasks/PAY-02.md) | Catalog/price/order/payment schema | [BE-03](../02-backend-foundation/tasks/BE-03.md), [PAY-01](tasks/PAY-01.md) | planned |
| [PAY-04](tasks/PAY-04.md) | Durable authenticated webhook inbox | [PAY-01](tasks/PAY-01.md), [BE-06](../02-backend-foundation/tasks/BE-06.md) | planned |
| [PAY-03](tasks/PAY-03.md) | Idempotent checkout state machine | [PAY-02](tasks/PAY-02.md), [ID-04](../03-identity/tasks/ID-04.md) | planned |
| [PAY-05](tasks/PAY-05.md) | Payment processing/journal/outbox | [PAY-02](tasks/PAY-02.md), [PAY-04](tasks/PAY-04.md), [BE-05](../02-backend-foundation/tasks/BE-05.md) | planned |
| [PAY-06](tasks/PAY-06.md) | Source grants и expiry | [PAY-05](tasks/PAY-05.md), [BE-04](../02-backend-foundation/tasks/BE-04.md) | planned |
| [PAY-07](tasks/PAY-07.md) | Subscription root/renew/period model | [PAY-05](tasks/PAY-05.md), [PAY-06](tasks/PAY-06.md) | planned |
| [PAY-09](tasks/PAY-09.md) | Refund/dispute inbox и unmatched | [PAY-04](tasks/PAY-04.md), [PAY-05](tasks/PAY-05.md), [PAY-06](tasks/PAY-06.md) | planned |
| [PAY-08](tasks/PAY-08.md) | Cancel workflow и paid-until UX | [PAY-07](tasks/PAY-07.md), [ID-04](../03-identity/tasks/ID-04.md) | planned |
| [PAY-10](tasks/PAY-10.md) | Reconciliation jobs/issues | [PAY-07](tasks/PAY-07.md), [PAY-08](tasks/PAY-08.md), [PAY-09](tasks/PAY-09.md) | planned |
| [PAY-11](tasks/PAY-11.md) | Pay web/история/подписки | [DS-05](../01-landing-design/tasks/DS-05.md), [PAY-03](tasks/PAY-03.md), [PAY-07](tasks/PAY-07.md), [PAY-08](tasks/PAY-08.md), [PAY-09](tasks/PAY-09.md), [ID-08](../03-identity/tasks/ID-08.md) | planned |
| [PAY-12](tasks/PAY-12.md) | Provider account integration test | [PAY-10](tasks/PAY-10.md), [PAY-11](tasks/PAY-11.md) | planned |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
