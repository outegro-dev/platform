# Restore rehearsal и аварийное восстановление

## Предусловия

Доступен чистый разрешённый target, offsite backup/WAL, key custody, нужные image digests и GitOps revision. Rehearsal изолирован: никакого egress к реальным получателям и автоматической работы на тех же Telegram/provider channels.

## Шаги

1. Зафиксировать последнюю recovery point и время старта. Не уничтожать исходную копию.
2. Bootstrap единственного K3s узла либо test environment по выбранной процедуре.
3. Восстановить keys/config. Для SQLite K3s использовать совместимую процедуру SQLite+server token, не etcd snapshot commands.
4. Восстановить PostgreSQL и проверить integrity/migration version/контрольные fixtures.
5. Восстановить Hermes consistent state и assistant media. DB ItemMedia ссылки сверить с objects.
6. Развернуть совместимые app images с отправками наружу выключенными.
7. Reconcile внешние payment/subscription/refund факты после recovery point через idempotent commands. Outbox/inbox replay не должен повторять бизнес-эффект.
8. Проверить login/roles/grants/inbox/admin chain. После Redis loss допустим новый login, не автоматический доступ.
9. Разрешить внешние sends только после анализа backlog/duplicates и target channel. Не запускать весь historic notification archive.
10. Снять RPO/RTO. Цели: до 15 минут PG и до 4 часов после доступности заменяющего сервера; deviation описать явно.

## Выход

Report с restore point, duration, проверками данных/грантов/медиа, незакрытыми расхождениями и обновлённым runbook. Наличие backup object без этого отчёта не закрывает OPS-07.

## Проверка PostgreSQL из R2 (шаг 4, проверено 29.09.2026)

Временный кластер рядом с `pg`, собранный только из R2: последняя полная копия и WAL. Своего архивирования у него нет, поэтому цепочка бэкапов `pg` не меняется; приложения к нему не подключаются. Отчёт прогона — [OPS-07, 29.09](../09-evidence/OPS-07/20260929-1514-prod-drill/report.md).

1. Коммит в `gitops/apps/production`: `restore-drill.yaml` и строка в `kustomization.yaml` (Argo подхватывает за 3–6 минут):

   ```yaml
   apiVersion: postgresql.cnpg.io/v1
   kind: Cluster
   metadata:
     name: pg-drill
     namespace: outegro
   spec:
     instances: 1
     imageName: <тот же образ, что у pg>
     storage:
       size: 5Gi
     bootstrap:
       recovery:
         source: pg-in-r2
     externalClusters:
       - name: pg-in-r2
         plugin:
           name: barman-cloud.cloudnative-pg.io
           parameters:
             barmanObjectName: r2
             serverName: pg
   ```

   Раздела `plugins` с `isWALArchiver` быть не должно: иначе копия начнёт писать WAL в путь `pg`.
2. Ждать `Cluster in healthy state`: `sudo k3s kubectl -n outegro get cluster pg-drill -w`. Время от появления кластера до этого состояния — RTO базы.
3. Сверка: для каждой базы (`auth`, `notifications`, `payments`, `battleship`) число строк по каждой таблице и число ограничений по типам в `pg-1` и `pg-drill-1` (запрос `query_to_xml(format('select count(*) ...'))` по `information_schema.tables` и `pg_constraint`); таблицы миграций `drizzle.*` входят в сверку. Расхождения допустимы только для строк, записанных после последнего заархивированного WAL (`pg_stat_archiver.last_archived_time` на `pg-1`).
4. Удалить копию: убрать файл и строку из `kustomization.yaml`; Argo удаляет кластер и его том (prune). Проверить, что PVC `pg-drill-1` исчез.

Не покрыто этим шагом: запуск приложений на восстановленной базе с выключенными отправками, сверка с Lava после recovery point (TC-OPS-07-02, 03), восстановление всего узла.
