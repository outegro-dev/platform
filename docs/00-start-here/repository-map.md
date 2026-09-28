# Карта текущих и будущих файлов

## Сейчас

В этом корне только документация, research snapshots и инструменты проверки документации. Не путать будущие пути ниже с существующим кодом.

## Целевая структура после BOOT

```text
outegro-dev-showcase/
  AGENTS.md
  README.md
  apps/
    landing-web/
    id-web/
    auth-backend/
    notifications-backend/
    pay-web/
    payments-backend/
    admin-web/
    admin-backend/
    assistant-store/
  packages/
    ui/
    contracts/
    config/
    testkit/
  infra/
    local/
    gitops/
    agents/hermes/
  tests/
    integration/
    e2e/
    fixtures/
  docs/
    00-start-here/
    01-specification/chapters/
    02-contracts/
    03-decisions/adr/
    04-delivery/<stage>/tasks/
    05-quality/
    06-operations/
    07-templates/
    08-references/
    09-evidence/<task-id>/<run-id>/
  tools/documentation/
```

## Старый проект, только чтение

Корень `C:\Users\working\Desktop\outegro`. BOOT-02 делает явный inventory до переноса отдельных файлов. Не копировать `.env`, kubeconfig, ключи, node_modules, .git, uploads, базы, build outputs или GitOps Secret manifests без проверки. Не копировать весь репозиторий одной командой.

| Область | Реально исследованный путь относительно старого корня | Использование |
|---|---|---|
| Workspace | monorepo/package.json | pnpm/Turbo/Biome команды как reference |
| Landing | monorepo/apps/landing-web | Структура Next и i18n, без старого брендинга |
| Account | monorepo/apps/id-web | Вход/профиль; проверить stale locale logic |
| Auth | monorepo/apps/auth-backend/src | Session/code/passkey/provider логика |
| Auth schema | monorepo/apps/auth-backend/prisma/schema.prisma | Исходные сущности, не миграция данных |
| Entitlements | monorepo/apps/auth-backend/src/auth/entitlements.service.ts | Найденное смешение paid grants и roles |
| Tokens | monorepo/apps/auth-backend/src/tokens/tokens.service.ts | Проверить refresh race, ES256/JWKS |
| Notifications | monorepo/apps/notifications-backend/src/notify | Claim/send/record окно дублей |
| Templates | monorepo/apps/notifications-backend/src/emails | Дизайн писем, локализация, secret handling |
| Payments | monorepo/apps/payments-backend | Scaffold; готового billing domain нет |
| UI/contracts | monorepo/packages/ui и contracts | Полезные primitives после ревизии |
| GitOps | gitops/charts/outegro-service | Chart и Prisma migration hook для замены |
| Runtime values | gitops/values | Reference для новых limits, не готовые 8-GB values |

Budget/trips/itmaxxing не входят в новый scope. Их бизнес-код не переносить ради заполнения портфолио.

## Future module ownership

`apps/<backend>/src/<domain>/` содержит use cases и adapters; `db/schema/` и `db/migrations/` принадлежат этому сервису. Общие contracts содержат DTO/events, но не доступ ко всем БД. UI package не импортирует server credentials. Admin обращается к domain APIs. Assistant-store владеет каталогом вещей; Hermes не получает SQL credential остальных сервисов.
