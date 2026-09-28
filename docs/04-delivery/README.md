# Этапы и задачи v0.3

92 отдельные карточки: **85 для базового выпуска**, **1 для будущего ТЗ игры**, **6 условных wallet-задач**. По сравнению с 82 исходными пунктами добавлены 4 задачи подготовки, а ранее перечисленный одной строкой wallet вынесен в 6 карточек. Число карточек не означает завершённый код.

У каждой карточки context, dependency links, required docs, область файлов, четыре предметных шага, checkpoints, конкретные test cases, DoD и rollback. [Machine index](task-index.json) содержит граф и статусы. [Каталог тестов](../05-quality/test-catalog.md) связывает все TC с задачами.

## Этапы

- [Подготовка рабочего проекта](00-preparation/README.md): Создать независимый workspace, inventoried reuse и реальные команды проверки. Код backend пока не обновлять.

- [Лендинг и дизайн-система](01-landing-design/README.md): Создать EN/RU landing и серебряную сцену с измеряемым качеством. Завершить Gate A до платформенной реализации.

- [Backend, Drizzle и доставка событий](02-backend-foundation/README.md): Проверить совместимость, разделить DB roles, реализовать contracts/outbox/inbox до бизнес-сервисов.

- [Identity и доступы](03-identity/README.md): Реализовать вход/сессии/SSO/permissions. ID-08 ждёт Payments; глава не означает линейную независимость от соседних этапов.

- [Notifications](04-notifications/README.md): Создать приватную auth delivery, обычные каналы и inbox. Billing templates завершаются после соответствующих events Payments.

- [Payments, Lava и subscriptions](05-payments/README.md): От API fixtures перейти к idempotent checkout, журналу, grants, подпискам и проверке merchant. Продажи отдельно от готовности кода.

- [Административная панель](06-admin/README.md): Дать владельцу поиск, диагностику цепочек и контролируемые domain commands с permission/reason/audit.

- [K3s и эксплуатация](07-operations/README.md): Один VPS, GitOps, data persistence, наблюдаемость, backup/restore. OPS-08 ждёт весь P0 stack, включая Hermes.

- [Личный Hermes и каталог](08-hermes/README.md): Plus route, private topics, typed catalog tools, фото и drafts. Full-stack resource test выполняется затем в OPS-08.

- [Интеграция и production](09-release/README.md): Связать UI и сервисы, пройти failure E2E, readiness, deploy и post-release review.

- [Будущие приложения](10-future/README.md): После первого production собрать отдельное ТЗ Battleship. Не реализовывать игру в рамках текущего плана.

- [Условный этап wallet](90-optional-wallet/README.md): Не выполнять до явного выбора владельца и проверки merchant. Расширяет базовый scope и оценку.

## Порядок без циклов

Начать с BOOT-01. После Gate A можно выполнять backend и infrastructure foundation. Identity grant projection ждёт PAY-06. Billing templates ждут payment/subscription events. H-06 проверяет backup/alerts агента до H-11; OPS-08 ждёт H-11 и измеряет весь stack. Это убирает прежнюю неоднозначность «Hermes acceptance ждёт полный resource test, который ждёт Hermes».

## Один допустимый топологический порядок

BOOT-01 → BOOT-02 → BOOT-03 → BOOT-04 → L-01 → DS-01 → L-02 → DS-02 → L-03 → L-06 → DS-03 → DS-04 → L-04 → L-08 → DS-05 → L-05 → L-09 → L-07 → L-10 → BE-01 → OPS-01 → BE-02 → BE-03 → BE-04 → H-01 → BE-05 → BE-07 → H-02 → ID-01 → ID-06 → N-01 → OPS-04 → PAY-01 → BE-06 → H-03 → H-04 → ID-02 → ID-03 → N-02 → OPS-02 → OPS-05 → PAY-02 → H-05 → H-07 → ID-04 → N-03 → OPS-03 → OPS-06 → PAY-04 → H-06 → H-08 → ID-05 → PAY-03 → PAY-05 → H-09 → ID-07 → PAY-06 → A-01 → H-10 → ID-08 → ID-09 → PAY-07 → PAY-09 → A-02 → A-06 → H-11 → ID-10 → N-04 → N-05 → N-06 → PAY-08 → PAY-10 → PAY-11 → A-03 → A-04 → OPS-07 → PAY-12 → W-01 → A-05 → W-02 → A-07 → W-03 → OPS-08 → R-01 → W-04 → R-02 → W-05 → R-03 → W-06 → R-04 → R-05 → NEXT-01

## Выбор следующей задачи

Брать planned задачу, у которой все hard dependencies done и необходимые inputs доступны. Wallet со статусом deferred не становится ready автоматически после Payments. Отсутствие текущих completed tasks означает, что только BOOT-01 готова к старту реализации.

## Оценка

Предыдущая оценка платформы 62–103 рабочих дня без резерва / 75–124 с резервом остаётся грубой оценкой, не обещанием скорости конкретной модели. Новые BOOT/checkpoint детали требуют повторной оценки после bootstrap. API/credentials/дизайн-review задержки и игры в оценку не включены. Более простая модель может потребовать больше ревью и повторений.
