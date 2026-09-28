# Runbooks

Эти процедуры — проектные инструкции. Конкретные команды/context/namespace/image refs заполняются соответствующей OPS/H задачей после проверки выбранных версий. Не запускать предполагаемые команды на старом VPS.

- [Выпуск и откат](release-rollback.md)
- [Восстановление данных](restore.md)
- [Проблема оплаты или доступа](payment-incident.md)
- [Проблема уведомлений](notification-incident.md)
- [Hermes: quota, auth и сообщения](hermes-incident.md)
- [Недостаток ресурсов](resource-pressure.md)

Каждый выполненный runbook записывает target, actor, start/end, symptom, steps, result и follow-up. Предположение и подтверждённый факт разделять.
