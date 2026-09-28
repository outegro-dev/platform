# Глава 8. Данные, Drizzle, очереди и контракты

> Версия 0.3: детальные действия, зависимости и test cases находятся в [карточках задач](../../04-delivery/README.md). Эта глава задаёт предметный контекст.

## 8.1. Новые базы

Решено: не переносить пользователей, платежи и остальные данные из старой системы. Поэтому прежний план baseline/introspection живой БД заменён проектированием новой схемы и воспроизводимым bootstrap с нуля. Старые схемы служат источником знаний о логике, а не обязательством сохранить каждый столбец.

Один PostgreSQL instance через CloudNativePG; отдельные базы/роли identity, notifications, payments, admin, assistant. Runtime roles с минимальными правами, migration role отдельно. Бизнес-сервис не получает superuser. Connections ограничены общим бюджетом PostgreSQL; четыре pools по 20 «на всякий случай» не стартовая настройка. Начальный проектный pool 3–5 на процесс с измерением очереди и удержания транзакций.

## 8.2. Работа с Drizzle

1. Выбрать совместимую stable пару ORM/Kit и pg driver.
2. Описать schema каждого сервиса и constraints. Денежные unique keys и FK внутри DB обязательны.
3. Сгенерировать SQL migration, прочитать SQL, проверить индексы, timezone и exact money types.
4. Применить к пустой ephemeral PostgreSQL того же major.
5. Проверить seed справочников/permissions и повторный запуск без дублей.
6. Написать meaningful integration tests транзакций, конкуренции, grant source, idempotency.
7. Вынести миграции в отдельный image/job; runtime app не запускает миграции при каждом старте.
8. Обновить Helm PreSync, где сейчас hardcoded Prisma migrate. Проверить путь файлов и права job.
9. Удалить Prisma imports/generate/runtime/config именно из переносимых сервисов; не оставлять два ORM для одной таблицы без переходной причины.
10. Зафиксировать процедуру forward-fix и rollback приложения.

После первого production данные становятся ценными: последующие изменения — expand/contract, совместимость N/N-1, backfill с resume, удаление столбцов отдельным релизом. `push` схемы в production не является release-процессом. [Drizzle migrations](https://orm.drizzle.team/docs/migrations).

## 8.3. Общие правила данных

UUID/другие IDs выбираются единообразно; userId стабилен и не равен email. Время хранится UTC timestamptz, показывается с понятной timezone. Soft delete применяется по смыслу, а не механически ко всем таблицам. Финансовые и audit записи immutable/append-only с корректирующими событиями. У каждого агрегата version для конкуренции и ordering. Внешний provider ID хранится вместе с provider/env, чтобы test и prod не пересекались.

Личные данные минимизируются в event payload: передавать stable IDs и необходимые поля, не полный User. Для поиска по email использовать нормализацию с заданной политикой, но не изменять provider historical buyerEmail. Retention для raw payload и logs ограничен отдельно от финансового журнала; точные сроки финансовых записей определяются до реальных продаж по применимым требованиям, без выдуманных юридических сроков.

## 8.4. RabbitMQ

Один broker с PVC. Назначение: durable доставка межсервисных событий и фоновых задач, а не временное хранение авторитетного баланса. Один RabbitMQ не даёт HA. Вид очередей (classic/quorum при одном члене) фиксируется после оценки стоимости и поддерживаемых operational tools; слово quorum не добавляет устойчивость к потере единственного узла.

Версионируемые routing keys, например `identity.user.created.v1`, `billing.grant.changed.v1`. Отдельные очереди потребителей: одно событие может обрабатываться identity, notifications и admin независимо. Consumer ack после durable processing; publisher confirms перед отметкой published. Prefetch и concurrency ограничены, чтобы не вычерпать RAM/pool БД. Retry queues с TTL/DLX или прикладной nextAttemptAt — один согласованный механизм, не несколько бесконечных циклов.

## 8.5. Outbox и inbox

В одной DB-транзакции фиксировать business change + outbox. Relay берёт ограниченную пачку/lease, публикует и получает broker confirm; сбой между publish и mark даёт дубль, который обязан выдержать consumer. Не держать сетевое ожидание в длинной транзакции с блокировками. Inbox имеет unique(consumer,eventId), claim/lease/processed и сохраняется вместе с бизнес-результатом consumer.

Доставка at-least-once. Exactly-once business effect достигается локальными инвариантами для конкретной операции, а не обещанием брокера. Replay исходного eventId повторяет доставку, но не денежный результат. Если нужна новая компенсация, это новая команда/событие с отдельной причиной и ссылкой на original.

## 8.6. Каталог событий

| Event | Владелец | Получатели | Эффект |
|---|---|---|---|
| identity.user.created.v1 | Identity | Admin, Notifications по политике | Индекс/приветствие |
| identity.user.locale.changed.v1 | Identity | Notifications, Admin | Обновить locale projection |
| identity.user.status.changed.v1 | Identity | Сервисы, Admin | Применить ограничение |
| identity.role.binding.changed.v1 | Identity | Admin | Аудит/инвалидация |
| billing.payment.confirmed.v1 | Payments | Notifications, Admin | Сообщить/показать подтверждение |
| billing.subscription.changed.v1 | Payments | Notifications, Admin | Обновить статус |
| billing.grant.changed.v1 | Payments | Identity, будущие apps, Admin | Projection доступа |
| billing.refund.recorded.v1 | Payments | Notifications, Admin | История и сообщение |
| billing.reconciliation.issue.v1 | Payments | Admin/операционные alerts | Разбор расхождения |
| notifications.delivery.changed.v1 | Notifications | Admin | Результат доставки |

Предлагаемый envelope: eventId, type, schemaVersion, occurredAt, aggregateId, aggregateVersion, producer, correlationId, causationId, trace context, payload. Tenant/org не добавляется фиктивно, пока нет такой модели. Locale входит только где нужен; PII — по allowlist.

## 8.7. Контракты API

Имена ниже — проектные, не документация уже работающего API. Identity: start/verify login, SSO authorize/token, profile, sessions, roles/permissions, access check. Notifications: inbox, mark-read, preferences, protected retry. Payments: catalog, orders, checkout, own subscriptions, cancel, own history; webhook receiver; internal grants и reconciliation. Admin: search/read views и typed commands.

OpenAPI/backend DTO → typed clients/fixtures. Error envelope: code, messageKey, fieldErrors, requestId; локализованное UI-сообщение не строится из stack trace. Pagination с max size. Idempotency key scope включает user/action; ключи не являются обходом авторизации. Совместимые additive изменения preferred; breaking version обсуждается до deploy.

## 8.8. Redis

Redis обслуживает sessions/rate limits/короткие locks/cache, но не единственную копию денег и grants. В текущей конфигурации maxmemory почти равен memory limit при AOF — оставить запас на overhead и fork/перезапись. Политика noeviction для критичных session keys сопровождается alert и обработкой write failure; cache keys не должны бесконтрольно заполнять тот же экземпляр.

Потеря Redis не должна выдавать чужой доступ. Допустима принудительная повторная авторизация после восстановления; незавершённые денежные операции восстанавливаются из PostgreSQL/provider, не из Redis. Вначале один экземпляр с namespaces/TTL и ресурсными лимитами; отдельный cache Redis только при доказанной потребности и в том же VPS.

## 8.9. Приёмка

Пустая среда создаётся с нуля; migrations повторяемы и сериализованы; schema drift обнаруживается; unique constraints ловят конкуренцию; broker down не теряет committed события; replay не удваивает effect; poison message уходит в quarantine; Redis restart не повреждает платежи; чужая DB недоступна runtime role; graceful shutdown завершает/возвращает in-flight работу.
