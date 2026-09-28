# Лендинг и дизайн-система

Создать EN/RU landing и серебряную сцену с измеряемым качеством. Завершить Gate A до платформенной реализации.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [L-01](tasks/L-01.md) | Зафиксировать brief и карту секций | [BOOT-04](../00-preparation/tasks/BOOT-04.md) | planned |
| [DS-01](tasks/DS-01.md) | Выбрать типографику и semantic tokens | [L-01](tasks/L-01.md) | planned |
| [L-02](tasks/L-02.md) | Составить EN/RU content skeleton | [L-01](tasks/L-01.md) | planned |
| [DS-02](tasks/DS-02.md) | Button/Link/FormField/Input/focus | [DS-01](tasks/DS-01.md), [BOOT-03](../00-preparation/tasks/BOOT-03.md) | planned |
| [L-03](tasks/L-03.md) | Сгенерировать/подготовить визуальные варианты hero | [DS-01](tasks/DS-01.md), [L-02](tasks/L-02.md) | planned |
| [L-06](tasks/L-06.md) | Настроить EN-default routing/messages | [L-02](tasks/L-02.md), [BOOT-03](../00-preparation/tasks/BOOT-03.md) | planned |
| [DS-03](tasks/DS-03.md) | Dialog/Menu/LocaleSwitch/feedback | [DS-02](tasks/DS-02.md) | planned |
| [DS-04](tasks/DS-04.md) | Table/filters/status/timeline/amount | [DS-02](tasks/DS-02.md) | planned |
| [L-04](tasks/L-04.md) | Реализовать R3F silver prototype | [L-03](tasks/L-03.md) | planned |
| [L-08](tasks/L-08.md) | Реализовать expertise/approach/projects | [L-02](tasks/L-02.md), [DS-02](tasks/DS-02.md), [L-06](tasks/L-06.md) | planned |
| [DS-05](tasks/DS-05.md) | Сборка shell id/pay/admin | [DS-03](tasks/DS-03.md), [DS-04](tasks/DS-04.md) | planned |
| [L-05](tasks/L-05.md) | Измерить профили качества | [L-04](tasks/L-04.md) | planned |
| [L-09](tasks/L-09.md) | Footer/contact/metadata | [L-06](tasks/L-06.md), [L-08](tasks/L-08.md) | planned |
| [L-07](tasks/L-07.md) | Реализовать hero/header | [L-05](tasks/L-05.md), [L-06](tasks/L-06.md), [DS-03](tasks/DS-03.md) | planned |
| [L-10](tasks/L-10.md) | Mobile/a11y/performance acceptance | [L-07](tasks/L-07.md), [L-08](tasks/L-08.md), [L-09](tasks/L-09.md), [DS-05](tasks/DS-05.md) | planned |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
