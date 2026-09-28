# Notifications

Создать приватную auth delivery, обычные каналы и inbox. Billing templates завершаются после соответствующих events Payments.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [N-01](tasks/N-01.md) | Intent/delivery/inbox/preferences schema | [BE-03](../02-backend-foundation/tasks/BE-03.md), [BE-04](../02-backend-foundation/tasks/BE-04.md) | planned |
| [N-02](tasks/N-02.md) | Email и auth-code priority path | [N-01](tasks/N-01.md), [ID-01](../03-identity/tasks/ID-01.md), [BE-02](../02-backend-foundation/tasks/BE-02.md) | planned |
| [N-03](tasks/N-03.md) | Delivery claim/retry/DLQ | [N-02](tasks/N-02.md), [BE-06](../02-backend-foundation/tasks/BE-06.md) | planned |
| [N-04](tasks/N-04.md) | Telegram link/channel | [ID-09](../03-identity/tasks/ID-09.md), [N-01](tasks/N-01.md) | planned |
| [N-05](tasks/N-05.md) | Inbox/settings UI | [DS-05](../01-landing-design/tasks/DS-05.md), [N-01](tasks/N-01.md), [ID-09](../03-identity/tasks/ID-09.md) | planned |
| [N-06](tasks/N-06.md) | Billing/security templates EN/RU | [N-02](tasks/N-02.md), [BE-04](../02-backend-foundation/tasks/BE-04.md), [PAY-05](../05-payments/tasks/PAY-05.md), [PAY-07](../05-payments/tasks/PAY-07.md) | planned |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
