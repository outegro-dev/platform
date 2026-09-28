# Глава 14. Атомарный план работ и зависимости

## 14.1. Формат задачи

ID связан с главой; один ожидаемый результат; входные зависимости; артефакт; критерий готовности; риск/rollback. Задачи рассчитаны на отдельный проверяемый PR или небольшой набор последовательных PR. Если задача не укладывается примерно в 0,5–2 дня, разбить её по сценарию, а не по случайным файлам. Таблицы ниже — backlog, все позиции пока planned, не completed.

## 14.2. Этап A. Лендинг и дизайн-система

| ID | Задача | Зависит от | Готово, когда |
|---|---|---|---|
| L-01 | Зафиксировать brief и карту секций | D-01…D-13 | Нет старого домена/кейса/анонимного требования |
| L-02 | Составить EN/RU content skeleton | L-01 | Имя/роль/компетенции/заглушка/контакт определены |
| DS-01 | Выбрать типографику и semantic tokens | L-01 | Обе письменности и contrast samples проверены |
| L-03 | Сгенерировать/подготовить визуальные варианты hero | DS-01 | Отдельные читаемые desktop/mobile-макеты |
| L-04 | Реализовать R3F silver prototype | L-03 | Рабочая сцена с pause/static fallback |
| L-05 | Измерить профили качества | L-04, устройства | Сохранены frame metrics и решение по эффектам |
| DS-02 | Button/Link/FormField/Input/focus | DS-01 | States и keyboard готовы в gallery |
| DS-03 | Dialog/Menu/LocaleSwitch/feedback | DS-02 | Focus lifecycle и EN/RU готовы |
| DS-04 | Table/filters/status/timeline/amount | DS-02 | Длинные IDs и суммы не ломают layout |
| DS-05 | Сборка shell id/pay/admin | DS-03, DS-04 | Макеты используют общие компоненты |
| L-06 | Настроить EN-default routing/messages | L-02 | Первый визит EN, явный RU стабилен |
| L-07 | Реализовать hero/header | L-05, L-06 | Текст доступен до WebGL |
| L-08 | Реализовать expertise/approach/projects | L-02, DS-02 | Нет фиктивных кейсов и метрик |
| L-09 | Footer/contact/metadata | L-06, контакты | Реальные ссылки, canonical/hreflang |
| L-10 | Mobile/a11y/performance acceptance | L-07…09 | Gate A и отчёт preview готовы |

Работа по требованиям image-to-code выполняется на этом будущем этапе: дизайн-изображения → анализ → реализация. Настоящий план не выдаёт описание серебряной сцены за готовый визуальный макет.

## 14.3. Этап B1. Основа backend и данные

| ID | Задача | Зависит от | Готово, когда |
|---|---|---|---|
| BE-01 | Матрица Node/Nest/AMQP/Drizzle | Gate A | Минимальные приложения build/run/test |
| BE-02 | Решить RabbitMQ adapter compatibility | BE-01 | Confirms, ack/reconnect/shutdown проверены |
| BE-03 | Схемы новых DB + migrations | BE-01 | Пустая PG создаётся с нуля |
| BE-04 | Контракты ошибок/events/IDs | BE-01 | Typed contracts и fixtures согласованы |
| BE-05 | Outbox relay с lease и confirms | BE-02…04 | Crash/retry не теряет committed event |
| BE-06 | Consumer inbox/idempotency/retry | BE-05 | Duplicate и poison fixtures пройдены |
| BE-07 | Runtime/migration DB roles | BE-03 | Чужая БД и DDL runtime запрещены |

## 14.4. Этап B2. Identity и доступы

| ID | Задача | Зависит от | Готово, когда |
|---|---|---|---|
| ID-01 | Email-code lifecycle на Drizzle | BE-03, BE-04 | Expiry/reuse/rate limits пройдены |
| ID-02 | Google/linking + account ownership | ID-01 | Нет захвата по совпавшему непроверенному email |
| ID-03 | Sessions/refresh concurrency | ID-01 | Two tabs/lost response/reuse различаются |
| ID-04 | SSO client/code/PKCE/BFF | ID-03 | Cross-app позитивные/негативные сценарии |
| ID-05 | Passkeys и RP id.outegro.dev | ID-04 | Register/login/delete/recovery policy |
| ID-06 | Roles/permissions/bindings | BE-03, BE-04 | Backend deny-by-default и scoped checks |
| ID-07 | Owner bootstrap и step-up | ID-05, ID-06 | Last owner/recovery проверены |
| ID-08 | Коммерческая grant projection | BE-06, PAY-06 | Версии, expiry и source grants корректны |
| ID-09 | Кабинет/сессии/locale | DS-05, ID-03…07 | EN/RU реальные API, не fixtures |
| ID-10 | Key rotation/revoke/CSRF tests | ID-04…08 | Отзыв и overlap JWKS проходят |

## 14.5. Этап B3. Notifications

| ID | Задача | Зависит от | Готово, когда |
|---|---|---|---|
| N-01 | Intent/delivery/inbox/preferences schema | BE-03, BE-04 | Уникальность и ownership проверены |
| N-02 | Email и auth-code priority path | N-01, ID-01 | Секрет не попадает в общие logs/events |
| N-03 | Delivery claim/retry/DLQ | N-02, BE-06 | Crash после send описан и протестирован |
| N-04 | Telegram link/channel | ID-09, N-01 | Одноразовая привязка и unlink действуют |
| N-05 | Inbox/settings UI | DS-05, N-01 | Read/unread только владельца |
| N-06 | Billing/security templates EN/RU | N-02, BE-04 | Locale и safe deep links проверены |

## 14.6. Этап B4. Payments и подписки

| ID | Задача | Зависит от | Готово, когда |
|---|---|---|---|
| PAY-01 | Provider contract fixture suite | Lava OpenAPI | Два webhook format и mapping проверены |
| PAY-02 | Catalog/price/order/payment schema | BE-03, PAY-01 | Денежные constraints и snapshots готовы |
| PAY-03 | Idempotent checkout state machine | PAY-02, ID-04 | Repeat/timeout/unknown корректны |
| PAY-04 | Durable authenticated webhook inbox | PAY-01, BE-06 | Invalid secret, duplicate, unknown covered |
| PAY-05 | Payment processing/journal/outbox | PAY-02, PAY-04 | Одна оплата даёт один effect |
| PAY-06 | Source grants и expiry | PAY-05 | Несколько оснований права не конфликтуют |
| PAY-07 | Subscription root/renew/period model | PAY-05, PAY-06 | Repeat не продлевает дважды |
| PAY-08 | Cancel workflow и paid-until UX | PAY-07 | Отмена отдельно от возврата |
| PAY-09 | Refund/dispute inbox и unmatched | PAY-04, PAY-05 | Неоднозначная покупка не угадывается |
| PAY-10 | Reconciliation jobs/issues | PAY-07…09 | Pagination, overlap, resume безопасны |
| PAY-11 | Pay web/история/подписки | DS-05, PAY-03…08 | Все состояния через реальные API |
| PAY-12 | Provider account integration test | Merchant/test mode | Свидетельство реального contract validation |

Wallet, если выбран, получает отдельные задачи W-01 ledger schema; W-02 top-up; W-03 reserve/capture/release; W-04 refund/debt; W-05 wallet UI/admin; W-06 concurrency/reconcile. Он зависит от PAY-05/09/10 и не заменяется колонкой balance.

## 14.7. Этап B5. Админка

| ID | Задача | Зависит от | Готово, когда |
|---|---|---|---|
| A-01 | Admin auth/shell/permissions | ID-07, DS-05 | Unauthorized/forbidden на backend |
| A-02 | User search/profile/session actions | A-01, ID-09 | Partial data и redaction корректны |
| A-03 | Orders/subscriptions/journal screens | A-01, PAY-11 | Фильтры/валюты/ссылки проверены |
| A-04 | Event chain и reconciliation issues | PAY-10, BE-06 | Payment→grant→delivery прослеживается |
| A-05 | Controlled retry/replay commands | A-04, N-03 | Dry-run/reason/jobId/audit работают |
| A-06 | Role/flag/catalog management minimum | ID-06, PAY-02 | Версии и last-owner safeguards |
| A-07 | Audit view и sensitive actions | A-02…06 | Actor/result/evidence не теряются |

## 14.8. Этап B6. Инфраструктура и observability

| ID | Задача | Зависит от | Готово, когда |
|---|---|---|---|
| OPS-01 | Чистый bootstrap и DNS/TLS | VPS/domain access | Повторяемая инструкция и закрытые порты |
| OPS-02 | PG/Redis/Rabbit PVC/roles/limits | OPS-01, BE-03 | Данные переживают restart |
| OPS-03 | GitOps chart/migration job | OPS-02, BE-07 | Drizzle job сериализован, Prisma удалён |
| OPS-04 | Метрики/логи/correlation | BE-04, OPS-01 | Request/event chain виден |
| OPS-05 | Dashboards/alerts/runbooks | OPS-04 | Искусственный сбой обнаружен |
| OPS-06 | Backup/WAL/secret recovery | OPS-02 | Копии вне VPS и freshness alert |
| OPS-07 | Restore rehearsal | OPS-06, PAY-10 | Восстановление и сверка прошли |
| OPS-08 | Ресурсный профиль 8 ГБ | Все обязательные сервисы | Working set/peaks/disk с запасом |

Задачи Hermes H-01…H-11 подробно перечислены в главе 11 и входят в этап B до R-03. Их зависимости включают Drizzle, private storage, owner OAuth и observability.

## 14.9. Этап C. Объединение и production

| ID | Задача | Зависит от | Готово, когда |
|---|---|---|---|
| R-01 | Интеграция landing/service navigation | Gate A, ID-09, PAY-11 | Единый UX и locale |
| R-02 | E2E матрица и failure scenarios | ID/N/PAY/A/H + OPS | Глава 12 пройдена с evidence |
| R-03 | Production readiness review | R-02, OPS-07/08 | Нет блокеров, open risks явны |
| R-04 | Deploy immutable release | R-03 | Smoke/alerts/owner доступ работают |
| R-05 | Post-release review/runbooks | R-04 | Зафиксированы baseline и остаточные задачи |
| NEXT-01 | Отдельное ТЗ Battleship | R-05 | Новый scope, без домыслов в текущем плане |

## 14.10. Зависимости и критический путь

Лендинг/DS заканчиваются первыми. Далее backend contracts/data предшествуют предметным сервисам; roles нужны admin; payments grants нужны identity projection; notification contracts можно реализовывать на fixtures до готовности Payments. Для устранения цикла PAY-06 и ID-08 сначала фиксируется event schema, затем каждая сторона реализуется независимо и объединяется интеграционным тестом.

K3s manifests и observability подготавливаются в инфраструктурном этапе, но окончательный ресурсный тест требует всех P0-сервисов. Game не входит в critical path. Отсутствие merchant/test credentials блокирует проверку реального провайдера, но не разработку остальных глав. Отсутствие контактов блокирует финальный публичный Contact, но не DS/hero.

## 14.11. Предварительная трудоёмкость

Оценка для одного опытного разработчика с полной занятостью, с повторным использованием полезного кода. Это не календарное обещание, не обязательный срок и не стоимость услуг.

| Пакет работ | Рабочие дни |
|---|---:|
| Лендинг, DS, 3D prototype, EN/RU | 12–20 |
| Backend compatibility, Drizzle, contracts/events | 5–8 |
| Identity/SSO/RBAC | 8–13 |
| Notifications/inbox | 4–7 |
| Payments/subscriptions/reconciliation | 9–15 |
| Admin minimum | 7–12 |
| K3s/observability/backup | 5–8 |
| Hermes/Telegram topics/каталог вещей MVP | 8–13 |
| Общая интеграция, release и проверка | 4–7 |
| Итого | 62–103 |
| С резервом около 20% | 75–124 |

Диапазон включает минимальную рабочую админку и роли, поэтому прежняя оценка 0.1 больше не актуальна. Wallet при включении ориентировочно добавит 8–15 рабочих дней до резерва, после уточнения сценария. Сложная фотореалистичная деформация, отсутствие sandbox, новое SSO library решение или дополнительные admin workflows могут увеличить оценку. Внешние ожидания, покупка VPS, merchant approval и Battleship не включены.

## 14.12. Definition of Done задачи

Код/конфигурация reviewed; контракт и ошибки описаны; meaningful checks пройдены; EN/RU для видимого UI; telemetry для бизнес-сценария; миграция/rollback учтены; docs/runbook обновлены. Для финансов/identity обязательны негативные и конкурентные сценарии. Для простого изменения текста не писать искусственный unit test, повторяющий этот текст.
