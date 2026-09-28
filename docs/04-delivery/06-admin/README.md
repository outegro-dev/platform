# Административная панель

Дать владельцу поиск, диагностику цепочек и контролируемые domain commands с permission/reason/audit.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [A-01](tasks/A-01.md) | Admin auth/shell/permissions | [ID-07](../03-identity/tasks/ID-07.md), [DS-05](../01-landing-design/tasks/DS-05.md), [BE-04](../02-backend-foundation/tasks/BE-04.md) | planned |
| [A-02](tasks/A-02.md) | User search/profile/session actions | [A-01](tasks/A-01.md), [ID-09](../03-identity/tasks/ID-09.md) | planned |
| [A-06](tasks/A-06.md) | Role/flag/catalog management minimum | [A-01](tasks/A-01.md), [ID-06](../03-identity/tasks/ID-06.md), [ID-07](../03-identity/tasks/ID-07.md), [PAY-02](../05-payments/tasks/PAY-02.md) | planned |
| [A-03](tasks/A-03.md) | Orders/subscriptions/journal screens | [A-01](tasks/A-01.md), [PAY-11](../05-payments/tasks/PAY-11.md), [DS-04](../01-landing-design/tasks/DS-04.md) | planned |
| [A-04](tasks/A-04.md) | Event chain и reconciliation issues | [A-01](tasks/A-01.md), [PAY-10](../05-payments/tasks/PAY-10.md), [BE-06](../02-backend-foundation/tasks/BE-06.md), [N-06](../04-notifications/tasks/N-06.md), [ID-08](../03-identity/tasks/ID-08.md) | planned |
| [A-05](tasks/A-05.md) | Controlled retry/replay commands | [A-04](tasks/A-04.md), [N-03](../04-notifications/tasks/N-03.md) | planned |
| [A-07](tasks/A-07.md) | Audit view и sensitive actions | [A-02](tasks/A-02.md), [A-03](tasks/A-03.md), [A-04](tasks/A-04.md), [A-05](tasks/A-05.md), [A-06](tasks/A-06.md) | planned |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
