# K3s и эксплуатация

Один VPS, GitOps, data persistence, наблюдаемость, backup/restore. OPS-08 ждёт весь P0 stack, включая Hermes.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [OPS-01](tasks/OPS-01.md) | Чистый bootstrap и DNS/TLS | [L-10](../01-landing-design/tasks/L-10.md), [BOOT-02](../00-preparation/tasks/BOOT-02.md) | planned |
| [OPS-04](tasks/OPS-04.md) | Метрики/логи/correlation | [BE-04](../02-backend-foundation/tasks/BE-04.md), [OPS-01](tasks/OPS-01.md) | planned |
| [OPS-02](tasks/OPS-02.md) | PG/Redis/Rabbit PVC/roles/limits | [OPS-01](tasks/OPS-01.md), [BE-07](../02-backend-foundation/tasks/BE-07.md) | planned |
| [OPS-05](tasks/OPS-05.md) | Dashboards/alerts/runbooks | [OPS-04](tasks/OPS-04.md) | planned |
| [OPS-03](tasks/OPS-03.md) | GitOps chart/migration job | [OPS-02](tasks/OPS-02.md), [BE-07](../02-backend-foundation/tasks/BE-07.md) | planned |
| [OPS-06](tasks/OPS-06.md) | Backup/WAL/secret recovery | [OPS-02](tasks/OPS-02.md) | planned |
| [OPS-07](tasks/OPS-07.md) | Restore rehearsal | [OPS-06](tasks/OPS-06.md), [PAY-10](../05-payments/tasks/PAY-10.md), [OPS-03](tasks/OPS-03.md) | planned |
| [OPS-08](tasks/OPS-08.md) | Ресурсный профиль 8 ГБ | [OPS-03](tasks/OPS-03.md), [OPS-05](tasks/OPS-05.md), [OPS-07](tasks/OPS-07.md), [ID-10](../03-identity/tasks/ID-10.md), [N-06](../04-notifications/tasks/N-06.md), [PAY-11](../05-payments/tasks/PAY-11.md), [A-07](../06-admin/tasks/A-07.md), [H-11](../08-hermes/tasks/H-11.md) | planned |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
