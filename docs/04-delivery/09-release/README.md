# Интеграция и production

Связать UI и сервисы, пройти failure E2E, readiness, deploy и post-release review.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [R-01](tasks/R-01.md) | Интеграция landing/service navigation | [L-10](../01-landing-design/tasks/L-10.md), [ID-09](../03-identity/tasks/ID-09.md), [N-04](../04-notifications/tasks/N-04.md), [N-05](../04-notifications/tasks/N-05.md), [PAY-11](../05-payments/tasks/PAY-11.md), [A-07](../06-admin/tasks/A-07.md) | planned |
| [R-02](tasks/R-02.md) | E2E матрица и failure scenarios | [R-01](tasks/R-01.md), [ID-10](../03-identity/tasks/ID-10.md), [PAY-12](../05-payments/tasks/PAY-12.md), [H-11](../08-hermes/tasks/H-11.md), [OPS-08](../07-operations/tasks/OPS-08.md) | planned |
| [R-03](tasks/R-03.md) | Production readiness review | [R-02](tasks/R-02.md), [OPS-07](../07-operations/tasks/OPS-07.md), [OPS-08](../07-operations/tasks/OPS-08.md) | planned |
| [R-04](tasks/R-04.md) | Deploy immutable release | [R-03](tasks/R-03.md) | planned |
| [R-05](tasks/R-05.md) | Post-release review/runbooks | [R-04](tasks/R-04.md) | planned |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
