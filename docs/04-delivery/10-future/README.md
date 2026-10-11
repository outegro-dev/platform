# Будущие приложения

После первого production собрать отдельное ТЗ Battleship. Не реализовывать игру в рамках текущего плана.

Выполнено: ТЗ — [глава 16](../../01-specification/chapters/16-battleship.md), игра на battleship.outegro.dev с 29.09. Карточки BS-01…04 есть только на доске, без карточки-файла.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [NEXT-01](tasks/NEXT-01.md) | Отдельное ТЗ Battleship | [R-05](../09-release/tasks/R-05.md) | done |
| [BS-01](https://github.com/outegro-dev/platform/issues/93) | Battleship engine: rules, match state machine, bots, Elo | [NEXT-01](tasks/NEXT-01.md) | done |
| [BS-02](https://github.com/outegro-dev/platform/issues/94) | Battleship backend: WebSocket game server, matchmaking, rating, grants | BS-01 | done |
| [BS-03](https://github.com/outegro-dev/platform/issues/95) | Battleship web: MobX stores, GameSocket, animations, shop | BS-02 | done |
| [BS-04](https://github.com/outegro-dev/platform/issues/96) | Battleship in production: images, gitops, battleship.outegro.dev | BS-03 | done |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
