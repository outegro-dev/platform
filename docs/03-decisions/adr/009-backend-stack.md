# ADR-009: стек backend-платформы

Status: accepted, согласовано с владельцем 28.09.2026. Версии проверены по npm, GitHub и документации Nest (Context7) на эту дату; при установке закрепляются точные.

## Решения

| Область | Решение | Почему |
|---|---|---|
| Язык | TypeScript **6.0.3** во всём монорепо | CLI/schematics Nest 12 требуют TS 6; `@nestjs/swagger` 12 объявляет `^5.5 \|\| ^6`. TS 7 (Go) — после официальной поддержки экосистемой Nest |
| Фреймворк | **NestJS 12** + platform-express, ESM | дефолт Nest 12; Express проще для cookies/passkeys |
| Валидация | встроенный `StandardSchemaValidationPipe` + **Zod 4**, `@Body({ schema })` | Standard Schema в ядре Nest 12; `class-validator` и `nestjs-zod` не используются |
| OpenAPI | `@nestjs/swagger` 12 из тех же Zod-схем | одна схема на валидацию и документацию |
| Конфиг | `@nestjs/config` 12: папка `src/config/` в каждом сервисе — `env.schema.ts` (Zod), `config.ts` (группы `registerAs`), `config.module.ts` (global). Общие схемы — `packages/nest-common/config` | идея отдельного config-модуля из polished-service/nest-api, реализация на Nest 12. Секреты без дефолтов, невалидный env — падение на старте |
| Логи | **nestjs-pino** 5 + pino 10, JSON в stdout, redaction | request/trace id в каждой строке, HTTP access log. `@nestjs/observe` не используется — это клиент внешнего SaaS |
| ORM | **Drizzle ORM** 0.45 + drizzle-kit 0.31, драйвер `pg` | замена Prisma; отдельная БД и роль на сервис |
| Очереди | **RabbitMQ 4**, свой модуль на `amqp-connection-manager` + `amqplib`; outbox/inbox; ретраи через TTL-очереди + DLQ | `@golevelup/nestjs-rabbitmq` не объявляет Nest 12 |
| Кэш/сессии | **Valkey 9** + ioredis 6 | открытая лицензия BSD, совместим с Redis по протоколу и командам |
| Rate limit | C + E + D: `@nestjs/throttler` 6.7 со **своим хранилищем в Valkey** (Lua INCR+PEXPIRE); точечные лимиты входа в auth (код 10 мин, 5 попыток, повтор ≥ 60 с, по email и IP); грубый лимит по IP в Traefik | готовый `@nest-lab/throttler-storage-redis` не поддерживает Nest 12; память процесса обнуляется при деплое |
| JWT | **jose 6**, ES256 + JWKS | как в legacy |
| Passkeys | @simplewebauthn/server и browser **14** | — |
| Google OAuth | **arctic 3** (PKCE + state) | — |
| Email | **Resend** + react-email 6; локально Mailpit | решение владельца |
| Telegram | **grammY** 1.46 | официальной Node-библиотеки у Telegram нет; grammY — самая активная, TypeScript-first |
| Метрики | prom-client 15 + ServiceMonitor на каждый сервис | — |
| Трейсинг | OpenTelemetry SDK, экспорт выключен до spike Tempo | — |
| Тесты | Vitest 5 (дефолт Nest 12), Testcontainers 12 в CI, Playwright | — |
| Линтер | Biome 2.5 (не oxlint) | единый инструмент для всего монорепо |

## Инфраструктура

K3s 1.37 (single node), Traefik 3.7, cert-manager 1.21 (Cloudflare DNS01, wildcard), Sealed Secrets, Argo CD 3.5, CloudNativePG 1.30 (PostgreSQL 18, barman-cloud → R2), RabbitMQ cluster-operator 2.23, Valkey 9 StatefulSet (AOF), kube-prometheus-stack 91, Loki 3.7 + Alloy 1.20, внешний uptime-check. Все сервисы в одной реплике (ADR-001).

## Valkey против Redis

Плюсы Valkey: лицензия BSD-3 без ограничений, управление Linux Foundation (AWS, Google, Oracle), managed-версии в AWS и GCP, многопоточный I/O и экономия памяти в 8.x/9.x. Минусы: меньше материалов и сообщества, модули (JSON, Search, Bloom) отдельные, а не встроенные как в Redis 8, со временем возможно расхождение новых команд. Для платформы используются только базовые команды (strings, hashes, TTL, Lua, pub/sub) — идентичные.

## Не используем

Prisma, class-validator, nestjs-zod, `@golevelup/nestjs-rabbitmq`, `@nest-lab/throttler-storage-redis`, `@nestjs/observe`, BullMQ, Kafka/NATS, Fastify, Jest, TypeScript 7 (пока).

## Пересмотр

TS 7 — когда `@nestjs/cli` и `@nestjs/swagger` объявят поддержку. Готовые адаптеры RabbitMQ/throttler — если выйдут версии под Nest 12 и свой код станет обузой.
