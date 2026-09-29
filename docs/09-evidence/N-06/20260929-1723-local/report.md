# Отчёт N-06

- Статус: review (все TC pass локально; `done` после QA и слияния ветки ведущим).
- Task card: [N-06](../../../04-delivery/04-notifications/tasks/N-06.md)
- Commit/ref и dirty files: ветка `feat/notifications-billing-security` от master `9f4adc4`. Коммиты: `304cc57` contracts, `33eb2da` notifications-backend, `6fe01eb` payments-backend, `b0408a2` auth-backend, `f714008` контракты в docs и статус. Грязных файлов нет.
- Environment/runtime: Windows 11, Node v26.8.1 (CI и образы — Node 24), pnpm 12.3.4, Docker 29.7.2; Testcontainers: PostgreSQL, Valkey, RabbitMQ. Email и Telegram — fakes из test harness, реальных отправок и доступа к production не было.
- Прочитанные contracts/ADR: project-context, execution-protocol, [notifications](../../../02-contracts/notifications.md), [http-errors](../../../02-contracts/http-errors.md), [events](../../../02-contracts/events.md), [billing](../../../02-contracts/billing.md), [invariants](../../../02-contracts/invariants.md), [design-i18n](../../../02-contracts/design-i18n.md), главы 5 и 8, [handoff](../../../00-start-here/handoff.md). Context7: `/resend/react-email` — `render(element, { plainText: true })`.
- Dependency evidence: N-02, BE-04, PAY-05, PAY-07 в `task-index.json` имеют `planned`, отчётов в `docs/09-evidence` нет (статусы ведутся на доске, см. handoff). Проверены фактические артефакты: приватная доставка кода входа `apps/notifications-backend/src/auth-codes` и `auth-codes.test.ts` (TC-N-02-01…04), конверт и события `packages/contracts`, журнал, outbox и периоды подписок `apps/payments-backend`. Прогон до изменений: contracts 19/19, notifications-backend 39/39, payments-backend 104/104, auth-backend 49/49. Конфликт документации записан здесь; статусы чужих карточек не менялись.

## Изменения

C1, контракт. Вход: `notifications.intent.requested.v1` из очереди `notifications.intents` (inbox `unique(consumer, eventId)`) либо собственное уведомление notifications в транзакции факта. Выход: intent, inbox item и доставки email/Telegram, текст EN/RU. Отказ (PermanentError → DLQ, ничего не записано): неизвестный шаблон, чужая категория, auth-шаблон, data не по схеме шаблона, `actionUrl` не на своём сайте. Инварианты: сообщение описывает committed факт producer-а; о доступе — только состояние grant в той же транзакции; ссылки только на свои origin; пользовательский текст экранирован; ошибка доставки не откатывает оплату (запрос пишется в outbox, отправка после commit). Исходное поведение: `billing.payment-confirmed` писал «Your access is active», не зная grant, сумму строкой `0.59 USD`, название только на языке покупки.

`packages/contracts` (`304cc57`): `templateKey` допускает суффикс версии `.vN`; старые ключи валидны (расширение контракта), тест ключей.

`apps/notifications-backend` (`33eb2da`):

- `src/templates/registry.tsx`: 10 новых шаблонов EN/RU с `sample`, zod-схемой data и общим видом письма `notice()`; `allowedLink()` пропускает только origin `PUBLIC_WEB_URL`, `ACCOUNT_URL`, `PAY_WEB_URL` (та же схема, без учётных данных). v1 `billing.payment-confirmed` оставлен для уже сохранённых сообщений и больше ничего не утверждает о доступе.
- `src/templates/format.ts` (новый): деньги из minor units через `Intl.NumberFormat` строкой, без float; время UTC с пометкой `UTC` на языке получателя. Часовой пояс получателя сервису неизвестен (Identity его не хранит), поэтому UTC — действующее правило сервиса.
- `src/intents/intents.service.ts`: `record(tx, request)` проверяет шаблон, схему data и ссылку до записи; используется consumer-ом и собственными уведомлениями.
- `src/telegram/telegram-link.service.ts`: `security.telegram-linked.v1` в транзакции привязки; каналы inbox и email, не сам привязанный чат.
- `src/config/*`, `.env.example`: `PAY_WEB_URL` (по умолчанию `https://pay.outegro.dev`, локально `http://localhost:3003`); `contextOf()` в `render.ts` для воркера, превью и кода входа.
- Тесты: `src/billing-security.test.ts`, `src/templates.test.ts` и снимок смысловых полей `src/__snapshots__/templates.test.ts.snap` (subject, title, text, ссылки каждого шаблона EN/RU), дополнения в `src/telegram-admin.test.ts`, `src/test/harness.ts`.

`apps/payments-backend` (`6fe01eb`): `src/billing/notices.ts` (`BillingNotices`) пишет запросы через outbox в транзакции факта: сумма в minor units, название EN и RU, состояние grant, ссылка на страницу pay-web. Точки вызова: `settlement.ts` (оплата, отказ продления), `cancellation.ts` (после подтверждения Lava), `workers/expiry.worker.ts`, `refunds.ts` (возврат применён к проверенной оплате, в том числе после ручной привязки). `subscriptionChanged` возвращает eventId как источник сообщения; `paymentNotification` и `displayMoney` удалены. Конфиг `payWebConfig`.

`apps/auth-backend` (`b0408a2`): `security.google-linked.v1` и `security.google-unlinked.v1` через outbox в транзакции привязки и отвязки, `sourceEventId` — id строки identity; вход через Google при регистрации — не привязка, сообщения нет.

Документация (`f714008`): [notifications](../../../02-contracts/notifications.md) (шаблоны, версии, ссылки, деньги и время), [billing](../../../02-contracts/billing.md) (какие факты дают сообщения), статус карточки и `task-index.json`.

### Покрытые события

| Факт | Producer, место | Шаблон | Каналы (обязательные) |
|---|---|---|---|
| Разовая покупка оплачена | payments, `settlement.initial` | `billing.payment-confirmed.v2` | inbox, email, Telegram (inbox) |
| Первая оплата подписки | payments, `settlement.initial` | `billing.subscription-started.v1` | то же |
| Продление оплачено | payments, `settlement.renewal` | `billing.subscription-renewed.v1` | то же |
| Lava сообщила об отказе продления | payments, `settlement.renewal` | `billing.renewal-failed.v1` | то же |
| Lava подтвердила отключение продления | payments, `cancellation.markCancelled` | `billing.subscription-cancelled.v1` | то же |
| Оплаченное время и grace закончились | payments, `ExpiryWorker` | `billing.subscription-expired.v1` | то же |
| Полный возврат применён к оплате | payments, `refunds.applyToPayment` | `billing.refund-recorded.v1` | то же |
| Повтор refresh-токена (было) | identity, `sessions.onReuse` | `security.session-revoked` | inbox, email, Telegram (inbox, email) |
| Привязан Google (добавлено) | identity, `identities.link` | `security.google-linked.v1` | то же |
| Отвязан Google (добавлено) | identity, `identities.unlink` | `security.google-unlinked.v1` | то же |
| Подключён Telegram (добавлено) | notifications, `TelegramLinkService.link` | `security.telegram-linked.v1` | inbox, email (оба) |

Без сообщения (не committed факт или шум): `cancel_requested`, `past_due` по времени, частичный возврат на review, chargeback, ручные grant оператора, завершение сессий пользователем или админом. Новый вход auth не публикует; уведомление о каждом входе по коду дублирует письмо с кодом, нужен признак «нового устройства» — follow-up.

## Checkpoints

| Checkpoint | Результат | Evidence |
|---|---|---|
| C1 контракт/исходное поведение | Вход, выход, отказы и инварианты записаны выше; базовые прогоны зелёные | логи прогонов до изменений |
| C2 реализация | 1) шаблоны с версиями и EN/RU; 2) consumers и locale (язык из профиля, fallback EN, название продукта на языке сообщения); 3) allowlist ссылок и экранирование; 4) снимок смысловых полей и проверка redaction | коммиты выше |
| C3 проверки | Все TC и наборы тестов затронутых пакетов pass | таблица ниже |
| C4 handoff | Отчёт, контракты, статус `review` в карточке и индексе | этот файл |

## Проверки

| TC-ID/команда | Environment | Фактический результат | pass/fail/blocked/not-run | Evidence |
|---|---|---|---|---|
| TC-N-06-01 | Testcontainers, fake email/Telegram | Один `billing.subscription-renewed.v1` (5000 minor RUB) для EN и RU. EN: «Subscription renewed: Battleship Premium», «We received ₽50.00 … on Sep 29, 2026, 2:03 PM UTC. The subscription is now paid until Oct 29, 2026, 2:03 PM UTC. Access is active.» RU: «Подписка продлена: Морской бой Premium», «Оплата 50,00 ₽ за «Морской бой Premium» получена 29 сент. 2026, 14:03 UTC. Теперь подписка оплачена до 29 окт. 2026, 14:03 UTC. Доступ открыт.»; тот же текст в Telegram и inbox; доставки `accepted`. RUB/USD/EUR × EN/RU: ₽50.00 / 50,00 ₽, $0.59 / 0,59 $, €0.52 / 0,52 € | pass | `billing-security.test.ts`, `templates.test.ts` |
| TC-N-06-02 | unit и конвейер доставки | `access: pending`: «Access is not active yet: it opens once activation completes.» / «Доступ ещё не открыт: он откроется, когда завершится активация.», без «Access is active» в письме и inbox; v1 не упоминает доступ. Payments: продление подписки с отозванным grant отправляет `access: pending` | pass | `templates.test.ts`, `billing-security.test.ts`, `payments-backend/src/adversarial.test.ts` |
| TC-N-06-03 | unit и конвейер доставки | Имя `<img src=x onerror="alert(1)">Fleet`: в HTML `&lt;img…`, тега `<img` нет, subject — текст. `https://evil.example/…`, `https://pay.outegro.dev.evil.example/…`, `https://user:pw@pay.outegro.dev/…`, `javascript:` → `action link not allowed`; в БД нет intent и inbox item, письма нет. При рендере чужая ссылка заменяется своей страницей | pass | `billing-security.test.ts`, `templates.test.ts` |
| Consumer path | RabbitMQ (Testcontainers) | `billing.payment-confirmed.v2` из `payments.events` и `security.google-linked.v1` из `identity.events` → письма в fake; повтор того же события второго письма не даёт | pass | `billing-security.test.ts` |
| Telegram привязан | webhook, fake Telegram | Одно письмо «К аккаунту подключён Telegram» и inbox item; в чат — только ответ бота; data intent — только `at` (ни chat id, ни токена) | pass | `telegram-admin.test.ts` |
| Превью и redaction | admin API | Все 15 шаблонов EN/RU отдают превью из `sample`; billing data видна оператору целиком, IP в security скрыт | pass | `telegram-admin.test.ts`, `templates.test.ts` |
| `pnpm exec biome check <изменённые файлы кода>` | worktree | exit 0 (docs вне области Biome по biome.json) | pass | — |
| `pnpm typecheck` в contracts, notifications-backend, payments-backend, auth-backend | worktree | exit 0 | pass | — |
| `pnpm test` packages/contracts | — | 2 файла, 20/20 | pass | — |
| `pnpm test` apps/notifications-backend | Testcontainers | 5 файлов, 63/63 (было 39) | pass | — |
| `pnpm test` apps/payments-backend | Testcontainers | 5 файлов, 104/104 (проверки сообщений добавлены в существующие тесты) | pass | — |
| `pnpm test` apps/auth-backend | Testcontainers | 5 файлов, 49/49 | pass | — |
| `python tools/documentation/validate.py` | — | pass | pass | — |

## Ограничения и незавершённое

1. Реальные Resend и Telegram не вызывались; карточка real-provider evidence не требует.
2. Порядок выката: notifications-backend раньше payments-backend и auth-backend. Старый notifications отправит новые ключи в DLQ как `unknown template`, их придётся переиграть. Сообщения v1 от старого payments новый notifications показывает.
3. Время в UTC: часового пояса получателя нет в Identity. Если он появится в профиле, форматирование меняется в `templates/format.ts`.
4. Схемы data живут в notifications-backend, payments проверяет форму своими тестами. Общей схемы в contracts нет: смена формы — обе стороны и новый ключ.
5. Снимок шаблонов снят на Node 26; сравнение нормализует пробелы ICU. Форматы ru/en дат и валют в Node 24 те же (на них же держатся тесты pay-web), но первый прогон CI это подтвердит.
6. id-web inbox не показывает ссылку действия (область N-05); ссылка есть в письме.
7. Inbox API падает на неизвестном ключе шаблона (было и до N-06); поэтому откат notifications-backend после появления сообщений с новыми ключами недопустим, только forward-fix. Защитный рендер — follow-up.
8. Статусы зависимостей в `task-index.json` не отражают реализованный код (см. Dependency evidence).

## Откат

Данных и миграций задача не добавляет. Откат — revert коммитов в обратном порядке: сначала payments-backend и auth-backend (перестают слать новые ключи), затем notifications-backend, и только пока в inbox нет сообщений с новыми ключами (п. 7). После этого — forward-fix. Финансовые записи не затрагиваются.

## Следующая задача / resume point

N-06: все шаги C1–C4 выполнены. Следующее: QA и слияние ветки ведущим, выкат notifications-backend первым, затем перевод карточки в `done`. Follow-up: уведомление о входе с нового устройства (решение о признаке устройства в Identity), защитный рендер inbox для неизвестного ключа, ссылка действия в inbox id-web (N-05), часовой пояс получателя.

## Приёмка ведущим (29.09)

Ветка слита в master двумя шагами: сначала contracts и notifications-backend (`7f939c2`), после их выката — payments и auth (`5060190`); при слиянии с веткой повторных покупок повторная покупка (`duplicate_purchase`) не получает квитанции, так как ничего не открывает (`b6e6d4d`). CI зелёный, выкачено в production.
