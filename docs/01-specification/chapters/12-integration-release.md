# Глава 12. Объединение лендинга и платформы, первый production

> Версия 0.3: детальные действия, зависимости и test cases находятся в [карточках задач](../../04-delivery/README.md). Эта глава задаёт предметный контекст.

## 12.1. Порядок, выбранный владельцем

1. Сделать лендинг и дизайн-систему в preview.
2. Обновить и реализовать identity, notifications, payments/subscriptions, admin minimum, Hermes с Telegram topics и каталогом, data/queues/observability и K3s manifests.
3. Объединить фронты с реальными API, единым входом и общей DS.
4. Развернуть всё на новом VPS/K3s и пройти release-проверки.
5. После работающего production вернуться к отдельному ТЗ Battleship.

Лендинг не публикуется заранее на урезанной инфраструктуре. Это сознательно увеличивает срок до первого публичного результата по сравнению с отдельным статическим сайтом.

## 12.2. Интеграционные сценарии

| ID | Сценарий | Ожидаемый результат |
|---|---|---|
| E2E-01 | Первый визит с русским языком браузера | Главная EN; ручной RU работает |
| E2E-02 | Вход из pay → id → pay | Верный return, отдельная host-only сессия |
| E2E-03 | Смена языка в аккаунте | Следующий сервис и уведомление используют явное предпочтение |
| E2E-04 | Проверенная покупка тестового продукта | Payment, journal, grant, notification связаны |
| E2E-05 | Повтор того же webhook | Финансовый результат и grant не дублируются |
| E2E-06 | Return success без подтверждения | Доступ не выдаётся, виден pending |
| E2E-07 | Подписка/renewal/cancel/expiry | Оплаченный срок отображается и соблюдается |
| E2E-08 | Админ просматривает цепочку | Находит событие, попытку доставки и audit |
| E2E-09 | Недостаточная admin permission | Команда отклонена на backend |
| E2E-10 | Broker/email временно недоступны | Бизнес-состояние сохранено, события доставятся после восстановления |
| E2E-11 | Отзыв сессии/блокировка | Следующее чувствительное действие запрещено |
| E2E-12 | Restore + reconcile | Система восстановлена без повторных денег/уведомлений |
| E2E-13 | Фото в нужной Telegram-теме | Вещь сохранена один раз, ответ в той же теме |
| E2E-14 | Hermes quota exhausted | Фото/задача сохранены; платный fallback не включён |

Provider fixtures проверяют приложение, но не доказывают работу реального merchant. В отчёте явно разделять local tests, provider contract validation и реальную контрольную операцию. Не делать реальные charge/refund автоматически из CI.

## 12.3. Gate A: лендинг готов к объединению

Утверждён визуальный вариант; EN/RU завершены; проекты честно обозначены заглушкой; контакты настоящие; layout проверен; сцена имеет measured profile/static fallback; DS-компоненты используются во всех обязательных shell-макетах. Не публикуется текст о текущем outegro.com.

## 12.4. Gate B: сервисы готовы

Новые DB схемы и seeds; Nest/AMQP/Drizzle compatibility; identity/SSO и роли; notification delivery/inbox; payments/subscriptions/grants/reconciliation; admin read+безопасные команды; audit; provider uncertainties явно закрыты либо соответствующая операция выключена. Нет интерфейса «кнопка есть, backend когда-нибудь будет».

Дополнение к Gate B для Hermes: owner/chat/topic routing, сохранение фото и карточек, versioned rules, отсутствие платного fallback и проверка quota stop; публикация только в доступный боту destination. Обязательное требование владельца — готовность Hermes до Battleship; включение его уже в первый общий production является предложенной организацией этапов этого плана.

## 12.5. Gate C: инфраструктура готова

Один VPS, DNS/TLS, новые secrets, persistent data, backup, operational alerts, resource profile, GitOps pipeline, migration safety, recovery test. Полный restore можно отрепетировать локально до deploy, но среда и команды должны соответствовать выбранным версиям; production backup проверяется отдельно после появления данных.

## 12.6. Gate D: публикация

Deploy immutable release, smoke public/private routes, проверить EN/RU/canonical/noindex, signup/login/logout, health/metrics, webhook endpoint и rate limits, worker progress, owner access, operational alert channel. Продажи открываются отдельным feature flag после merchant/товара/provider validation. Если каталог пока пустой, платформа остаётся готовой к подключению продукта, но публично не обещает работающую продажу несуществующего тарифа.

## 12.7. Откат

Frontend/backend image rollback возможен только при совместимой DB-схеме. Financial event history не удаляется для «возврата к прошлой версии». При сбое Payments — запретить новые checkout, продолжить безопасное durable получение webhook, восстановить processing и reconcile. Если сбой связан с schema, forward-fix часто безопаснее отката данных. DNS rollback не переносит аккаунты обратно на старую систему: системы независимы.

## 12.8. После релиза

Наблюдать ошибки, latency, memory, дисковый рост, provider events и качество 3D на реальных устройствах; устранить launch issues; сохранить release report и актуальные runbooks. Только после выполнения критериев готовности начинается детализация игры. Предложение по периоду усиленного наблюдения — первые 3–5 рабочих дней, без обещания круглосуточного дежурства одного человека.
