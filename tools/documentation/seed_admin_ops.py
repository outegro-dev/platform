from seed_task_details import t

t('A-01','ID-07 DS-05 BE-04', 'Admin UI не даёт полномочий само по себе; BFF и domain backend проверяют permission независимо.',
'Создать admin-backend BFF и admin-web shell с central SSO § Проверять admin access/step-up на server boundary § Подключить permission-aware navigation и forbidden/expired states § Запретить передачу произвольного actorId из browser payload',[
'Anonymous | Нет сессии | Открыть admin route/API | Login/401 без private response',
'Обычный user | Valid user session без permission | Вызвать admin API напрямую | 403 независимо от скрытой кнопки',
'Actor spoof | Operator передаёт actorId владельца | Выполнить command | Actor определяется session/delegation, подмена отклонена'])
t('A-02','A-01 ID-09', 'Оператору нужны user search и допустимые команды, без чтения секретов и ложного empty при отказе сервиса.',
'Создать paginated search и агрегированную карточку с redaction по permission § Подключить профиль/сессии/роли/доступы как независимые секции § Добавить revoke/suspend через Identity command с reason § Показывать partial/stale и время последнего успешного чтения',[
'PII | Support без расширенного PII permission | Открыть карточку | Чувствительные поля маскированы, tokens/codes отсутствуют',
'Частичный сбой | Payments down, Identity up | Открыть user | Профиль доступен, billing показывает unavailable, не zero purchases',
'Suspend | Разрешённая команда с reason | Заблокировать user | Identity применяет блокировку, subscription автоматически не отменяется'])
t('A-03','A-01 PAY-11 DS-04', 'Финансовый экран показывает достоверные суммы и историю по валютам; это не merchant available balance.',
'Сделать orders/subscriptions/journal tables с server filtering/pagination § Добавить detail links к provider IDs и source grants § Показать paid/refunded/disputed totals отдельно по currency § Развести permission billing.read и financial mutation, wallet UI скрыть',[
'Валюты | USD и EUR операции | Показать totals | Две отдельные суммы, отсутствует бессмысленный общий баланс',
'Фильтры | Несколько страниц операций | Изменить status/date/cursor | Нет дублей/пропусков при документированной сортировке',
'Read-only | Auditor | Открыть screen и вызвать mutation | Читать можно в scope, mutate запрещено'])
t('A-04','A-01 PAY-10 BE-06 N-06 ID-08', 'Диагностика должна связывать финансовый факт, grant и доставку без прямых cross-DB запросов.',
'Создать admin read projections и correlation lookup через events/domain APIs § Построить timeline order/payment/grant/delivery с occurred/received times § Добавить reconciliation issue details/evidence и authorized resolution choices § Отмечать source freshness и недоступные downstream',[
'Цепочка | Оплата с notification и grant | Найти по orderId/correlationId | Все связанные IDs доступны, порядок времени объясним',
'Lag | Payment есть, grant projection задержана | Открыть timeline | Видно место задержки, не предлагается произвольный role=pro',
'Unmatched | Refund без покупки | Открыть issue | Нет угадывания source; доступен evidence-based workflow'])
t('A-05','A-04 N-03', 'Replay меняет доставку, но не должен повторять деньги. Каждая batch операция ограничена и возобновляема.',
'Создать preview endpoint с фильтром/count/разрешёнными типами § Execute принимает preview/version, commandId, reason и актуальное permission § Worker сохраняет cursor/results и использует исходные event IDs § Запретить auth-code replay и произвольный provider financial POST',[
'Preview | 100 matched events, лимит 20 | Выполнить dry-run | Показаны scope/count/limit, изменений нет',
'Повтор job | Частично выполненный replay job | Restart/submit тот же commandId | Продолжается тот же job, payment/grant effect не дублируется',
'Запрет | Auth-code delivery либо неподдержанный event | Запросить replay | Backend отказывает до запуска'])
t('A-06','A-01 ID-06 ID-07 PAY-02', 'Роли, каталоги и flags управляются командами владельца данных, с version check.',
'Подключить role assignment и fixed permission catalog § Добавить service registry/maintenance/checkout flag и immutable price version editing § Требовать reason/expectedVersion/step-up по sensitivity § Блокировать снятие последнего owner и изменение прошлых цен',[
'Last owner | Один owner | Снять роль из admin | Domain backend отказывает, UI показывает причину',
'Version | Два оператора редактируют flag v1 | Сохранить оба | Один update, второй conflict с refresh',
'Checkout pause | payments_enabled=false | Создать checkout и принять старый webhook | Новый checkout запрещён, webhook всё ещё принимается'])
t('A-07','A-02 A-03 A-04 A-05 A-06', 'Успешное изменение и его audit должны сохраняться вместе; central view лишь проекция.',
'Проверить atomic audit всех admin domain mutations § Создать audit search/detail с redacted before/after и actor/reason/result § Добавить negative/step-up/PII matrix и protection от HTML в заметках § Сохранить acceptance report по всем ролям и чувствительным командам',[
'Atomicity | Domain mutation, audit write failure | Выполнить command | Либо оба commit, либо mutation не выполнена',
'Projection down | Central admin projection недоступна | Выполнить разрешённую mutation | Domain audit не потерян и приходит после восстановления',
'Redaction | Секретоподобный input/HTML note | Просмотреть audit | Нет tokens/raw credentials и исполняемого HTML',
'Denied | Auditor вызывает revoke/refund | Отправить напрямую | Denied recorded как отказ, успешного side effect нет'])

t('OPS-01','L-10 BOOT-02', 'Готовим новую single-node среду, не изменяя действующий сервер старого проекта.',
'Зафиксировать provider/VPS идентификатор, доступную RAM/disk, DNS ownership и expected SSH fingerprint § Подготовить bootstrap ОС/K3s, namespaces, firewall/SSH и TLS issuer § Проверить выбранные версии контроллеров и GitOps non-HA профиль § Сначала отрепетировать в изолированной среде; production команды выполнять только в авторизованном deployment контексте',[
'Target | Два разных environment identifiers | Проверить bootstrap target guard | Legacy VPS отвергается, новый target явно указан',
'Порты | Bootstrap в test environment | Проверить внешний scan разрешённых портов | DB/Redis/AMQP не публичны, SSH/HTTPS по политике',
'TLS | Test DNS/issuer готовы | Получить сертификат и открыть host | Правильный hostname/chain; failure issuer не маскируется'],['VPS-DNS'])
t('OPS-02','OPS-01 BE-07', 'Данные живут на persistent storage одного узла, credentials разделены по сервисам.',
'Развернуть PG/CNPG instance=1, Redis и RabbitMQ с PVC § Применить runtime/migration roles, connection pool budgets, resource requests/limits § Настроить Redis memory headroom/TTL и broker durable topology § Проверить storage persistence и network policy реальными запросами',[
'Restart | В каждой системе есть test record/message/key | Перезапустить pods | Требуемые durable данные сохранились',
'Изоляция | Auth pod и чужая DB | Попытаться соединиться/прочитать | Network/DB policy блокирует неразрешённый доступ',
'Memory | AOF rewrite и broker backlog в тесте | Наблюдать peaks | Запас памяти измерен; noeviction failures обрабатываются'])
t('OPS-03','OPS-02 BE-07', 'Shared chart должен запускать Drizzle migration ровно контролируемым job, не на каждом app start.',
'Перенести один reviewed shared Helm chart и values для новых сервисов § Заменить Prisma hook на release-specific migration Job с lock/deadline § Настроить immutable image digests, sync ordering и readiness gates § Проверить render/diff и failure rollout до фактического production sync',[
'Migration failure | Migration завершилась nonzero | Запустить test rollout | Зависимый app rollout не открыт как ready',
'Resync | Та же release revision уже применена | Выполнить sync повторно | Нет повторной destructive migration',
'Images | Production values | Проверить manifests | Нет mutable latest; source commit/digest прослеживается'])
t('OPS-04','BE-04 OPS-01', 'Metrics/logs/correlation нужны для диагностики доменной цепочки, а не для сбора всех персональных payload.',
'Инструментировать request/event/command correlation в сервисах § Развернуть ограниченные Prometheus/Grafana/Alertmanager/Loki/Alloy § Установить retention/cardinality/redaction limits § Проверить связывание метрик и логов без userId labels высокой cardinality',[
'Correlation | Checkout fixture проходит несколько сервисов | Найти по correlationId | Видны этапы, source IDs и latency без raw secrets',
'PII | Запрос с Authorization/login code | Inspect captured logs | Секреты редактированы, access labels не содержат PII',
'Retention | Тестовый поток логов | Проверить policy/disk growth | Установлен limit, нет бесконечного накопления'])
t('OPS-05','OPS-04', 'Операционные alerts не должны зависеть от сломанного Notifications или модели Hermes.',
'Создать dashboards queue age/DLQ/grant lag/webhook age/backup freshness/node pressure § Добавить thresholds, duration и runbook link для actionable alerts § Настроить отдельный канал и внешний uptime-check § Инъецировать по одному сбою и проверить firing/resolved с понятным context',[
'Broker down | Остановить broker в test environment | Дождаться порога | Alert с runbook приходит через независимый канал',
'Host loss | Внешний checker теряет test endpoint | Проверить уведомление | Сбой обнаружен вне этого VPS',
'Recovery | Восстановить зависимость | Дождаться resolved | Alert закрывается без бесконечного спама'],['OPS-ALERTS'])
t('OPS-06','OPS-02', 'Backup на том же диске не защищает от потери VPS. Нужны данные и ключи восстановления.',
'Настроить PG base backup/WAL во внешний private bucket § Определить consistent K3s SQLite/token и key backups отдельно от PG § Задать retention/encryption/freshness и отдельные restore credentials § Сохранить runbook и провести test download/decrypt/list без публикации secrets',[
'Внешняя копия | Backup completed | Проверить objects вне VPS и read restore credential | Копия доступна для восстановления, не только локальный log success',
'WAL | Создать test transaction после base backup | Проверить archive progress | WAL до тестовой точки доступен',
'Failure | Bucket недоступен | Запустить backup | Failure/freshness alert видим, старая копия не удалена'],['BACKUP-STORAGE'])
t('OPS-07','OPS-06 PAY-10 OPS-03', 'Рабочий backup подтверждает только rehearsal восстановления с доменными проверками.',
'Подготовить изолированную restore target без production webhook/notifications egress § Восстановить PG/K3s keys/config/images по runbook § Сверить external payment facts и local grants/journal после выбранной точки § Измерить RPO/RTO, проверить пользовательский вход и document deviations',[
'Restore | Fixture dataset и offsite backup | Восстановить в чистую среду | Счётчики/контрольные записи/constraints совпадают',
'PITR | Provider payment после backup point | Выполнить reconciliation | Внешний факт восстановлен без нового списания',
'Safety | Restore env с historic notifications | Запустить workers в safe mode | Старые сообщения не разосланы настоящим пользователям',
'Цели | Timer и latest recoverable transaction | Измерить | RPO/RTO подтверждены либо записано конкретное отклонение'])
t('OPS-08','OPS-03 OPS-05 OPS-07 ID-10 N-06 PAY-11 A-07 H-11', 'Budget 6748 MiB — гипотеза. Нужен full-stack тест до production readiness, включая Hermes.',
'Развернуть все обязательные сервисы на согласованном 8-GB профиле § Измерить idle, steady, bursts, rollout, backlog drain и один Hermes vision job § Проверить CPU/RAM/disk/connection peaks и отсутствие starvation identity/payments § Подобрать limits/concurrency; при нехватке зафиксировать vertical upgrade, не добавить второй узел',[
'Нагрузка | Весь P0 stack и контролируемые request/event rates | Провести baseline/peak прогон | Нет OOM и необъяснённых failures, запас измерен',
'Agent pressure | Hermes достигает своего лимита | Проверить core latency/health | Core сервисы сохраняют приоритет, agent bounded/paused',
'Rollout | App old/new overlap | Выполнить test update | Есть запас или документирован Recreate window, node не падает'])
