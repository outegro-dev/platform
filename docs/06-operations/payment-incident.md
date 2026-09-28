# Пользователь оплатил, но доступа нет

1. Найти order по точному ID, не только email. Записать userId, providerInvoiceId, correlationId.
2. Проверить authoritative provider fact и local Payment. Не доверять browser return screenshot как подтверждению.
3. Проверить amount/currency/mapping. При mismatch открыть issue, не менять paid вручную.
4. Проверить FinancialEntry и CommercialGrant. Если факт ещё не обработан, выполнить разрешённую idempotent reconciliation command.
5. Если grant есть, проверить outbox confirm и Identity inbox/projection version. Replay исходного eventId либо authoritative rebuild, не произвольный role=pro.
6. Проверить validFrom/validUntil, другие источники и user status.
7. Проверить notification отдельно: отсутствие письма не означает отсутствующую оплату.
8. Сохранить reason/evidence/commandId и ответ пользователю с фактическим состоянием.

Если invoice create timeout: state unknown, найти provider result по подтверждённому recovery contract, не повторять POST вслепую. Если refund без source: unmatched и ручное verified сопоставление с evidence; не выбирать первую подходящую сумму.
