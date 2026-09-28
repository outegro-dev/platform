# Liquid signature

Персональный сайт Nick Lukashik для работодателей и B2B-заказчиков. Редакция 28.09.2026 (v0.2 лендинга).

## Визуальная основа

Светлый галерейный фон, плотная гротескная типографика, редакционный акцент серифным италиком с серебряной заливкой и живые объекты из жидкого серебра. Стекло — только для «хрома» интерфейса: навигация, шапка после скролла, подписи поверх медиа. Одна тёмная секция (Platform) — намеренный контраст внутри композиции, а не тема ОС.

Порядок секций: Hero → лента стека → 01 Expertise → 02 Approach → 03 Platform (тёмная) → 04 Projects → 05 Contact → footer. Каждая секция открывается индексом `NN ── LABEL` моноширинным шрифтом и заголовком «гротеск + серебряный италик».

## Типографика

Все шрифты self-hosted через Fontsource, SIL Open Font License, только подмножества Latin + Cyrillic, `font-display: swap`, без runtime CDN.

| Роль | Шрифт | Начертания |
|---|---|---|
| Основной (`--font-sans`) | Manrope | 400 / 500 / 600 / 700 (статические — переменный в Windows WebKit был слишком тонким) |
| Акцент (`--font-display`, `.og-accent`) | Cormorant Garamond Italic | 500 |
| Технические метки (`--font-mono`, `.og-eyebrow`, `Badge`) | JetBrains Mono | 500 |

Display-заголовки 44–158 px, line-height 0.94–1.0, плотный tracking. Акцентная часть на ~7% крупнее соседнего гротеска, чтобы выровнять кегль. Body 15–21 px. Display-размеры не переносить в формы сервисов.

## Дизайн-система `@outegro/ui`

Единый пакет для всех фронтендов outegro.dev (лендинг, id., pay., admin., будущие приложения). Подробности подключения — [packages/ui/README.md](packages/ui/README.md).

- Токены в `src/styles/index.css`: светлый тон по умолчанию и инверсный `[data-tone="dark"]` (им переключаются тёмные секции и шапка над ними). В приложениях — только токены, никаких сырых hex.
- Утилиты: `.og-container` (ширина и поля 56/32/20 px), `.og-glass` (стекло с fallback для reduced transparency и без backdrop-filter), `.og-eyebrow`, `.og-accent`.
- Компоненты: Button (primary / secondary / outline / glass / ghost / destructive / link; sm / md / lg / icon), Dialog, Accordion, Input, Label, Badge, Surface, Container, LanguageSwitch.
- Radix отвечает за клавиатуру и фокус, иконки Phosphor. Focus — 2 px outline с offset 5 px. Минимальная цель — 44 px.
- Галерея: `/design-system` (noindex).

## Сцены из жидкого серебра

React Three Fiber + Three.js, без Drei, внешних HDR и моделей. Три сцены, у каждой свой canvas, который рендерит только когда виден на экране:

| Где | Сцена |
|---|---|
| Hero | Подпись NL — два оригинальных CatmullRom-штриха + капля жидкого стекла |
| Expertise | Трилистник-узел из закрученной ленты (Мёбиус-подобная скульптура) |
| Projects | Две текучие ленты во всю ширину баннера |

**Материал** — `MeshPhysicalMaterial` (metalness 1, roughness 0.055, clearcoat, лёгкая iridescence), вершинный шейдер через `onBeforeCompile`:

- волна утолщения бежит вдоль штриха («ртуть течёт внутри»), нормаль наклоняется по производной радиуса — блики тоже текут;
- медленный simplex-шум изгибает осевую линию;
- штрих «пишется» при появлении (сначала N, потом L);
- под курсором поверхность набухает с инерцией, группа поворачивается за курсором и при скролле.

**Чёткость.** Студия генерируется в коде: градиентный купол, софтбоксы и тёмные флаги, PMREM **1024 px** (дефолтные 256 px давали мыльное серебро). NeutralToneMapping. DPR = min(devicePixelRatio, 2); адаптивный замер снижает DPR, только если средний кадр держится дольше 19 мс.

**Стекло.** Капля — `transmission` с dispersion. Transmission не преломляет через прозрачный canvas, поэтому hero-canvas непрозрачный и очищается точно цветом страницы, а контактная тень нарисована внутри 3D.

**Производительность.** На странице нет кнопки паузы. Сцены стартуют по первому взаимодействию (pointer, scroll, клавиатура) или после простоя страницы, так что three.js, геометрия и компиляция шейдеров не попадают на критический путь. До старта виден постер — кадр той же сцены, поэтому смена незаметна. Программные растеризаторы (SwiftShader, llvmpipe, WARP), reduced motion, отсутствие WebGL и потеря контекста → постер. Замер: 60 FPS при DPR 2 на реальном GPU.

**Постеры** рендерятся из самих сцен в 2x (`/design-system/scenes` + `node tools/quality/render-posters.mjs`), отдаются через `next/image` с качеством 90 (AVIF/WebP). Они же — OG-картинка. После любого изменения сцен постеры нужно перерендерить.

## Язык

EN по умолчанию независимо от Accept-Language. Язык хранится в cookie `og_locale` на `.outegro.dev` (общая для всех поддоменов), в URL его нет. Переключение: server action `setLocale` → `router.refresh()`. Логика — в `@outegro/i18n`, чтобы её переиспользовали остальные фронтенды. Следствие для SEO: индексируется один canonical `/` на английском.

## Безопасность и доставка

- CSP с nonce на каждый запрос (`src/proxy.ts`): `script-src 'self' 'nonce-…' 'strict-dynamic'`, `frame-ancestors 'none'`, `upgrade-insecure-requests` только за TLS.
- Статические заголовки в `next.config.ts`: HSTS, nosniff, X-Frame-Options, Referrer-Policy, COOP, Permissions-Policy.
- `output: "standalone"` (трассировка от корня монорепо), React Compiler, пробы `/health` и `/health/deep` для общего Helm chart.

## Что расширять позднее

Auth, Payments, Admin, таблицы, toast, сложные формы и состояния forbidden/stale реализуются по своим task cards и добавляются в `@outegro/ui` по мере появления. Наличие галереи не означает их готовность.
