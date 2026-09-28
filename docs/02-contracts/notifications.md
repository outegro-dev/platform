# Notifications contract

NotificationIntent уникален по sourceEventId/template/recipient; Delivery по intent/channel. Inbox readAt независим от внешней доставки. Проектные состояния delivery: pending, leased, accepted, delivered при подтверждении провайдера, retry_wait, failed, expired, unknown. `accepted` нельзя переводить словом «прочитано».

Категории: auth, security, billing, service. Marketing выключен. Язык берётся из явного login locale либо профиля, fallback EN. Необязательный Telegram/email проверяет preferences и текущую channel binding непосредственно перед send. Unlink отменяет будущую отправку по удалённой связи.

Auth code не идёт в общую domain topic. N-02 выбирает короткий приватный delivery transport и фиксирует ACL/TTL/очистку. Если выбран encrypted payload, ключи раздельные и доступ только получателя; base64 не шифрование. Auth-code delivery после expiresAt запрещена. Retry не создаёт новый challenge; пользовательское resend создаёт разрешённый новый lifecycle по Identity policy.

Обычный retry: начальные кандидаты 15с/1м/5м/15м, максимум 4 повторные попытки после первой, ограничение актуальностью сообщения. Это инженерные defaults для проверки provider limits. Для auth retry ограничен TTL и urgency; нельзя механически использовать 15 минут. Permanent failures завершаются сразу. Provider timeout после send → unknown либо recovery по provider idempotency, не универсальная гарантия exactly-once.

Admin retry требует permission/reason/commandId и исключает login code. External send выполняется вне долгой transaction; claim и final state updates проверяют lease/version. Notification failure не откатывает оплаченную покупку.
