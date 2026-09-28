# ADR-008: доставка login code

Status: proposed, N-02 закрывает spike.

Вариант A: отдельная private auth queue с ACL/TTL/encrypted payload. Вариант B: короткий внутренний adapter вызов с закрытым доступом. Выбор по latency, observability, secret lifetime и complexity на одном VPS.

В обоих вариантах Identity владеет challenge lifecycle, Notifications delivery. Секрет не попадает в общий event/audit/log. Сообщение после expiresAt не отправляется. Provider acceptance отдельно от фактического получения письма пользователем. Проверить outage/retry/cooldown и redaction до включения реального sender.
