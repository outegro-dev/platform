@AGENTS.md

# Claude Code notes

Всё выше (AGENTS.md) обязательно и для Claude Code. Ниже — только специфика Claude Code.

## Skills проекта (`.claude/skills/`)

| Skill | Когда использовать |
|---|---|
| `find-docs` | Любой вопрос про API/настройки/миграцию библиотеки, фреймворка, SDK, CLI, облака. Реализует правило Context7 из AGENTS.md через `npx ctx7@latest`. |
| `taste-skill` | Перед созданием или переработкой UI-секций лендинга и интерфейсов сервисов. |
| `image-to-code-skill` | Когда есть макет/скриншот (см. `docs/08-references/design/`) и его нужно перенести в код. |
| `web-design-guidelines` | Ревью UI: доступность, фокус, формы, анимации, типографика. |
| `playwright-cli` | Проверка страниц в браузере, скриншоты desktop/mobile, запись evidence в `docs/09-evidence/`. |

Context7 также подключён как MCP-сервер в `.mcp.json`. Если MCP недоступен — использовать CLI `npx ctx7@latest` по правилам AGENTS.md (не более трёх команд на вопрос, без секретов в запросах).

## Порядок работы в Claude Code

1. Начинать с `docs/00-start-here/README.md` и карточки задачи: `python tools/documentation/task_context.py <TASK-ID>`.
2. UI: сначала `DESIGN.md`, затем `apps/landing-web/AGENTS.md` (Next.js 16 отличается от данных обучения — читать `node_modules/next/dist/docs/`).
3. После изменений: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test --workers=1`, `python tools/documentation/validate.py`.
4. Legacy `C:\Users\working\Desktop\outegro` и VPS `46.37.123.17` — только чтение. Никаких изменений на сервере без явного поручения владельца в чате.
5. Отчёт по `docs/07-templates/task-report.md`; статус задачи менять только после доказательств.
