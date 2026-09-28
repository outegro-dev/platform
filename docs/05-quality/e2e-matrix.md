# Сквозные сценарии первого выпуска

| ID | Дано | Шаги | Проверяемый результат |
|---|---|---|---|
| E2E-01 | Новый ru browser | Открыть /, переключить RU, reload | Первый визит EN, явный RU стабилен |
| E2E-02 | Вход из pay | Redirect id, login, callback | Правильный return, host-only session pay |
| E2E-03 | Logged-in user | Сменить locale, открыть другой сервис, получить email fixture | Явный locale применяется в UI/уведомлении |
| E2E-04 | Тестовый товар и подтверждённый provider scenario | Checkout, confirmed event, access check | Payment/journal/grant/notification связаны |
| E2E-05 | Успешная покупка | Replay same webhook 10 раз | Один денежный effect и source grant |
| E2E-06 | Pending payment | Открыть success return URL | Доступ не выдан без подтверждения |
| E2E-07 | Подписка | First payment, renewal duplicate, cancel, expiry | Нет лишнего периода, paidUntil сохраняется после cancel |
| E2E-08 | Оператор | Найти order и пройти timeline | Видны provider event/grant/delivery и freshness |
| E2E-09 | Auditor | Вызвать mutation напрямую | Backend запрещает действие |
| E2E-10 | Broker/email down | Принять payment, восстановить transport | Деньги сохранены; события/доставка догоняют |
| E2E-11 | Пользователь с valid JWT | Suspend/revoke, выполнить sensitive command | Старый token не сохраняет чувствительный доступ |
| E2E-12 | Backup до внешнего события | Restore isolated, reconcile | Нет повторного списания/массового notification resend |
| E2E-13 | Owner в item topic | Отправить album, уточнить price, restart | Одна карточка с media и данными, ответ в правильной теме |
| E2E-14 | Hermes quota exhausted | Отправить фото | Durable draft, analysis_pending, zero paid fallback calls |

Для каждого сценария сохранить preconditions, шаги, реальные IDs fixtures, assertions и environment. E2E-04/07 real-provider и fake modes отмечаются отдельно. Нельзя объявить все 14 pass по одному успешному health endpoint.
