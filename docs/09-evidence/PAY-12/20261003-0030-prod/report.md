# Отчёт PAY-12: проверка на настоящем аккаунте Lava

- Статус: pass (TC-PAY-12-01, TC-PAY-12-02); TC-PAY-12-03 не применим — merchant настроен.
- Task card: [PAY-12](../../../04-delivery/05-payments/tasks/PAY-12.md)
- Environment: production, lava.top (боевой аккаунт), payments-backend. Контрольные операции выполнил владелец: покупка Battleship Premium (USD 0.59, ежемесячно) 29.09.2026 15:01 UTC, отключение продления в pay.outegro.dev 01.10.2026 01:13 UTC. В отчёте нет секретов, адресов почты и полных идентификаторов.

## TC-PAY-12-01 Provider contract — pass

Запрос к базе payments по единственному событию провайдера:

| Проверка | Результат |
|---|---|
| `checkout_attempts.provider_invoice_id` = `contractId` вебхука | да |
| `payments.provider_contract_id` = `contractId` | да |
| `subscriptions.provider_parent_contract_id` = `contractId` | да |
| платёж, подписка и событие относятся к одному заказу | да |
| grant: источник — эта подписка, `active` | да |
| подписка `cancelling`, `auto_renew = false`, `cancelled_at` записан | да — Lava подтвердила отмену ответом на `DELETE /api/v1/subscriptions` |

Префикс договора `8c0a9703…`. Доступ сохраняется до конца оплаченного периода (29.10).

## TC-PAY-12-02 Отличие от fixture — нет отличий

Настоящий вебхук (`payment.success`, сохранён 29.09 15:01:17) содержит ровно поля fixture `lavaPayloads.paymentSuccess` (`apps/payments-backend/src/test/lava-payloads.ts`, OpenAPI 1.22.0): `amount` (число), `buyer.email`, `contractId`, `currency` (`USD`), `errorMessage`, `eventType`, `product.id`, `product.title`, `status` (`subscription-active`), `timestamp`; `parentContractId` у первой оплаты нет. Fixture менять не нужно; тесты парсера и системный тест R-02 используют ту же форму.

## Не проверялось

- Возврат денег через Lava (вебхук `payment.refund`) — в критерии карточки не входит; формат взят из OpenAPI и проверен тестами на fixture. Проверить на реальном аккаунте можно при первом настоящем возврате.
