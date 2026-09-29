# @outegro/ui

Общая дизайн-система всех фронтендов outegro.dev (Next.js): токены, шрифты, стекло и компоненты на Radix + Tailwind 4. Исходники экспортируются напрямую — отдельная сборка не нужна.

## Подключение в новом Next.js-приложении

1. `package.json` приложения: `"@outegro/ui": "workspace:*"` (плюс `"@outegro/i18n": "workspace:*"`, если нужен общий язык).
2. `next.config.ts`: `transpilePackages: ["@outegro/ui", "@outegro/i18n"]`.
3. `postcss.config.mjs`: `{ plugins: { "@tailwindcss/postcss": {} } }`.
4. Корневой layout:

   ```tsx
   import { fontVariables } from "@outegro/ui/fonts"; // next/font/local
   import "@outegro/ui/styles.css"; // Tailwind + токены + base
   import "./globals.css";          // только раскладка приложения

   // …
   <html lang={locale} className={fontVariables}>
   ```

   Tailwind сам сканирует приложение, а `styles.css` добавляет в сканирование исходники пакета.

   Шрифты (`src/fonts.ts`) — файлы Fontsource через `next/font/local`: раздельно Latin и Cyrillic с их `unicode-range`, `display: swap`. Latin предзагружается и получает локальный запасной шрифт с подогнанными метриками (`adjustFontFallback`), поэтому замена шрифта не двигает раскладку; Cyrillic грузится по требованию и до загрузки использует тот же запасной. Исключение — JetBrains Mono: его запасной — системный моноширинный шрифт (та же фиксированная ширина знака), растянутый Arial переносил метки на вторую строку. Классы `fontVariables` задают переменные `--og-*`, из которых собраны токены `--font-sans`, `--font-display`, `--font-mono`.
5. Компоненты: `import { Button } from "@outegro/ui/button"`, `import { Dialog, DialogContent } from "@outegro/ui/dialog"` и т.д.

## Правила

- Только токены: `var(--foreground)`, `bg-primary`, `text-muted-foreground`, `border-border`. Сырые hex в приложениях запрещены — новый цвет добавляется в `src/styles/index.css` для обоих тонов.
- Тёмная секция или продукт: атрибут `data-tone="dark"` на контейнере. Токены и вариант `dark:` переключаются автоматически.
- Утилиты: `.og-container`, `.og-glass`, `.og-eyebrow`, `.og-accent`.
- Интерактивная цель — не меньше 44 px, фокус не отключать.
- Новые компоненты добавлять через shadcn CLI (`components.json`, стиль new-york, иконки Phosphor), затем привести к токенам и вариантам этого пакета.

## Состав

| Компонент | Назначение |
|---|---|
| Button | primary / secondary / outline / glass / ghost / destructive / link; размеры sm / md / lg / icon / icon-sm; `asChild` для ссылок |
| Dialog | модальное окно; `closeLabel` — переведённое имя кнопки закрытия |
| Accordion | раскрывающиеся списки |
| Input, Label | поля форм |
| Badge | моно-метка: outline / solid / glass / muted |
| Surface | карточка: solid / glass / muted / inverse (inverse включает тёмный тон) |
| Container | общая ширина страницы |
| LanguageSwitch | презентационный переключатель; к cookie его подключает `@outegro/i18n/client` (`useLocaleSwitch`) |

Проверка: `pnpm --filter @outegro/ui typecheck`; визуально — `/design-system` в landing-web.
