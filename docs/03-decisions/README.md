# Реестр решений

Прямые требования владельца перечислены в [контексте](../00-start-here/project-context.md) и главе 0. Инженерные предложения ниже действуют как defaults для задач, пока не возникнет документированный конфликт. `proposed` означает, что соответствующий spike ещё должен подтвердить вариант; модель не пишет done вместо такого исследования.

| ADR | Тема | Статус | Закрывающая задача |
|---|---|---|---|
| [001](adr/001-single-node.md) | Один VPS и fresh data | accepted: user requirement | OPS-01/08 проверяют реализацию |
| [002](adr/002-brand-design.md) | Бренд, silver signature, EN/RU | accepted: направление; макеты впереди | L-03/05 |
| [003](adr/003-domain-boundaries.md) | Разделение сервисов и прав | proposed: default | BE-04/ID-06/PAY-06 |
| [004](adr/004-sso-refresh.md) | SSO library и rotation | proposed: spike required | ID-03/04 |
| [005](adr/005-provider-contract.md) | Lava adapter и неопределённые операции | proposed: validated per capability | PAY-01/12 |
| [006](adr/006-hermes-plus.md) | Hermes Plus/topics/catalog | accepted: цель; route проверяется | H-01/05 |
| [007](adr/007-wallet.md) | Внутренний wallet | deferred: user decision | W-01 только после выбора |
| [008](adr/008-notification-auth-path.md) | Приватная доставка login code | proposed: spike required | N-02 |
| [009](adr/009-backend-stack.md) | Стек backend: TS 6, Nest 12, Zod, Drizzle, Valkey, pino | accepted: owner 28.09.2026 | BE-01…BE-07 |

Новые решения именовать последовательно, использовать [шаблон ADR](../07-templates/adr.md). [Открытые inputs](open-inputs.md) — единственный список того, что понадобится от владельца/внешнего провайдера.
