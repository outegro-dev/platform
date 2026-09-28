# Подготовка рабочего проекта

Создать независимый workspace, inventoried reuse и реальные команды проверки. Код backend пока не обновлять.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [BOOT-01](tasks/BOOT-01.md) | Независимый корень и Git hygiene | — | planned |
| [BOOT-02](tasks/BOOT-02.md) | Инвентаризация повторного использования | [BOOT-01](tasks/BOOT-01.md) | planned |
| [BOOT-03](tasks/BOOT-03.md) | Frontend workspace без backend зависимости | [BOOT-02](tasks/BOOT-02.md) | planned |
| [BOOT-04](tasks/BOOT-04.md) | Рабочие команды и test harness | [BOOT-03](tasks/BOOT-03.md) | planned |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
