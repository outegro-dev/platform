# Deployment contract

Один K3s server node, SQLite datastore при отсутствии доказанной причины менять. Один PostgreSQL через CNPG, отдельные logical DB identity/notifications/payments/admin/assistant. Redis/RabbitMQ по одному persistent экземпляру. Argo CD non-HA, Traefik/cert-manager, Sealed Secrets, bounded metrics/logs/alerts. Новый environment и новые secrets; старый VPS не меняется.

| Группа | Working set hypothesis, MiB |
|---|---:|
| ОС/K3s/runtime | 1024 |
| GitOps/ingress/controllers | 850 |
| Observability | 1000 |
| PostgreSQL | 900 |
| Redis | 256 |
| RabbitMQ | 550 |
| Core apps | 1400 |
| Hermes + assistant-store | 768 |
| Итого | 6748 |

Это около 6.59 GiB, не 6.75 GiB. При MemTotal 8192 MiB запас 1444; фактическая allocatable ниже и проверяется OPS-08. Эти числа не готовые container limits. Memory limits включают native overhead, concurrency и rollout. CI build не выполняется на VPS. Тяжёлые Hermes browser/build/local-LLM workloads выключены. Agent уступает ресурсный приоритет core сервисам.

## Release invariants

Images immutable by digest/commit. Migration Job получает отдельную role, lock и deadline. Failed migration блокирует соответствующий rollout. App readiness и migration success различаются. Secrets не хранятся plaintext в Git. Network policies проверены реальными запросами. Liveness не рестартует app только из-за временного provider outage.

## Backup

PG base backup/WAL вне VPS; consistent K3s SQLite/token backup и отдельные recovery keys. Hermes SQLite/memory плюс assistant DB/media восстанавливаются согласованно. Backup success не означает restore success. Цели RPO 15 минут и RTO 4 часа после предоставления заменяющего сервера проверяются rehearsal. Дубли notification/payment после restore предотвращаются idempotency и reconciliation; внешние деньги не откатываются вместе с PG.
