# ADR-005: Lava adapter

Status: proposed capability-by-capability validation.

Провайдер Lava.top выбран владельцем. Снимок OpenAPI 1.22.0 и портал от 27.09.2026 — отправная точка. Adapter изолирует camelCase payment/subscription и snake_case envelope refund/chargeback. Basic/X-Api-Key webhook auth. Внешний API key и inbound webhook credential раздельные.

Неизвестные: sandbox, create idempotency/recovery, period boundaries, refund source mapping/initiation API, merchant balance. PAY-01 формализует fixtures, PAY-12 проверяет merchant. Неоднозначный refund — issue; timeout create — unknown. Неопределённость не разрешается выдуманным endpoint.
