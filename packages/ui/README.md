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
| Button | primary / secondary / outline / glass / ghost / destructive / link; размеры sm / md / lg / icon / icon-sm; `asChild` для ссылок; `pending` + `pendingLabel` — спиннер поверх сохранённой подписи: ширина не меняется, `aria-busy`, фокус остаётся (aria-disabled) |
| Dialog | модальное окно; `closeLabel` — переведённое имя кнопки закрытия |
| Accordion | раскрывающиеся списки |
| Input, Label | поля форм; фокус и ошибка меняют цвет рамки и тень, не её толщину |
| FormMessage | подсказка или результат под полем/кнопкой; всегда отрисован и резервирует `lines` строк, поэтому сообщение не сдвигает форму; тоны neutral / pending / success / error |
| Spinner | индикатор занятости; при reduced motion только пульсирует |
| Skeleton | заглушка загрузки размером с то, что она заменяет |
| Badge | моно-метка: outline / solid / glass / muted |
| Surface | карточка: solid / glass / muted / inverse (inverse включает тёмный тон) |
| Container | общая ширина страницы |
| LanguageSwitch | презентационный переключатель; к cookie его подключает `@outegro/i18n/client` (`useLocaleSwitch`) |
| AccountMenu | меню аккаунта и платформы в шапке приложения: кто вошёл, аккаунт на id., покупки и подписки на pay., другие приложения (админка — только с платформенной ролью), портфолио и выход из этого приложения; без входа — кнопка «Войти» |

## Меню аккаунта и ссылки между приложениями

`@outegro/ui/lib/platform` — данные без React: адреса приложений (`PlatformUrls`, production по умолчанию в `productionPlatformUrls`), страницы (`pageHref(urls, "subscriptions", { returnTo })`), модель меню и его тексты EN/RU. Пакет ничего не запрашивает и не читает env: приложение берёт адреса из своей конфигурации, а пользователя — так, как уже знает его (BFF и `/v1/me` Identity).

```tsx
<AccountMenu
  user={me && { name: me.displayName, email: me.email, roles: me.roles }} // null — «Войти»
  current="battleship"              // свои страницы — относительные ссылки
  urls={platformUrls}               // { site, id, pay, battleship, admin }
  locale={locale}                   // "en" | "ru", из локали приложения
  signInHref="/auth/sign-in?returnTo=%2F"
  signOut="/auth/sign-out"          // POST-маршрут или server action
  returnTo={env.APP_URL}            // pay. покажет «Вернуться в …»
/>
```

- Кнопка меню по WAI-ARIA (Radix DropdownMenu): Enter, Space и стрелки открывают, стрелки и ввод букв двигают по пунктам, Escape закрывает и возвращает фокус на кнопку. Пункты — обычные ссылки, цель — 44 px.
- Админка видна при любой роли из `platformRoles` (`hasPlatformRole` в `@outegro/contracts/access`); это только подсказка навигации, права проверяют консоль и сервисы.
- Ссылки на pay. получают `?return=<returnTo>`; pay-web принимает его только для origin из своего списка приложений платформы.
- `compact` оставляет аватар без имени (когда имя в шапке уже есть); `onSignOutSubmit` может отменить выход (например, офлайн).

Проверка: `pnpm --filter @outegro/ui typecheck`, `pnpm --filter @outegro/ui test`; визуально — `/design-system` в landing-web.
