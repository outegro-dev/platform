# Контракты реализации

Эти документы определяют предлагаемый внутренний контракт v1. Это спецификация будущего кода, а не описание уже работающих endpoints. BE-04 переносит её в typed schemas/fixtures. Provider adapter сохраняет фактический контракт Lava отдельно от нормализованных внутренних полей.

- [HTTP, ошибки, идентификаторы и время](http-errors.md)
- [События, outbox и inbox](events.md)
- [Identity, сессии и permissions](identity-access.md)
- [Оплаты, деньги и состояния](billing.md)
- [Уведомления](notifications.md)
- [Дизайн и i18n](design-i18n.md)
- [Hermes, темы и каталог](assistant.md)
- [Развёртывание и ресурсы](deployment.md)
- [Глобальные инварианты](invariants.md)

Имена полей ниже — стабильные проектные defaults. Не копировать их в provider request без mapping. Неизвестные внешние поля/статусы требуют fixtures или решения, а не свободного изобретения модели.

## Разбор сложных задач по микрошагам

- [Checkout](recipes/checkout-implementation.md)
- [Outbox/inbox](recipes/outbox-inbox-implementation.md)
- [Refresh spike](recipes/refresh-spike.md)
- [Фото в каталог](recipes/photo-intake.md)
