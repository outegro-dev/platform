# Restore rehearsal и аварийное восстановление

## Предусловия

Доступен чистый разрешённый target, offsite backup/WAL, key custody, нужные image digests и GitOps revision. Rehearsal изолирован: никакого egress к реальным получателям и автоматической работы на тех же Telegram/provider channels.

## Шаги

1. Зафиксировать последнюю recovery point и время старта. Не уничтожать исходную копию.
2. Bootstrap единственного K3s узла либо test environment по выбранной процедуре.
3. Восстановить keys/config. Для SQLite K3s использовать совместимую процедуру SQLite+server token, не etcd snapshot commands.
4. Восстановить PostgreSQL и проверить integrity/migration version/контрольные fixtures.
5. Восстановить Hermes consistent state и assistant media. DB ItemMedia ссылки сверить с objects.
6. Развернуть совместимые app images с отправками наружу выключенными.
7. Reconcile внешние payment/subscription/refund факты после recovery point через idempotent commands. Outbox/inbox replay не должен повторять бизнес-эффект.
8. Проверить login/roles/grants/inbox/admin chain. После Redis loss допустим новый login, не автоматический доступ.
9. Разрешить внешние sends только после анализа backlog/duplicates и target channel. Не запускать весь historic notification archive.
10. Снять RPO/RTO. Цели: до 15 минут PG и до 4 часов после доступности заменяющего сервера; deviation описать явно.

## Выход

Report с restore point, duration, проверками данных/грантов/медиа, незакрытыми расхождениями и обновлённым runbook. Наличие backup object без этого отчёта не закрывает OPS-07.
