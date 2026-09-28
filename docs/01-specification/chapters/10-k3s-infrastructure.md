# Глава 10. Один VPS, K3s, GitOps и восстановление

> Версия 0.3: детальные действия, зависимости и test cases находятся в [карточках задач](../../04-delivery/README.md). Эта глава задаёт предметный контекст.

## 10.1. Физическая модель

Один новый VPS: 4 vCPU, 8 ГБ RAM, 200 ГБ SSD. Один K3s server node, без горизонтального роста и без второго VPS для staging/HA. Допускается вертикальное увеличение ресурсов этого узла. Внешний object storage для backup не является узлом кластера.

Старый сервер не переносится побайтово. Read-only аудит показал около 16 ГБ RAM, фактическое использование около 6 ГБ на момент снимка и суммарные pod requests около 6,7 ГБ. Observability потребляла около 1,77 ГБ, Argo около 0,77 ГБ. Снимок полезен для поиска затрат, но не измеряет будущую платформу и пиковые нагрузки.

## 10.2. Что сохраняем из текущего подхода

K3s, Traefik, cert-manager, GitHub Actions, registry, Argo CD, Helm, Sealed Secrets, CloudNativePG, Redis, RabbitMQ, Prometheus/Grafana/Loki/Alloy. Пересматриваем resource values, число реплик, ненужные приложения, retention, pools, migration jobs и дублируемый Helm chart. Точное копирование current values в 8 ГБ не является планом.

## 10.3. Развёртываемые компоненты

| Группа | Режим |
|---|---|
| K3s datastore | Single-node SQLite, если нет отдельной подтверждённой причины менять |
| PostgreSQL | CNPG instance=1, PVC, WAL/base backup во внешнее object storage |
| Redis | Один PVC/AOF экземпляр с запасом памяти и явными TTL |
| RabbitMQ | Один broker/PVC и необходимые management/operator компоненты |
| Applications | Одна реплика каждого нужного приложения на старте |
| Argo CD | Минимальный non-HA профиль, только нужные controllers |
| Ingress/TLS | Traefik/cert-manager, HTTPS, allowlisted routes |
| Monitoring/logs | Ограниченные single-instance deployments |

Две реплики приложения на одном узле могут помочь некоторым rollout-сценариям, но не защищают от потери узла и увеличивают рабочую память. Начинаем с одной; дополнительная replica только по измеренной потребности. HPA не включается как фиктивное решение нехватки физической RAM.

## 10.4. Проектный бюджет памяти

Это ориентиры working set, не готовые requests/limits и не benchmark.

| Группа | MiB, целевой ориентир |
|---|---:|
| ОС, K3s, container runtime | 1024 |
| GitOps, ingress, сертификаты, операторы | 850 |
| Метрики, Grafana, alerts, логи | 1000 |
| PostgreSQL | 900 |
| Redis | 256 |
| RabbitMQ | 550 |
| Четыре backend + четыре frontend, фоновые задачи | 1400 |
| Hermes + assistant-store | 768 |
| Итого | 6748 |

При фактических 8192 MiB остаётся 1444 MiB для пиков/rollout; VPS с «8 GB» может иметь другой MemTotal. Использовать реальную allocatable memory. Namespace ResourceQuota/LimitRange, контейнерные requests/limits и Node heap определяются по измерениям; лимит heap меньше container limit с запасом на native memory. Нельзя раздать всем сервисам минимальные лимиты и считать неизбежный OOM оптимизацией.

При непрохождении: сократить лишние exporter targets, retention, фоновые concurrency и дублирующие pods; оптимизировать приложение. Если обязательная функциональность всё равно не помещается с запасом — согласовать вертикальный upgrade. Не скрывать необходимость ресурсов удалением платежной надёжности или отключением backup.

## 10.5. Диск и CPU

Предварительная раскладка 200 ГБ: ОС/образы 30; PG/WAL 45; RabbitMQ 8; Redis 4; metrics 8; logs 12; assets/temp/jobs 8; Hermes data 10; operational reserve 15; свободный запас 60. Сумма 200, но partition/PVC фактически меньше nominal диска и уточняются. PVC requests не означают жёстко выделенные отдельные физические диски; смотреть реальное filesystem usage и inodes.

CI build вне VPS. CPU workers/concurrency ограничены. Не запускать нагрузочный тест, backup stress и массовый event replay одновременно без отдельного сценария. RollingUpdate учитывает maxSurge и свободную память; для малых сервисов осознанно допускается короткое окно недоступности при отсутствии ресурса на две replicas, с понятным release window.

## 10.6. Bootstrap

ОС/security updates, отдельный deploy-user/key, firewall, SSH policy, time sync, disk monitoring. Версия K3s фиксируется после проверки компонентов. DNS zones для outegro.dev и subdomains, TLS issuer, registry credentials, namespaces, service accounts, DB roles и backup secrets создаются воспроизводимо. Никакого переноса старых production secrets в новую систему по умолчанию.

Новый Sealed Secrets key и новый auth signing key. Для восстановления сохранить их защищённые копии вне VPS. Секреты не попадают в Git, презентацию или общий чат. Разные credentials на DB, provider API, webhook, SMTP и CI. Production credentials не используются в локальных fixtures.

## 10.7. Сеть и deployment

DB/Redis/AMQP не публикуются наружу. NetworkPolicy default deny с явными разрешениями DNS, нужных сервисов и внешних провайдеров; проверить фактическое enforcement выбранного K3s networking. Ingress forwarding headers/IP trust соответствует реальному пути, direct-origin bypass отдельно проверяется. Панели управления закрываются отдельным доступом и сильной auth.

Readiness сигнализирует способность обслуживать запрос, liveness не перезапускает приложение из-за краткого provider сбоя. Graceful shutdown останавливает новые запросы/consumption и завершает допустимые операции. Migration Job имеет lock, deadline, лог и одно execution per release. Не повторять destructive job при каждом resync.

## 10.8. GitOps pipeline

PR → lint/typecheck/meaningful tests → build immutable image → security/dependency checks по принятой политике → registry digest → PR в GitOps → review/diff → Argo sync → migrations → readiness → smoke → запись release. Shared Helm chart один источник, values по сервисам. Нет mutable latest как production идентичности. Ошибка migration останавливает rollout зависимого приложения.

Для одного разработчика review не означает обязательного второго человека; важны проверяемый diff, зелёные checks и сохранённая история. Существующий production не затрагивается новыми manifests; repository/environment names и secrets явные.

## 10.9. Среды без второго VPS

Local Compose/dev cluster для ежедневной работы; ephemeral CI environment для integration; локальный K3s-compatible rehearsal или временный namespace на том же VPS с очень ограниченным ресурсом, только если хватает и без смешивания данных. Постоянный полный staging-дубликат на 8 ГБ не закладывается. Preview сайта может быть локальным/CI artifact; платежные fixtures не вызывают реальные списания.

## 10.10. Backup и restore

PostgreSQL: base backup + WAL во внешний bucket, шифрование, retention и проверка свежести. K3s SQLite: согласованная копия datastore и server token по документации; не применять etcd snapshot процедуру к SQLite. Sealed Secrets private key и ключи приложения восстанавливаются отдельно. GitOps repository и image registry обеспечивают manifests/images, но не данные. Redis потеря допустимо завершает сессии; Postgres business state — авторитетен. RabbitMQ durability дополняется outbox/inbox, а не заменяет backup.

Проектные цели: RPO PostgreSQL до 15 минут при рабочем WAL archive, RTO платформы до 4 часов после доступности заменяющего сервера. Это не обещание закупки/поднятия провайдером за 4 часа. Цели подтверждаются restore drill. Одновременно действующий узел остаётся один; аварийная замена не означает горизонтальное расширение.

Restore rehearsal: новая изолированная среда → bootstrap K3s/secrets → восстановление PG до выбранного времени → deploy images → проверка связности → replay/reconcile внешних платежей → новая сессия пользователя → сверка grants → проверка notifications. После PITR внешние реальные платежи не откатываются, поэтому reconciliation обязателен до открытия продаж. Не отправлять повторно весь архив уведомлений после восстановления.

Источники: [K3s datastore](https://docs.k3s.io/datastore), [backup/restore](https://docs.k3s.io/datastore/backup-restore). Старый production backup был completed на момент аудита, но его успешный restore не проверялся.

## 10.11. Приёмка

Чистый bootstrap воспроизводится; TLS и DNS корректны; внутренние порты закрыты; все обязательные pods healthy; actual RAM/disk с запасом; нет постоянного swap thrashing; backup уходит вне узла; recovery secrets доступны владельцу; restore проверен; GitOps rollback/smoke документированы. Бюджет обновляется измерениями, а не остаётся красивой оценкой в плане.
