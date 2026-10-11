# UI kit в Figma и Claude Design

11.10.2026, issue #114. Как превратить `@outegro/ui` (React-компоненты, CSS-токены, темы gallery и zine) в визуальные компоненты, из которых можно собирать макеты в Figma и в Claude Design. Цены и ограничения взяты со страниц из раздела «Источники» на эту дату. Пункты без ссылки — выводы из кода репозитория.

## Решение коротко

- Источник правды — код `packages/ui`. Figma и Claude Design получают из него копии, и правки в этих копиях в кит обратно не попадают.
- Claude Design не требует Figma: дизайн-система собирается прямо из кода командой `/design-sync` в Claude Code. Это первый и самый дешёвый шаг.
- Для Figma нужны две вещи. Первая — токены, выгруженные из CSS в JSON формата DTCG и импортированные в Figma Variables. Вторая — компоненты, которые агент в Claude Code собирает через Figma MCP (`use_figma`) по живой странице `/design-system`.
- Storybook + story.to.design и Code Connect пока не нужны: они окупаются, когда над китом работает команда. В конце документа описано, когда к ним вернуться.

## Что есть в ките

- **19 компонентов** (`packages/ui/src/components`): Button (7 вариантов × 5 размеров + `pending`), Badge (4 варианта), Surface (4), Notice (5 тонов), StatePanel, FormMessage (4 тона), Input, Label, Tabs (line / pill), ToggleGroup (chip / segmented × sm / md), Progress (тон × размер), CopyButton, Dialog, Accordion, Spinner, Skeleton, LanguageSwitch, AccountMenu, Container. Варианты описаны через `cva`, поэтому имена свойств и значений готовы и для component set в Figma.
- **Токены gallery** (`src/styles/index.css`, ≈70 без Tailwind-обёрток `@theme inline`): цвета, статусы и их мягкие заливки, радиусы, тени, стекло, длительности и easing. Светлый тон задан в `:root`, тёмный — в `[data-tone="dark"]`. Игровая палитра морского боя (`--sea-*`, `--ship-*`, `--mark-*`) имеет режимы day и night (`data-sea="night"`).
- **Тема zine** (`src/styles/zine.css`, ≈60 токенов): бумага, чернила, spot-цвета, 13 шрифтовых ролей, радиусы 0–4 px и жёсткие тени. Включается через `data-theme="zine"`, у темы есть свой тёмный тон. Лендинг уже работает в zine. Остальные приложения переходят на неё в порядке id → battleship → admin → edu → pay, поэтому zine становится основной темой библиотеки.
- **Шрифты**: 16 семейств. В gallery это Manrope, Cormorant Garamond и JetBrains Mono, в zine — ещё 13 (Old Standard TT, Ruslan Display, Unbounded, Playfair Display, Lobster, Rubik Mono One, Rubik Dirt, Rubik Wet Paint, Rubik Glitch, Press Start 2P, PT Mono, Pangolin, Caveat). Все файлы из Fontsource (лицензия OFL), то есть те же шрифты, что в Google Fonts.
- **Внешний вид zine задан в CSS, а не в компонентах**: стили цепляются к атрибутам `data-slot`. Сюда относятся наклон кнопок и бейджей (`rotate`, который чередуется через `:nth-of-type` и `:nth-child`), подъём и увеличенная тень при наведении, «вдавливание» при нажатии, кнопки в верхнем регистре, зерно (SVG `feTurbulence`) и растровые точки на фоне, тень текста у `.og-accent` и пунктирный фокус. Если строить компоненты Figma только по исходникам `.tsx`, всё это потеряется. Нужен ещё и снимок отрисованной страницы.
- **Галерея**: `/design-system` в `apps/landing-web`, отрисована в zine. На ней все компоненты, состояния, статусные токены и подсветка целей касания. Подстраницы `paper`, `sahur` и `scenes` — лаборатории анимаций, к киту они не относятся.

## Что Figma может принять

- Переменные бывают четырёх типов: color, number, string и boolean. Их можно привязать к заливкам, обводкам, стопам градиента, цвету и числовым параметрам теней, размерам, отступам, радиусам, толщине обводки, прозрачности и типографике (семейство, начертание, кегль, интерлиньяж, трекинг) ([Apply variables](https://help.figma.com/hc/en-us/articles/15343107263511-Apply-variables-to-designs)). Значит, тона light/dark и темы gallery/zine можно сделать режимами (modes) коллекции.
- Число режимов на коллекцию зависит от плана: на Starter режимов нет, на Professional до 10, на Organization до 20, на Enterprise без ограничений ([Plans and features](https://help.figma.com/hc/en-us/articles/360040328273-Figma-plans-and-features)). Нам нужно 4 режима (gallery light/dark, zine light/dark) плюс 2 для моря, так что хватит Professional.
- Наклона (rotation), регистра текста и фоновых текстур в списке привязываемых свойств нет. Наклон задаётся у экземпляра, регистр — в текстовом стиле, текстуры — заливкой-изображением. Наведение, нажатие, фокус, disabled и pending делаются отдельными значениями свойства `state` в component set.
- Шрифты: в Figma встроены сотни Google Fonts, но не все. Недостающие можно поставить локально как TTF или OTF, а раздать всей команде — только на Organization и Enterprise ([Add a font](https://help.figma.com/hc/en-us/articles/360039956894-Add-a-font-to-Figma)). Все 16 семейств нужно проверить в списке шрифтов Figma.

## Варианты

### A. Claude Design из кода (`/design-sync`)

- Дизайн-систему в Claude Design можно собрать из репозитория, скриншотов, файлов дизайна, презентаций и отдельных ассетов. Для кита на React есть команда `/design-sync` в Claude Code, которая читает токены и компоненты прямо из кода. Дизайн-системы — в бете на Pro, Max, Team и Enterprise ([Set up your design system](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design)).
- В Claude Code синхронизация идёт по одному компоненту, без полной замены. Превью каждого компонента — HTML-карточка с маркером `<!-- @dsCard group="…" -->` (так описан инструмент DesignSync в Claude Code на этой машине).
- Отдельный сайт claude.ai/design закрывается 14.12.2026. Claude Design остаётся шаблоном артефактов, доступным в чате, в Claude Code и на вкладке Artifacts. Готовый дизайн экспортируется в zip, PDF, PPTX, Google Slides, HTML, Canva, Miro и другие сервисы или передаётся в Claude Code. Экспорта в Figma в списке нет ([Get started](https://support.claude.com/en/articles/14604416-get-started-with-claudae-design)), поэтому перенести дизайн из Claude Design в Figma можно только снимком (вариант C).

### B. Токены → Figma Variables

- **Откуда брать токены.** Небольшой скрипт разбирает `index.css` и `zine.css` и пишет JSON в формате DTCG. CSS остаётся первоисточником, а тест проверяет, что JSON не отстал от CSS.
- **Нативный импорт.** Импорт и экспорт переменных в формате DTCG анонсировали на Schema 2025. В декабре 2025 функция ещё раскатывалась не на все аккаунты ([форум](https://forum.figma.com/ask-the-community-7/native-variable-export-feature-47831)), поэтому её наличие нужно проверить в своём аккаунте. Повторный импорт в существующий режим обновляет значения и не плодит дубли ([obra studio](https://figma.obra.studio/design-tokens-community-group-w3c-release/)).
- **Плагины.** Tokens Studio умеет синхронизировать токены с Figma Variables, но только на платном тарифе Pro. Составные токены (тени целиком, типографика) он пропускает ([docs](https://docs.tokens.studio/figma/export/variables-skipped), [pricing](https://tokens.studio/pricing)). Пример от самой Figma, [variables-import-export](https://github.com/figma/plugin-samples/tree/main/variables-import-export), поддерживает только color, number и alias.
- **Style Dictionary** нужен для обратного направления, JSON → CSS. Формат DTCG он поддерживает с v4, но версию спецификации 2025.10 — пока не полностью ([DTCG](https://styledictionary.com/info/dtcg/)). Понадобится, только если первоисточником станет JSON.
- **Variables REST API** доступен только на Enterprise ([REST API](https://developers.figma.com/docs/rest-api/variables)), поэтому синхронизацию из CI через него не сделать.
- **Через агента.** `use_figma` из Figma MCP создаёт переменные и режимы прямо в файле (подробнее в варианте D).

### C. Снимок галереи: html.to.design или `generate_figma_design`

- **html.to.design** — плагин Figma и расширение Chrome, которое захватывает в том числе localhost и страницы за логином. Импорт даёт auto layout и локальные стили, раскладки desktop, tablet и mobile, светлую и тёмную тему. Бесплатно — 10 импортов за 30 дней. PRO стоит $12 за пользователя в месяц при годовой оплате или $18 при помесячной, лимит — 1000 импортов в месяц по правилу fair use ([free](https://html.to.design/docs/free-features), [pro](https://html.to.design/docs/pro-plan)). О переменных и компонентах на этих страницах ничего не сказано.
- **`generate_figma_design`** из Figma MCP переносит живой UI, в том числе с localhost, в редактируемые слои ([tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/)). На выходе — обычные фреймы, прямоугольники и текст, без экземпляров компонентов, переменных и свойств вариантов ([запрос на форуме](https://forum.figma.com/suggest-a-feature-11/figma-mcp-generate-figma-design-should-resolve-html-elements-to-existing-library-components-instead-of-raw-frames-51286)).
- **Итог.** Снимок точнее всего передаёт zine: наклоны, тени и шрифты — как в браузере. Но это статичная картинка без вариантов: свойства, варианты и привязку к переменным потом придётся собирать вручную или агентом.

### D. Агент собирает библиотеку: Figma MCP `use_figma`

- `use_figma` выполняет код Plugin API прямо в файле Figma. Так создаются фреймы, компоненты, варианты, переменные и auto layout. Ограничения: нужен Full seat и право на редактирование файла, ответ одного вызова — до 20 KB, картинки и видео не поддерживаются, свои (custom) шрифты — тоже ([Write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas)).
- Открытая бета запущена 24.03.2026. В бете функция бесплатна, позже станет платной по объёму использования, но цену пока не объявили ([createwith](https://www.createwith.com/tool/figma/updates/figma-opens-beta-for-ai-agents-that-design-directly-on-canvas)). Лимиты на вызовы зависят от плана и типа места ([rate limits](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/)).
- **Схема работы.** Агент берёт три источника: `cva` из исходников (имена свойств и их значения), снимок `/design-system` (как компонент выглядит) и JSON токенов. По ним он создаёт, например, component set `Button` со свойствами `variant`, `size` и `state`, привязанными к переменным. Свойства в Figma называются так же, как пропсы в коде. Поэтому `get_design_context` и `search_design_system` позволяют пройти и обратный путь (Figma → код) без Code Connect.
- **Риск**: качество результата нужно проверять. Для этого нужна визуальная сверка: `get_screenshot` из Figma сравнивается со скриншотом галереи.

### E. Storybook + story.to.design

- Storybook 10.3 поддерживает Next.js 16 через фреймворк `nextjs-vite` ([release](https://storybook.js.org/releases/10.3), [docs](https://storybook.js.org/docs/get-started/frameworks/nextjs-vite)). В репозитории Storybook нет. Чтобы его внедрить, нужны новые зависимости, декораторы для `data-theme`, `data-tone` и шрифтов из `next/font`, а stories по сути повторят галерею.
- story.to.design генерирует из stories компоненты Figma с вариантами и auto layout. Он умеет работать с локальным Storybook и сообщает, когда код изменился. Тариф Team — $149 или $199 в месяц в зависимости от способа оплаты: один Storybook, неограниченное число компонентов ([pricing](https://story.to.design/#pricing)). О переменных на сайте ничего не сказано.
- Варианты здесь передаются точнее всего и обновлять проще всего. Но для проекта с одним разработчиком это дорого и дублирует `/design-system`.

### F. Figma Code Connect

- Связывает компонент в Figma с компонентом в коде: в Dev Mode и через MCP видны настоящий `import` и JSX. Настраивается в интерфейсе Figma или через CLI (`figma.connect` в файлах `*.figma.tsx`). Доступен только на Organization и Enterprise, нужен Full или Dev seat, а компоненты должны быть опубликованы в библиотеке ([help](https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect), [docs](https://developers.figma.com/docs/code-connect)).
- Сам Code Connect компонентов не создаёт. Это последний шаг, который нужен, когда над китом работает команда.

## Сравнение

| Путь | Что получаем | Варианты | Auto layout | Шрифты | План и цена | Трудозатраты | Поддержка |
|---|---|---|---|---|---|---|---|
| A. Claude Design `/design-sync` | Дизайн-система в Claude Design | Из кода | — (HTML) | Как в браузере | Pro / Max / Team / Enterprise, бета | Низкие | Повторный `/design-sync` по изменённым компонентам |
| B. Токены → Variables | Переменные с режимами тем и тонов | — | — | Семейства как string-переменные | Режимы: Professional+. REST API: только Enterprise. Tokens Studio: Pro | Низкие: скрипт + импорт | Перегенерировать JSON и импортировать в те же режимы |
| C. Снимок галереи | Фреймы один в один с браузером | Нет, статичный снимок | html.to.design: да | Как в браузере, если шрифт есть в Figma | html.to.design: 10 импортов бесплатно, PRO от $12. `generate_figma_design`: в рамках MCP | Низкие | Переснять страницу |
| D. Агент `use_figma` | Component sets, привязанные к переменным | Да | Да | Шрифты из Figma, custom — нет | Full seat. В бете бесплатно, потом оплата по объёму | Средние | Агент пересобирает изменённый компонент |
| E. Storybook + story.to.design | Компоненты с вариантами из stories | Да | Да | Как в браузере | $149–199 в месяц + Figma | Высокие: Storybook с нуля | Уведомления об изменениях кода |
| F. Code Connect | Связь Figma ↔ код в Dev Mode и MCP | — | — | — | Organization / Enterprise | Средние | Маппинги лежат в репозитории |

## Рекомендуемый путь

1. **Claude Design.** Запустить `/design-sync` из `packages/ui`, сверяясь с `/design-system`. Основная тема — zine, gallery — вторая, пока приложения на неё не переведены. Проверка: собрать в Claude Design экран id или battleship и сравнить с тем, что в коде. Дополнительных затрат нет, всё входит в подписку.
2. **Токены в файл.** Скрипт в `packages/ui` пишет `tokens/*.tokens.json` в формате DTCG. Коллекция `primitives` хранит бумагу, чернила, spot-цвета и нейтральные цвета gallery. Коллекция `semantic` (`background`, `foreground`, `primary`, `border`, статусы, радиусы, тени, шрифтовые роли) получает режимы `gallery-light`, `gallery-dark`, `zine-light` и `zine-dark`. Коллекция `game` получает режимы `day` и `night`. Тест сверяет JSON с CSS.
3. **Библиотека Figma.** Файл «outegro UI» на плане Professional с Full seat. Переменные импортируются нативно в DTCG, если функция доступна в аккаунте, иначе их создаёт агент через `use_figma`. Сразу проверить, что все 16 шрифтов есть в Figma.
4. **Компоненты.** Снять `/design-system` через `generate_figma_design` — это визуальный эталон. Затем агент через `use_figma` собирает component sets с теми же свойствами, что в `cva` (`variant`, `size`, `tone`, `state`), и привязывает их к переменным. Особенности zine (наклон, регистр, effect styles, текстура-фон) задаются в самих компонентах. Начать с того, что нужно первым приложениям при переходе на zine (id, battleship): Button, Input, Label, FormMessage, Notice, Surface, Badge, Tabs, ToggleGroup, AccountMenu.
5. **Галерея как матрица.** Чтобы и снимок, и агент видели все сочетания, на `/design-system` нужна матрица «вариант × размер × состояние» для каждого компонента в обеих темах. Сейчас страница всегда отрисована в zine, значит, нужен ещё переключатель темы. Та же матрица даст карточки для Claude Design и пригодится для визуальной регрессии. Storybook пока не внедрять.
6. **Обратный путь.** Дизайн из Claude Design попадает в код через передачу в Claude Code. Дизайн из Figma — через `get_design_context` в MCP. Имена компонентов и свойств совпадают с кодом, поэтому до перехода на Organization Code Connect не нужен.
7. **Сопровождение.** Правки вносятся только в код. После изменения кита: перегенерировать JSON и импортировать его в существующие режимы, запустить `/design-sync` по изменённым компонентам, попросить агента пересобрать эти компоненты в Figma. К Storybook + story.to.design вернуться, когда появится дизайнер или команда. К Code Connect — при переходе на Organization.

Чего не делать. Не назначать Figma источником правды: обратная синхронизация переменных через REST API доступна только на Enterprise. Не пытаться выразить эффекты zine токенами: наклон, регистр и текстуры к переменным не привязываются.

## Проверить вручную

- Есть ли в аккаунте Figma нативный импорт переменных.
- Все ли 16 семейств есть в Figma, или какие-то придётся ставить локально.
- Сколько будет стоить `use_figma` после беты.
- Одна дизайн-система в Claude Design (zine) или две (zine и gallery) на время перехода.

## Источники

- Figma: [Plans and features](https://help.figma.com/hc/en-us/articles/360040328273-Figma-plans-and-features), [Modes for variables](https://help.figma.com/hc/en-us/articles/15343816063383-Modes-for-variables), [Apply variables to designs](https://help.figma.com/hc/en-us/articles/15343107263511-Apply-variables-to-designs), [Add a font](https://help.figma.com/hc/en-us/articles/360039956894-Add-a-font-to-Figma), [Variables REST API](https://developers.figma.com/docs/rest-api/variables), [plugin sample variables-import-export](https://github.com/figma/plugin-samples/tree/main/variables-import-export).
- Нативный импорт и экспорт переменных: [obra studio](https://figma.obra.studio/design-tokens-community-group-w3c-release/), [форум Figma](https://forum.figma.com/ask-the-community-7/native-variable-export-feature-47831).
- Figma MCP: [tools and prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/), [write to canvas](https://developers.figma.com/docs/figma-mcp-server/write-to-canvas), [rate limits](https://developers.figma.com/docs/figma-mcp-server/rate-limits-access/), [open beta](https://www.createwith.com/tool/figma/updates/figma-opens-beta-for-ai-agents-that-design-directly-on-canvas), [ограничение захвата](https://forum.figma.com/suggest-a-feature-11/figma-mcp-generate-figma-design-should-resolve-html-elements-to-existing-library-components-instead-of-raw-frames-51286).
- Code Connect: [help](https://help.figma.com/hc/en-us/articles/23920389749655-Code-Connect), [docs](https://developers.figma.com/docs/code-connect).
- Токены: [Tokens Studio pricing](https://tokens.studio/pricing), [Tokens Studio: что пропускается](https://docs.tokens.studio/figma/export/variables-skipped), [Style Dictionary DTCG](https://styledictionary.com/info/dtcg/).
- Импорт из HTML и Storybook: [html.to.design free](https://html.to.design/docs/free-features), [html.to.design PRO](https://html.to.design/docs/pro-plan), [story.to.design](https://story.to.design/#pricing), [Storybook 10.3](https://storybook.js.org/releases/10.3), [Storybook nextjs-vite](https://storybook.js.org/docs/get-started/frameworks/nextjs-vite).
- Claude Design: [Set up your design system](https://support.claude.com/en/articles/14604397-set-up-your-design-system-in-claude-design), [Get started](https://support.claude.com/en/articles/14604416-get-started-with-claudae-design).
