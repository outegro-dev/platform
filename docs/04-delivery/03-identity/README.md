# Identity и доступы

Реализовать вход/сессии/SSO/permissions. ID-08 ждёт Payments; глава не означает линейную независимость от соседних этапов.

## Вход и порядок

Номера этапов группируют работу. Hard dependencies в карточках определяют настоящий порядок; независимые задачи допустимо выполнять последовательно в любом топологическом порядке. При внешнем blocker перейти к другой ready task, не обходить требования.

| ID | Результат | Hard dependencies | Статус |
|---|---|---|---|
| [ID-01](tasks/ID-01.md) | Email-code lifecycle на Drizzle | [BE-03](../02-backend-foundation/tasks/BE-03.md), [BE-04](../02-backend-foundation/tasks/BE-04.md) | planned |
| [ID-06](tasks/ID-06.md) | Roles/permissions/bindings | [BE-03](../02-backend-foundation/tasks/BE-03.md), [BE-04](../02-backend-foundation/tasks/BE-04.md) | planned |
| [ID-02](tasks/ID-02.md) | Google/linking + account ownership | [ID-01](tasks/ID-01.md) | planned |
| [ID-03](tasks/ID-03.md) | Sessions/refresh concurrency | [ID-01](tasks/ID-01.md) | planned |
| [ID-04](tasks/ID-04.md) | SSO client/code/PKCE/BFF | [ID-03](tasks/ID-03.md), [BE-04](../02-backend-foundation/tasks/BE-04.md) | planned |
| [ID-05](tasks/ID-05.md) | Passkeys и RP id.outegro.dev | [ID-04](tasks/ID-04.md) | review |
| [ID-07](tasks/ID-07.md) | Owner bootstrap и step-up | [ID-05](tasks/ID-05.md), [ID-06](tasks/ID-06.md) | planned |
| [ID-08](tasks/ID-08.md) | Коммерческая grant projection | [BE-06](../02-backend-foundation/tasks/BE-06.md), [ID-06](tasks/ID-06.md), [PAY-06](../05-payments/tasks/PAY-06.md) | planned |
| [ID-09](tasks/ID-09.md) | Кабинет/сессии/locale | [DS-05](../01-landing-design/tasks/DS-05.md), [ID-03](tasks/ID-03.md), [ID-04](tasks/ID-04.md), [ID-05](tasks/ID-05.md), [ID-07](tasks/ID-07.md) | planned |
| [ID-10](tasks/ID-10.md) | Key rotation/revoke/CSRF tests | [ID-04](tasks/ID-04.md), [ID-05](tasks/ID-05.md), [ID-07](tasks/ID-07.md), [ID-08](tasks/ID-08.md) | review |

## Выход

Каждая обязательная карточка завершена с report/TC evidence, ошибки и внешний validation статус видны. Для этапов с ожиданием другого сервиса завершать зависимую карточку позже; не подменять API пустым success.

[Общие gate-критерии](../../05-quality/release-gates.md) · [Все этапы](../README.md)
