# Личный Hermes и каталог

Plus route, private topics, typed catalog tools, фото и drafts. Full-stack resource test выполняется затем в OPS-08.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [H-01](tasks/H-01.md) | Подтверждены Plus OAuth, runtime, модель и каталог как workload | [BE-01](../02-backend-foundation/tasks/BE-01.md) | planned |
| [H-02](tasks/H-02.md) | Воспроизводимый pinned image/PVC/startup | [OPS-01](../07-operations/tasks/OPS-01.md), [H-01](tasks/H-01.md) | planned |
| [H-03](tasks/H-03.md) | Приватный OAuth, auth persistence и reauth | [H-02](tasks/H-02.md) | planned |
| [H-04](tasks/H-04.md) | Allowlist канала, tools/egress/resource policy | [H-02](tasks/H-02.md) | planned |
| [H-05](tasks/H-05.md) | No-spend/auxiliary/quota acceptance | [H-03](tasks/H-03.md), [H-04](tasks/H-04.md) | planned |
| [H-07](tasks/H-07.md) | Topics routing, owner/chat allowlist, versioned rules | [H-04](tasks/H-04.md) | planned |
| [H-06](tasks/H-06.md) | Backup/restore/alerts и full-stack load test | [H-05](tasks/H-05.md), [OPS-05](../07-operations/tasks/OPS-05.md), [OPS-06](../07-operations/tasks/OPS-06.md) | planned |
| [H-08](tasks/H-08.md) | Assistant-store/Drizzle schema, media ingest, idempotency | [BE-07](../02-backend-foundation/tasks/BE-07.md), [H-07](tasks/H-07.md), [OPS-02](../07-operations/tasks/OPS-02.md) | planned |
| [H-09](tasks/H-09.md) | Фото → item draft → уточнения → сохранённая карточка | [H-08](tasks/H-08.md), [H-05](tasks/H-05.md) | planned |
| [H-10](tasks/H-10.md) | Черновики объявлений, версии и управляемая публикация | [H-09](tasks/H-09.md) | planned |
| [H-11](tasks/H-11.md) | Тесты контекстов/альбомов/restart/restore/no-spend | [H-06](tasks/H-06.md), [H-07](tasks/H-07.md), [H-08](tasks/H-08.md), [H-09](tasks/H-09.md), [H-10](tasks/H-10.md) | planned |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
