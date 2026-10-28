# ADR-007: wallet scope

Status: superseded by [ADR-011](011-wallet-grumbles.md) (28.10.2026): владелец выбрал отдельный сервис wallet-backend с одной внутренней валютой «грамблсы» (`GRM`) вместо денежного баланса по валютам. Текст ниже — история решения.

Базовый выпуск содержит direct payments/subscriptions и immutable financial journal. Админка показывает историю по валютам, не тратимый balance. W-01…06 подробно описаны, но не выполняются автоматически.

При включении: merchant поддерживает top-up scenario, double-entry ledger, source uniqueness, reservation/capture/release, refund/debt, отдельные UI/permissions и concurrency acceptance. Переводы между людьми/вывод денег не добавлять. Дополнительная оценка старого плана 8–15 рабочих дней до резерва — ориентир, пересчитать после выбранного scope.
