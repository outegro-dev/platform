# Сообщение не пришло

1. Найти NotificationIntent по source event/correlationId и user.
2. Проверить current preferences, channel binding и locale. Для auth проверить expiresAt.
3. Проверить Delivery lease/state/attempts и provider acceptance ID.
4. Pending с большим age — проверить worker/broker. Retry_wait — nextAttemptAt и reason. Permanent failed — исправить адрес/конфигурацию, не requeue бесконечно.
5. Accepted не равно delivered. Если provider callback нет, не писать «прочитано».
6. Разрешённый retry выполняется с commandId/reason и тем же intent. Login code не replay-ится из admin: пользователь начинает новый challenge.
7. После исправления проверить один контрольный send и DLQ policy. Не отправлять всю очередь без preview/limit.

Код, refresh и полные credentials не прикладывать к incident report. Для сбоя auth delivery operational alert идёт независимым каналом.
