# Nick Lukashik · outegro.dev

Подробный план реализации личного портфолио и платформы приложений. Версия документации 0.3, 27 сентября 2026.

Реализованы лендинг EN/RU и начальный общий пакет UI. План backend/инфраструктуры остаётся отдельным следующим этапом. Текущее состояние и ограничения: [отчёт реализации](docs/09-evidence/landing-build/report.md).

## Локальный запуск

Node.js 24+ и pnpm 12.3.4. Из корня:

```text
pnpm install --frozen-lockfile
pnpm dev
```

Лендинг: http://localhost:3000/. Язык (EN по умолчанию / RU) хранится в cookie `og_locale`, URL не меняется.
Галерея UI: http://localhost:3000/design-system. Кадры 3D-сцен: http://localhost:3000/design-system/scenes.
Пробы: http://localhost:3000/health и `/health/deep`.

Production preview: `pnpm build`, затем `pnpm start`. Запускается standalone `server.js`, как в контейнере.
Проверки: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test --workers=2`.
Перед первым E2E: `pnpm exec playwright install chromium firefox webkit`.
E2E поднимает отдельную production-сборку на localhost:3100; backend и внешние ключи не нужны.
Постеры 3D после изменения сцен (нужен запущенный :3000): `node tools/quality/render-posters.mjs`.

Решения по дизайну, анимации, языку и CSP: [DESIGN.md](DESIGN.md). Дизайн-система: [packages/ui/README.md](packages/ui/README.md).

## Подробный план платформы

- **[Что дальше: ревью и этапы с чекпоинтами](docs/00-start-here/next-steps.md)**
- [Начать здесь](docs/00-start-here/README.md)
- [Контекст проекта](docs/00-start-here/project-context.md)
- [Порядок исполнения](docs/00-start-here/execution-protocol.md)
- [Главы спецификации](docs/01-specification/README.md)
- [Контракты и инварианты](docs/02-contracts/README.md)
- [Решения и открытые входные данные](docs/03-decisions/README.md)
- [Этапы и задачи](docs/04-delivery/README.md)
- [Тестовая стратегия](docs/05-quality/README.md)
- [Runbooks](docs/06-operations/README.md)
- [Шаблоны](docs/07-templates/README.md)
- [Исследование и презентация](docs/08-references/README.md)

Порядок продукта: лендинг и дизайн-система, затем сервисы и инфраструктура, интеграция, общий production на одном K3s, затем отдельное ТЗ морского боя. Hermes должен быть готов до игры; план предлагает включить его в первый общий выпуск.

Получить контекст одной задачи: `python tools/documentation/task_context.py BOOT-01`. Проверить целостность документации: `python tools/documentation/validate.py`. Эти команды работают только с документацией и не запускают deployment.
