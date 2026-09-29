# HTTP contract v1

## Общий формат

Проектный API prefix `/v1`. Public browser requests проходят через BFF своего origin. Для получения текущего пользователя клиент не присылает trusted userId; server извлекает его из verified session. Machine APIs имеют отдельную аутентификацию и audience.

```json
{
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "messageKey": "errors.idempotencyConflict",
    "fieldErrors": {},
    "requestId": "req-test-001",
    "retryable": false
  }
}
```

Успех: предметный DTO, без обязательного дополнительного `data.data`. Ошибки: 400 validation, 401 no/expired session, 403 insufficient permission, 404 resource not visible, 409 version/idempotency conflict, 422 unsupported business transition, 429 bounded rate limit, 503 dependency unavailable. Ошибки не содержат stack/SQL/token/provider credential. Для приватных ресурсов политика 404 vs 403 единообразна в конкретном API, тест проверяет отсутствие раскрытия данных, а не случайный статус.

Предметные коды уточняют статус; клиент выбирает текст по `code`, а не по `fieldErrors`. Список кодов — `packages/contracts/src/errors.ts`.

| Code | HTTP | Когда | Клиент |
|---|---|---|---|
| `ALREADY_OWNED` | 422 | `POST /v1/checkout` продукта, который у покупателя уже есть: активная разовая покупка или подписка, которую Lava ещё может продлить (active, past_due, cancel_requested). `fieldErrors.productKey`: `already owned` или `already subscribed`; `retryable: false` | pay-web и магазин Battleship показывают EN/RU «это у вас уже есть», новый заказ не создаётся |

## IDs, даты и денежные значения

Внутренние IDs — opaque UUID strings; клиент не вычисляет business meaning по ID. Примеры `user-a` в тестах — aliases фикстур, не valid UUID. DB-generated fixtures преобразуют alias в стабильный UUID. UTC ISO timestamps с `Z`, БД timestamptz. Clock передаётся в use case для expiry tests; реальный wall clock не подменяется в production.

Деньги в DTO: `{ "minor": "12345", "currency": "USD", "scale": 2 }`. Minor — строка целого числа, чтобы JSON/JS не теряли bigint точность. Scale берётся из supported currency metadata на сервере, не доверяется input клиента. Внутри БД bigint/exact numeric. Normalizer внешнего decimal отказывается от неподдержанного scale вместо округления по умолчанию. Frontend Number допустим только для безопасного форматирования после проверки диапазона, не для расчётов.

## Конкуренция и повторы

Mutating commands с внешним эффектом принимают `Idempotency-Key`. Scope ключа: authenticated actor + action + environment. Хранится request fingerprint. Повтор того же input возвращает тот же logical result; другой input даёт 409. Дедупликация не пропускает authorization. Financial source keys хранятся столько, сколько нужен соответствующий журнал; TTL transport response cache не удаляет доменную уникальность.

Редактируемые агрегаты принимают `expectedVersion` целым числом. SQL update/lock проверяет version атомарно. Conflict возвращает актуальную version или instructs refetch, без молчаливого last-write-wins для финансов/ролей/items.

## Пагинация

Cursor opaque, page size default 25/max 100 как инженерный default. Сортировка по createdAt+id обеспечивает tie-breaker. Фильтры входят в cursor fingerprint; invalid cursor даёт validation error. Итоги по валютам вычисляются по явно указанному scope и периоду, а не суммированием текущей страницы UI.

## Proposed endpoint map

| Owner | Route/use case | Input | Output / проверка |
|---|---|---|---|
| Identity | POST /v1/login/challenges | email, locale | challengeId, expiresAt, resendAfter, deliveryStatus; нейтральный ответ |
| Identity | POST /v1/login/challenges/verify | challengeId, code | server session; атомарный consume |
| Identity | GET/PATCH /v1/me | displayName/locale/expectedVersion для PATCH | own profile; anchor email отдельно |
| Identity | GET /v1/me/sessions | cursor | own devices |
| Identity | DELETE /v1/me/sessions/{id} | session ID | revoked; ownership |
| Identity | POST /v1/me/sessions/revoke-all | commandId | все sessions отозваны |
| Identity | SSO endpoints | По выбранной protocol library | Не изобретать OIDC wire format в этом документе |
| Identity | GET /v1/login/google/config | — | `enabled`, `clientId`, `redirectUri` для запроса авторизации в id-web |
| Identity | POST /v1/login/google | code, codeVerifier, nonce, locale | как verify email-кода; новый Google-аккаунт → новый user; совпавший email → 409 `email: link_required` (без слияния) |
| Identity | GET /v1/me/identities, POST/DELETE /v1/me/identities/google | code, codeVerifier, nonce для привязки | привязка только из своей сессии; чужой Google → 409 `identity: in_use`; последний способ входа → 409 `identity: last_method` |
| Notifications | GET /v1/me/inbox | cursor/category | own inbox + unread |
| Notifications | POST /v1/me/inbox/{id}/read | item ID | idempotent readAt |
| Notifications | GET/PATCH /v1/me/notification-preferences | version/preferences | saved version |
| Notifications | GET/DELETE /v1/me/telegram, POST /v1/me/telegram/link | — | статус привязки; одноразовая ссылка `t.me/<bot>?start=…` на 10 минут; отвязка |
| Notifications | POST /webhooks/telegram | update Telegram; заголовок `X-Telegram-Bot-Api-Secret-Token` | `/start <token>` привязывает чат, `/stop` и блокировка бота отвязывают |
| Notifications | GET /v1/admin/overview, /deliveries, /deliveries/{id}, /recipients/{userId}, /templates, /templates/{key}/preview, /settings, /telegram | `notifications.read` | сводка, доставки (данные login-кодов и секретов скрыты), карточка получателя (почта замаскирована), превью на примерах |
| Notifications | POST /v1/admin/deliveries/{id}/retry, POST /v1/admin/test-message | `notifications.retry`; reason; `confirmUnknown` для unknown | повтор только failed/unknown, не auth, не просроченных; проверка канала — только себе |
| Notifications | PATCH /v1/admin/settings | `services.flags`; expectedVersion, reason | пауза канала: доставки ждут в pending до возобновления |
| Notifications | GET /v1/admin/audit | `audit.read` | действия операторов с причинами |
| Payments | GET /v1/catalog | — | активные продукты с текущими ценами (title/description en+ru), checkoutEnabled |
| Payments | POST /v1/checkout | productKey, currency, returnUrl?; Idempotency-Key обязателен | orderId, attemptId, state, status, paymentUrl при готовности; неоплаченный checkout того же продукта и валюты возвращается при любом ключе; уже купленное — 422 `ALREADY_OWNED` |
| Payments | GET /v1/me/orders | cursor | own orders с checkout и access |
| Payments | GET /v1/me/orders/{id} | ID | own payment/access state |
| Payments | GET /v1/me/subscriptions | cursor | own periods/paidUntil/accessUntil |
| Payments | POST /v1/me/subscriptions/{id}/cancel | — (повтор без нового эффекта) | cancel state; не refund; свежая проверка аккаунта: suspended → 403 |
| Payments | POST /webhooks/lava | provider body; X-Api-Key | durable ack; не browser session |
| Payments | GET /v1/admin/{orders,payments,subscriptions,provider-events,issues,grants,refunds,stats} | фильтры, cursor | billing.read |
| Payments | POST /v1/admin/grants, /v1/admin/grants/{id}/revoke | userId/service/feature/validUntil?, reason | grants.assign, audit; отзыв grant подписки отменяет и продление в Lava, отзыв стоит при любом ответе Lava |
| Payments | POST /v1/admin/subscriptions/{id}/cancel | reason | subscriptions.cancel, audit; пока Lava не подтвердила отмену, повтор отправляет её снова |
| Payments | POST /v1/admin/payments/{id}/refund-request, /v1/admin/refunds/{id}/match | reason (+paymentId) | refunds.request, audit |
| Admin | POST /v1/commands/{allowedAction} | resourceId, reason, commandId, expectedVersion | typed result/jobId; action allowlist |
| Assistant | POST /v1/items | typed fields + source | itemId/version; machine scope + owner gate |
| Assistant | PATCH /v1/items/{id} | expectedVersion, allowed fields | saved item/version |
| Assistant | POST /v1/listings/{id}/publish-intents | draftVersion, target, commandId | intent state; не мгновенный success |

Точная SSO схема и API route annotations закрываются ID-04/BE-04 до подключения клиентов. При изменении route обновлять typed client/fixtures вместе, не редактировать только UI.
