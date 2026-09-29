# Отчёт OPS-07

- Статус: in_progress. Восстановление PostgreSQL из offsite-бэкапа проверено в production-кластере; запуск приложений на восстановленной базе в safe mode и сверка с провайдером после recovery point ещё не выполнялись.
- Task card: [OPS-07](../../../04-delivery/07-operations/tasks/OPS-07.md)
- Commit/ref: `gitops` `6b70aaf` (кластер `pg-drill`), `bbfc2eb` (удаление); runbook — [restore](../../../06-operations/restore.md#проверка-postgresql-из-r2-шаг-4-проверено-29092026). Запуск одобрен владельцем.
- Environment/runtime: production K3s (один узел, 8 ГБ), CloudNativePG, плагин Barman Cloud, Cloudflare R2 (`s3://outegro-dev-backups/postgres`), PostgreSQL 18.6; base backup ежедневно в 03:00 UTC, WAL — непрерывно, `archive_timeout` 5 минут.
- Прочитанные contracts/ADR: [restore runbook](../../../06-operations/restore.md), [production](../../../06-operations/production.md#бэкапы), глава 10.

## Изменения

- Временный CNPG-кластер `pg-drill` в namespace `outegro`: `bootstrap.recovery` из external cluster `pg-in-r2` (ObjectStore `r2`, `serverName: pg`), без WAL-архивирования, 5 Gi, лимит памяти 768 Mi. Ни одно приложение к нему не подключалось.
- Runbook `restore.md` дополнен проверенной процедурой (манифест, ожидание, сверка, удаление).

## Checkpoints

| Checkpoint | Результат | Evidence |
|---|---|---|
| C1 recovery point и старт | Последний заархивированный WAL на `pg` — `000000010000000000000037` в 15:15:11 UTC; кластер создан Argo в 15:14:35 UTC | `pg_stat_archiver`, журнал наблюдения |
| C2 восстановление | Job полного восстановления 15:14:40 → 15:15:29; инстанс в `Cluster in healthy state` в 15:15:56 | события кластера |
| C3 сверка | Все 4 базы совпали (ниже) | запросы сверки |
| C4 уборка | Кластер, pod и PVC `pg-drill-1` удалены Argo (prune), 15:19 UTC | `kubectl get cluster,pvc` |

## Проверки

| TC-ID | Environment | Фактический результат | Статус | Evidence |
|---|---|---|---|---|
| TC-OPS-07-01 Restore | production K3s, R2 | `auth`: 11 таблиц, 38 строк, ограничения f=4 n=71 p=11 u=1; `notifications`: 11 таблиц, 15 строк, f=2 n=67 p=11 u=2; `payments`: 17 таблиц, 25 строк, c=4 f=10 n=164 p=17 u=5; `battleship`: 9 таблиц, 221 строка, f=2 n=68 p=9. Число строк по каждой таблице (включая `drizzle.*`) и ограничения по типам в копии и в `pg` одинаковы. В копии есть реальная оплата подписки владельца, сделанная за 17 минут до восстановления | pass | вывод сверки |
| TC-OPS-07-02 PITR и провайдер | — | приложения на восстановленной базе не запускались | not-run | — |
| TC-OPS-07-03 Safety | — | workers в safe mode не запускались | not-run | — |
| TC-OPS-07-04 Цели | production | RTO базы (создание кластера → готовность): 81 с при объёме данных этой базы. RPO: потерь не обнаружено (все строки на момент восстановления есть); граница — `archive_timeout` 5 минут, цель 15 минут выполняется. RTO всего узла (новый сервер, K3s, ключи) не измерялся | pass (база), not-run (узел) | тайминги выше |

## Ограничения и незавершённое

1. Восстановление шло рядом с production на том же узле, не на чистом сервере; ключи Sealed Secrets и K3s не восстанавливались.
2. Копия содержит лишнюю пустую базу `app` (создаётся bootstrap CNPG) — на сверку не влияет.
3. `pg_last_xact_replay_timestamp()` после promote копии пуст; recovery point оценён по `pg_stat_archiver` на `pg` и совпадению данных.
4. Следующий шаг OPS-07: поднять приложения на восстановленной копии с выключенными отправками (Telegram, email, Lava) и проверить сверку с провайдером после recovery point.

## Откат

Данные production не менялись; копия удалена. Повтор — по runbook.

## Следующая задача / resume point

OPS-07: TC-02 и TC-03 (приложения в safe mode на копии), затем восстановление узла целиком по `gitops/README.md` («Новый сервер») на отдельной машине.
