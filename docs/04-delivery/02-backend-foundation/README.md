# Backend, Drizzle и доставка событий

Проверить совместимость, разделить DB roles, реализовать contracts/outbox/inbox до бизнес-сервисов.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [BE-01](tasks/BE-01.md) | Матрица Node/Nest/AMQP/Drizzle | [L-10](../01-landing-design/tasks/L-10.md) | planned |
| [BE-02](tasks/BE-02.md) | Решить RabbitMQ adapter compatibility | [BE-01](tasks/BE-01.md) | planned |
| [BE-03](tasks/BE-03.md) | Схемы новых DB + migrations | [BE-01](tasks/BE-01.md) | planned |
| [BE-04](tasks/BE-04.md) | Контракты ошибок/events/IDs | [BE-01](tasks/BE-01.md) | planned |
| [BE-05](tasks/BE-05.md) | Outbox relay с lease и confirms | [BE-02](tasks/BE-02.md), [BE-03](tasks/BE-03.md), [BE-04](tasks/BE-04.md) | planned |
| [BE-07](tasks/BE-07.md) | Runtime/migration DB roles | [BE-03](tasks/BE-03.md) | planned |
| [BE-06](tasks/BE-06.md) | Consumer inbox/idempotency/retry | [BE-05](tasks/BE-05.md) | planned |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
