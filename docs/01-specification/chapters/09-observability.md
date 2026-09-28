# Глава 9. Observability и операционная готовность

> Версия 0.3: детальные действия, зависимости и test cases находятся в [карточках задач](../../04-delivery/README.md). Эта глава задаёт предметный контекст.

## 9.1. Что система должна объяснять

Работает ли публичный сайт; может ли человек войти; принимаются ли webhook; сколько времени активируется доступ; почему не пришло письмо; хватает ли памяти/диска; свежие ли backup; какие финансовые события требуют разбора. Наличие Grafana само по себе не означает наблюдаемость — каждый важный сценарий получает метрику, лог, alert и runbook.

## 9.2. Базовый стек

Сохраняем знакомый подход: Prometheus + Grafana + Alertmanager; Loki в single-binary режиме + Alloy для логов; структурные Pino JSON-логи; OpenTelemetry context/instrumentation в HTTP/AMQP/DB/provider adapter. Операторские dashboards доступны только защищённым пользователям.

Постоянное хранилище всех traces не обязательно на первом 8-ГБ VPS: в P0 correlation/traceId сохраняются в логах, error traces можно отправлять в ограниченный collector/exporter. Если нужен самостоятельный Tempo, его память/диск выделяются и проверяются отдельным spike; нельзя считать этот pod бесплатным. Минимум метрик, логов и alerting входит в первый production, а не откладывается «когда сломается».

## 9.3. Дашборды

| Dashboard | Сигналы | Решение оператора |
|---|---|---|
| VPS/K3s | CPU, MemAvailable, disk/inodes, pressure, restart/OOM | Освободить ресурсы/откатить/вертикально увеличить |
| Ingress/landing | Availability probe, latency, 4xx/5xx, TLS expiry | Проверить маршрут/релиз/certificate |
| Identity | Login success/failure, code latency, refresh reuse, session store errors | Различить provider сбой и аномалию входа |
| Payments | Checkout unknown, webhook auth/schema errors, pending age | Приостановить новые checkout и начать reconcile |
| Subscriptions/grants | Renewal failures, expired processing, projection lag | Проверить доступ и provider status |
| Notifications | Queue age, provider latency, retries/DLQ | Переключить режим/повторить допустимую доставку |
| PostgreSQL | Connections, slow queries, locks, WAL archive age, storage | Устранить транзакцию/расширить диск/восстановить backup |
| RabbitMQ/Redis | Depth/oldest age, confirms, disk/memory alarm; memory/evictions/errors | Остановить перегрузку и сохранить данные |

## 9.4. Метрики и cardinality

HTTP latency/error labels — service, route template, method, status class. Нельзя userId/orderId/email/traceId как Prometheus label. RequestId и entity IDs остаются в редактируемых логах с ограниченным доступом. Метрики provider webhook типизируются по ограниченному enum, а неизвестные не порождают бесконечные series.

Доменные counters отделены от transport: HTTP 200 webhook означает durable acceptance, а не автоматически processed payment. Отдельные gauges old-unprocessed-events, unmatched-count, grant-lag, reconciliation-last-success. Суммы по валютам не складываются между валютами. Расхождения — не только dashboard, но и очередь работы в admin.

## 9.5. Alerting

Проектные стартовые пороги, подлежащие настройке после baseline: disk free <20% warning/<10% critical; memory pressure/OOM — critical; restart loop; webhook/provider-inbox processing age >5 минут; auth mail queue age больше срока полезности кода; DLQ ненулевая и растущая; backup/WAL freshness вышла за RPO; TLS expiry <14 дней; reconciliation не выполнялась дольше своего интервала с запасом.

Alerts имеют severity, service, короткое описание последствий, dashboard и runbook URL. Dedup/grouping и cooldown защищают от спама. При сбое уведомительного сервиса операционные alerts идут напрямую из Alertmanager в отдельный канал, а не через сломанный Notifications.

Мониторинг внутри того же VPS не сможет сообщить о полном исчезновении этого VPS. Нужен внешний uptime-check managed/free сервиса или иной внешний наблюдатель; это не второй VPS K3s. Провайдер/канал и контакт владельца уточняются перед запуском. До настройки полного внешнего контроля нельзя обещать своевременное обнаружение полной аварии.

## 9.6. Retention и бюджет

Стартовые ориентиры: Prometheus 7 дней плюс size cap; Loki 7 дней с объёмным лимитом и compaction; raw provider payload 30 дней в защищённом хранилище как проектный operational default, затем минимизированное представление; audit/financial retention определяется отдельно. Не включать debug logs постоянно. Размеры PVC, количество targets и scrape interval выбираются по измеренному расходу; collector не дублирует каждый лог в несколько локальных хранилищ.

## 9.7. Сервисные цели

До load test это цели, не SLA: внутренний обычный read API p95 до 300 мс без внешнего провайдера; durable webhook acceptance p95 до 500 мс; payment→grant projection обычно до 5 секунд, отдельный alert при существенном превышении; полезное login-письмо должно приходить в пределах TTL. Нагрузочный профиль до релиза задаётся synthetic: число одновременных пользователей, QPS, доли маршрутов, размеры данных и duration. Нельзя выводить capacity по одному idle-снимку.

## 9.8. Runbooks

Обязательные: недоступен PostgreSQL; нет места; Redis memory/full/restart; broker alarm/DLQ; не приходят email-коды; webhook accepted, access missing; provider timeout; неуспешный rollout; компрометация signing key; restore с потерей VPS; домен/TLS недоступен. Каждый содержит проверку симптома, безопасное временное действие, диагностику, восстановление, проверку результата и журнал решения.

## 9.9. Приёмка

Проверить искусственный сбой в локальной/preview среде: alert приходит, ссылка ведёт к полезным данным, оператор находит request/event chain, в логах нет секретов. Проверить выключенный Notifications при сохранённом operational alert channel. Замерить overhead observability на 8-ГБ профиле; если бюджет не проходит, уменьшать retention/cardinality/targets до сохранения необходимых сигналов.
