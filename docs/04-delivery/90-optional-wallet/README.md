# Условный этап wallet

Не выполнять до явного выбора владельца и проверки merchant. Расширяет базовый scope и оценку.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [W-01](tasks/W-01.md) | Схема wallet и double-entry ledger | [PAY-05](../05-payments/tasks/PAY-05.md), [PAY-09](../05-payments/tasks/PAY-09.md), [PAY-10](../05-payments/tasks/PAY-10.md) | deferred |
| [W-02](tasks/W-02.md) | Подтверждённое пополнение | [W-01](tasks/W-01.md), [PAY-03](../05-payments/tasks/PAY-03.md) | deferred |
| [W-03](tasks/W-03.md) | Reserve, capture и release | [W-02](tasks/W-02.md), [PAY-06](../05-payments/tasks/PAY-06.md) | deferred |
| [W-04](tasks/W-04.md) | Возвраты, reversal и debt | [W-03](tasks/W-03.md), [PAY-09](../05-payments/tasks/PAY-09.md) | deferred |
| [W-05](tasks/W-05.md) | Wallet UI и admin commands | [W-04](tasks/W-04.md), [A-03](../06-admin/tasks/A-03.md), [DS-04](../01-landing-design/tasks/DS-04.md) | deferred |
| [W-06](tasks/W-06.md) | Wallet concurrency и reconciliation acceptance | [W-05](tasks/W-05.md) | deferred |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
