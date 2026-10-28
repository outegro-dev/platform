# Что дальше: порядок работы и контрольные точки (28.10.2026)

Подробности — в issue и карточках. Здесь только что в production, что в работе, в каком порядке продолжать и что проверяет владелец. Как развернуть проект и состояние сервисов — [handoff](handoff.md). Статусы — [доска](https://github.com/orgs/outegro-dev/projects/1) и [task-index.json](../04-delivery/task-index.json). План от 28.09 закрыт, незавершённое из него перенесено сюда.

## 1. В production

- outegro.dev, id., pay., admin., battleship., edu., hooks. — K3s за Cloudflare, CI → GHCR → gitops → Argo CD. Бэкапы в R2, восстановление проверено ([OPS-07](../09-evidence/OPS-07/20260929-1514-prod-drill/report.md)). Prometheus, Loki, Grafana, watchdog с алертами в Telegram.
- Базовый выпуск выкачен 02.10 ([R-04](../09-evidence/R-04/20261002-1700-prod/report.md), [R-05](../09-evidence/R-05/20261002-1700-prod/report.md)); из его карточек открыты только Hermes H-04…H-11 и мониторинг OPS-05. Морской бой (BS-01…04) — с 29.09.
- Лендинг — журнальный номер в теме zine, выкачен 11.10 ([#126](https://github.com/outegro-dev/platform/pull/126), smoke 32/32): тексты, объявления, запись на звонок в Calendly, рубрика «Вопрос — ответ», `/stack` как меню «Причала №1», ворота-загрузчик, OG-картинка. Карточки ZN-01…07, ZN-10, ZN-16…19 закрыты.
- Тихий вход: приложения подхватывают сессию id.outegro.dev без кнопки «Войти» ([ZN-09](https://github.com/outegro-dev/platform/issues/107)). Меню аккаунта в шапке лендинга ([ZN-08](https://github.com/outegro-dev/platform/issues/106)).
- Статистика лендинга: GTM с Consent Mode v2, по умолчанию отказ, баннер согласия ([ZN-18](https://github.com/outegro-dev/platform/issues/116)).
- Кошелёк, этап 1 (с 28.10, [ADR-011](../03-decisions/adr/011-wallet-grumbles.md)): грамблсы, журнал, сверка, раздел «Кошелёк» в админке. W-01, W-02, W-03, W-06 закрыты.
- Рулетка roulette.outegro.dev (с 28.10, [ADR-012](../03-decisions/adr/012-roulette.md)): ставки грамблсами, честность по цепочке сидов (сезон 1 — [журнал](../06-operations/roulette-seasons.md)), бонус дня, раздел «Рулетка» в админке. RL-01…08 закрыты.
- Обучение (edu.outegro.dev, с 06.10) — четыре книги ([#127](https://github.com/outegro-dev/platform/pull/127)): «Node.js изнутри», «SQL изнутри» (с Prisma, Drizzle, миграциями, PgBouncer и NestJS), «Брокеры сообщений: RabbitMQ и Kafka» (с NestJS), «JavaScript: основы для собеседования». [EDU-B1](https://github.com/outegro-dev/platform/issues/119) закрыт.

## 2. В работе

| Что | Карточки | Контрольная точка |
|---|---|---|
| Тема zine в приложениях | [ZN-11](https://github.com/outegro-dev/platform/issues/109) id, [ZN-12](https://github.com/outegro-dev/platform/issues/110) battleship, [ZN-13](https://github.com/outegro-dev/platform/issues/111) admin, [ZN-14](https://github.com/outegro-dev/platform/issues/112) edu, [ZN-15](https://github.com/outegro-dev/platform/issues/113) pay | Спокойный уровень темы, axe без нарушений, статусы по контрасту AA, скриншоты desktop и mobile. После ZN-12 — новые скриншоты Морского боя на лендинге |
| Зависимости | [MNT-01](https://github.com/outegro-dev/platform/issues/120) ([PR #129](https://github.com/outegro-dev/platform/pull/129)), [MNT-02](https://github.com/outegro-dev/platform/issues/121) | CI зелёный, после выкатки smoke 32/32, e2e без новых падений. Мажорные версии — отдельным PR каждая |
| Пины инфраструктуры | [MNT-05](https://github.com/outegro-dev/platform/issues/124) | RabbitMQ и Valkey — тег до патча с digest, mailpit не `latest`, Hermes по digest, actions/checkout и setup-node обновлены; Argo — Synced и Healthy |
| Follow-up из handoff и evidence | [MNT-03](https://github.com/outegro-dev/platform/issues/122) | Каждый пункт чек-листа в issue закрыт PR с тестом |
| Документация | [MNT-04](https://github.com/outegro-dev/platform/issues/123) | `python tools/documentation/validate.py` — pass, статусы в task-index.json совпадают с доской |
| Безопасность зависимостей | [MNT-06](https://github.com/outegro-dev/platform/issues/164) ([#146](https://github.com/outegro-dev/platform/pull/146)), [MNT-07](https://github.com/outegro-dev/platform/issues/165) | Next.js 16.4.3 выкачен отдельным релизом, smoke без падений; затем остальное из `pnpm audit` |
| Ёмкость узла и стабильность | [MNT-09](https://github.com/outegro-dev/platform/issues/167), [MNT-08](https://github.com/outegro-dev/platform/issues/166), [MNT-10](https://github.com/outegro-dev/platform/issues/168) | Общий релиз без NotReady; решение по VPS; `game.test.ts` стабилен |
| Кошелёк, этапы 2 и 3 | [W-04](https://github.com/outegro-dev/platform/issues/85) ([#147](https://github.com/outegro-dev/platform/pull/147)), [W-05](https://github.com/outegro-dev/platform/issues/87) ([#149](https://github.com/outegro-dev/platform/pull/149)) | Ждут офферов Lava, цен скинов и решения по Premium |
| Рулетка дальше | [RL-09](https://github.com/outegro-dev/platform/issues/160) нагрузка, [RL-10](https://github.com/outegro-dev/platform/issues/161) fanout и столы, [RL-11](https://github.com/outegro-dev/platform/issues/162) чат и топ, [RL-12](https://github.com/outegro-dev/platform/issues/163) Telegram | RL-09 первым: фактический потолок на текущем узле |
| Hermes и мониторинг | [H-04](../04-delivery/08-hermes/tasks/H-04.md), [H-05](../04-delivery/08-hermes/tasks/H-05.md), [H-07](../04-delivery/08-hermes/tasks/H-07.md), [OPS-05](../04-delivery/07-operations/tasks/OPS-05.md) | Ждут проверок владельца (раздел 4) |

## 3. Порядок

1. MNT-01 слить первым: он меняет общий lockfile и версии во всех приложениях. Остальные ветки ребейзить на него.
2. MNT-05 — следом: пины проверяются одной выкаткой и не зависят от кода приложений.
3. ZN-11…15 — по одному PR на приложение. Пункты admin-web из MNT-03 (BackLink вместо инлайн-стиля, цвета из кита) делать вместе с ZN-13, чтобы не править одни файлы дважды. Остальные пункты MNT-03 — отдельными PR по сервисам.
4. MNT-02 — после тем: TypeScript 7, MobX 7 и остальные мажорные версии, по одной на PR, с полным прогоном тестов.
5. Hermes: закрыть H-04, H-05, H-07 после проверок владельца. Остальное не начато: [H-06](../04-delivery/08-hermes/tasks/H-06.md) (бэкап, алерты и нагрузочный тест) и [H-08…H-11](../04-delivery/08-hermes/README.md) (фото → карточка вещи → черновик объявления).
6. [ZN-20](https://github.com/outegro-dev/platform/issues/118) (кейс на полезном людям проекте) — после выбора проекта владельцем.

Кошелёк ([ADR-011](../03-decisions/adr/011-wallet-grumbles.md)): этап 1 в production; этапы 2 и 3 (W-04, W-05) — только по команде владельца. Рулетка: сначала RL-09 и MNT-09, потом RL-10…12.

## 4. Решения владельца

- Кошелёк: офферы пакетов грамблсов на Lava (W-04), цены скинов и решение по Premium (W-05); проверить раздел «Кошелёк» под своим входом.
- Рулетка: проверить игру, бонус дня и раздел «Рулетка» под своим входом; решить по VPS (MNT-09) и по RL-10…12.
- Рубрика «Вопрос — ответ» на лендинге ([ZN-17](https://github.com/outegro-dev/platform/issues/115)): подтвердить формулировки ответов.
- GA4: создать ресурс GA4 и тег в контейнере GTM ([ZN-18](https://github.com/outegro-dev/platform/issues/116)). Без него статистика не собирается.
- ZN-20: выбрать проект для кейса «задача, решение, цифры».
- Остаётся из [handoff](handoff.md#нужно-от-владельца): мониторы UptimeRobot (OPS-05), попытка заставить Hermes прочитать ключи (H-04-03), возврат Lava на реальном аккаунте, продажа учебников и первая проверка ИИ-помощника, ротация трёх секретов (отложена). Аккаунты и доступы — [owner-checklist](owner-checklist.md).
