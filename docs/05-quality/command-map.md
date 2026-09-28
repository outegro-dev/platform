# Команды проверки

## Доступно сейчас

Из корня этого проекта:

```text
python tools/documentation/validate.py
python tools/documentation/task_context.py BOOT-01
python tools/documentation/task_context.py PAY-03 --bundle
```

Требуется Python 3.10+, только стандартная библиотека. `validate.py` проверяет docs/граф/карточки, не устанавливает пакеты и не обращается к VPS. Context helper читает файлы, не запускает описанные в них команды.

## Runtime commands — 28.09.2026

Из корня проекта, Node 24+, pnpm 12.3.4. Перед E2E выполнить build; браузеры устанавливаются `pnpm exec playwright install chromium firefox webkit`.

| Проверка | Scope | Будущая команда | Сейчас |
|---|---|---|---|
| Lint | App, UI, tests, configs | pnpm lint | available |
| Typecheck | Landing и импортируемый UI | pnpm typecheck | available |
| Unit | Domain package | Уточнить после harness | not_available |
| Integration | Ephemeral DB/broker | Уточнить после BE-03/06 | not_available |
| E2E | Production landing, Chromium/Firefox/WebKit | pnpm test --workers=1 | available; localhost:3100 |
| Build | Landing EN/RU + gallery | pnpm build | available |
| Helm render | infra/gitops | Уточнить по chart/version | not_available |

Старая основа использовала pnpm/Turbo/Biome/Vitest. Это reference, а не разрешение считать все старые scripts подходящими новой структуре.

`pnpm dev` запускает localhost:3000. `pnpm start` запускает существующий production build на том же порту. Одновременно на одном порту их не запускать. `pnpm format` применяет Biome fixes. `pnpm verify` запускает lint/typecheck/build/E2E. `node tools/quality/capture.mjs` требует работающий production preview на localhost:3000 и записывает screenshots и локальный RAF-профиль в evidence.

В тестовом окружении используется hostname localhost и стандартный dual-stack bind Next. Принудительный IPv4 bind с URL, нормализованным proxy в localhost, вызвал локальный цикл proxy и исчерпание временных сокетов Windows; конфигурация исправлена. Не интерпретировать такой startup failure как дефект страниц. Не менять системный dynamic port range ради тестов.
