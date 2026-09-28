# Глава 15. Открытые решения, приёмка и источники

> Версия 0.3: детальные действия, зависимости и test cases находятся в [карточках задач](../../04-delivery/README.md). Эта глава задаёт предметный контекст.

## 15.1. Вопросы, которые ещё влияют на scope

| Вопрос | Рабочее предложение до ответа | Когда нужен ответ |
|---|---|---|
| Нужен ли внутренний wallet/top-up сразу? | Прямые оплаты + подписки + журнал; кошелёк отдельно | До PAY-02 и окончательной оценки |
| Есть ли платный тариф к первому запуску? | Механизм готов, каталог закрыт/пуст до реального продукта | До публичных продаж |
| Целевые компьютер и телефон для 60 FPS | Матрица устройств согласуется на prototype | До L-05 |
| Owner Telegram ID, group ID, topic IDs и bot token | Приватная группа и тема вещей; секрет отдельно | До H-03/07 |
| Барахолка и правила отправки | Сначала draft; публикация только в разрешённый destination | До H-10 |
| Публичный email/GitHub/LinkedIn/Telegram | Только подтверждённые владельцем ссылки | До L-09/release |
| Merchant Lava/test scenario/валюты | Не угадывать sandbox и ограничения аккаунта | До PAY-12 |
| Google OAuth, email-провайдер, Telegram bot | Использовать отдельные credentials нового проекта | До end-to-end provider checks |
| DNS/VPS/bucket/registry доступы | Новый независимый environment | До OPS-01/06 |
| Канал operational alerts и внешнего uptime | Отдельный от Notifications | До OPS-05/release |

Биография уже достаточна для первой версии; подробное резюме не блокирует работу. ТЗ Battleship сейчас не нужно. Перенос старых баз/аккаунтов не нужен. Имя, домен, языки, стиль и порядок выпуска не требуют повторного выбора.

## 15.2. Рекомендации, не выдаваемые за утверждённые решения

URL EN `/`, RU `/ru`; отдельные id/pay/admin/hooks поддомены; passkey RP id.outegro.dev; самостоятельные коммерческие grants Payments; scoped RBAC Identity; нейтральные сервисные surfaces; CSS glass для UI; 60-FPS acceptance на согласованной матрице; контрольные retention/ресурсные лимиты; закрытый каталог до реального товара. Эти решения конкретны и готовы к реализации, но меняются при новых вводных с записью ADR.

## 15.3. Итоговые критерии первого релиза

| Область | Минимальное доказательство |
|---|---|
| Бренд | Nick Lukashik, outegro.dev, нет публичного кейса outegro.com |
| Контент | Проверенные компетенции, честная Projects-заглушка, действующий контакт |
| Дизайн | Серебряная подпись/liquid glass, общие tokens/components |
| Производительность | Зафиксированная матрица устройств и 3D frame report, fallback |
| i18n | EN первый визит; полные RU UI/errors/messages |
| Identity | Реальные login/session/SSO/passkey flows и негативные tests |
| Access | Роли отдельно от покупок; ownership; audit; last-owner protection |
| Payments | Idempotent checkout/event handling, journal, grant, reconciliation |
| Subscription | Renew/cancel/expiry не создают лишних сроков или прав |
| Notifications | Inbox, preferences, retry/DLQ, понятные provider states |
| Admin | User/payment/grant/delivery chain и безопасные доменные команды |
| Data | Чистый bootstrap Drizzle, constraints, separate DB roles |
| Operations | Один VPS, resource test, logs/metrics/alerts, recovery test |
| Hermes | Plus OAuth/no-spend; отдельные темы; каталог/фото переживают restart; private owner-only |
| Release | Immutable images/GitOps, migration gate, smoke, rollback runbook |

## 15.4. Реестр главных рисков

| Риск | Как обнаружить | Что делаем |
|---|---|---|
| 3D красиво только на мощном ПК | Реальное устройство/5-минутный прогон | Adaptive quality, проще эффект, статичный fallback |
| Glass снижает читаемость | Contrast/keyboard/mobile review | Непрозрачная основа форм и таблиц |
| Nest/AMQP несовместимы | Compatibility spike | Проверенный adapter/тонкая обёртка |
| Refresh race завершает сессию | Конкурентный integration test | BFF single-flight и явный rotation contract |
| Роли смешаны с подпиской | Permission/access matrix tests | Разделённые RoleBinding и CommercialGrant |
| Дубль оплаты/renewal | Replay и crash tests | Unique source IDs и атомарные transitions |
| Refund не сопоставляется | Provider fixtures/несколько одинаковых покупок | Unmatched queue, verified resolution |
| Один VPS потерян | Restore rehearsal | Внешние backups и секреты, runbook |
| Monitoring съедает память | Full-stack нагрузка на 8 ГБ | Retention/cardinality/concurrency limits |
| Админка обходит правила | Подмена actor/resource/permission | Domain authorization и audit transaction |
| Интеграция тянется из-за отсутствия товара | Release scope review | Закрытый каталог, отдельное sales activation |
| Hermes использует платный маршрут или extra credits | Provider/auxiliary audit и проверка аккаунта | Отключить fallback, проверить billing controls, остановка по quota |
| Telegram-темы смешивают личные данные | Два независимых сценария и поиск по памяти | Topic scopes, ограниченные tools, явный перенос контекста |
| Фото потеряно или объявление отправлено дважды | Restart между приёмом/commit/send | Durable ingest, source IDs, unknown publication без слепого retry |

## 15.5. Локальные доказательства исследования

Пути относительны к workspace `C:/Users/working/Desktop/outegro`.

- `monorepo/apps/auth-backend/prisma/schema.prisma`: User.locale default ru; Entitlement service/role/source/expiry; отсутствие полноценной Role/Permission модели в просмотренной схеме.
- `monorepo/apps/auth-backend/src/auth/entitlements.service.ts`: извлечение действующих grants при token mint.
- `monorepo/apps/auth-backend/src/tokens/tokens.service.ts`: ES256 и refresh Redis/Lua.
- `monorepo/apps/auth-backend/src/common/jwt-auth.guard.ts`: проверка токена/сессии; сравнение с другими сервисами из аудита 0.1.
- `monorepo/apps/payments-backend/prisma/schema.prisma` и `src/app.module.ts`: заготовка без платежных моделей.
- `monorepo/apps/landing-web/src/i18n/request.ts`: next-intl/cookie без locale URL routing.
- `monorepo/apps/id-web/src/lib/i18n.tsx`, `monorepo/packages/ui/src/lib/locale.ts`: словари/locale helper, выбор ru по navigator.
- `gitops`: Argo/Helm, runtime values, migration hooks, инфраструктура.
- `planning/research/vps-audit-2026-09-27.txt`: read-only operational snapshot, не benchmark.
- `planning/research/package-versions.json`: registry snapshot, не протестированная compatibility matrix.
- `planning/research/lava-openapi-2026-09-27.yaml`: сохранённый публичный контракт провайдера.

## 15.6. Внешние источники

Lava: [developer portal](https://developers.lava.top/en), [Swagger](https://gate.lava.top/docs), [OpenAPI](https://gate.lava.top/docs/documentation.yaml). Context7 `/websites/developers_lava_top_en` использован для поиска, но противоречия разрешены в пользу свежего портала/OpenAPI. Не смешивать Lava.top с другими продуктами похожего названия.

3D: [React Three Fiber](https://github.com/pmndrs/react-three-fiber), [performance](https://r3f.docs.pmnd.rs/advanced/scaling-performance), [pitfalls](https://r3f.docs.pmnd.rs/advanced/pitfalls); [liquid-logo](https://github.com/collidingScopes/liquid-logo); [shadergradient](https://github.com/ruucm/shadergradient); [liquid-glass-js](https://github.com/dashersw/liquid-glass-js). Последние три — кандидаты/референсы, не обещанные production dependencies.

Платформа: [Nest migration](https://docs.nestjs.com/migration-guide), [Drizzle migrations](https://orm.drizzle.team/docs/migrations), [next-intl routing](https://next-intl.dev/docs/routing/configuration), [K3s datastore](https://docs.k3s.io/datastore), [K3s restore](https://docs.k3s.io/datastore/backup-restore).

Личный помощник: [Hermes providers](https://hermes-agent.nousresearch.com/docs/integrations/providers), [Telegram topics](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram), [sessions](https://hermes-agent.nousresearch.com/docs/user-guide/sessions), [Docker](https://hermes-agent.nousresearch.com/docs/user-guide/docker/); [OpenAI account/auth](https://learn.chatgpt.com/docs/app-server), [Codex pricing/limits](https://learn.chatgpt.com/docs/pricing), [Telegram Bot FAQ](https://core.telegram.org/bots/faq). Конкретный Plus-аккаунт ещё не подключён; маршрутизация и отсутствие дополнительных расходов — проверяемые критерии, а не уже достигнутый результат.

Визуальные референсы: [Lisa](https://lisa.locomotive.ca/en), [Boc](https://boc.studio/), [bleibtgleich](https://bleibtgleich.dev/), [1minus1](https://1minus1.com/). Они просмотрены через Playwright в desktop/mobile viewport; скриншоты — evidence, не макеты нашего сайта. Теперь выбран вариант «Жидкая подпись», поэтому старое предпочтение «Механики продукта» отменено.

Навыки: taste-skill, image-to-code, web-design-guidelines, playwright-cli установлены ранее; presentations применён для обновления презентации. Дальнейшая реализация использует дизайн-процесс навыков, но настоящий документ сам по себе не является выполненной разработкой.

## 15.7. Изменения относительно версии 0.1

Уточнены имя/домен; серебро/liquid glass заменили основную концепцию; EN/RU и новый порядок выпуска зафиксированы; личные данные предоставлены самим владельцем; публичный кейс старого проекта исключён; Projects — заглушка; анонимный режим удалён как ошибочная диктовка; новые DB отменили migration старых данных; Lava docs проверены; добавлены продуктовые паспорта сервисов, DS, роли, подписки, admin, финансовая сверка и wallet option. Игра выведена из текущего подробного scope. Новые оценки относятся к платформе до игры, включая Hermes, Telegram topics и каталог вещей. Подписка Plus и назначение личного помощника подтверждены владельцем.
