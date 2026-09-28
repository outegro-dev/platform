# Давление на память, CPU или диск

1. Снять node MemTotal/allocatable, pod working set/limits, restarts/OOM, disk/inodes, PG connections и queue age.
2. Различить leak, burst, backlog, rollout overlap, retention growth и agent workload. Одного total usage screenshot недостаточно.
3. Приоритет — DB/identity/payments/durable ingest. Приостановить необязательный Hermes workload и массовые replay/build jobs, если они причина.
4. Проверить bounded concurrency/prefetch/pools, log cardinality/retention и container native overhead.
5. Уменьшать optional нагрузку по измерению; не отключать financial idempotency/backups ради иллюзии экономии.
6. Если обязательный P0 stack не помещается с headroom, предложить конкретное вертикальное увеличение того же VPS с measured evidence. Не добавлять второй node.
7. Повторить steady/peak/rollout profile и сохранить новый baseline.

Диск: никогда не удалять PG/WAL/PVC вручную для освобождения места. Сначала выяснить retention/архивацию и безопасность cleanup. CPU: builds вынесены в CI, local LLM на VPS не планируется.
