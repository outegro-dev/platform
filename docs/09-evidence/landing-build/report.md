# Лендинг v0.2: состояние и доказательства (28.09.2026)

Проверено на production-сборке (standalone `server.js`) на `http://localhost:3000`: Playwright в Chromium, Firefox и WebKit, Lighthouse 13, замер FPS на реальном GPU (AMD RX 6900 XT, ANGLE D3D11). Задачи L/DS в `task-index.json` формально ещё `planned`: статусы синхронизируются отдельной задачей этапа 0.

## Что сделано в v0.2

| Требование | Реализация | Где |
|---|---|---|
| Standalone-сборка | `output: "standalone"`, трассировка от корня монорепо; `pnpm start` запускает `server.js` так же, как контейнер | `apps/landing-web/next.config.ts`, `scripts/start-standalone.mjs` |
| Health | `/health` и `/health/deep` → `{"status":"ok"}`, `no-store` | `src/app/health/` |
| i18n без URL | cookie `og_locale` на `.outegro.dev`, EN по умолчанию, server action + `router.refresh()`; маршрута `/ru` больше нет | `packages/i18n`, `src/i18n/request.ts` |
| Переиспользуемый UI kit | токены светлого и тёмного тона, шрифты, утилиты, 9 компонентов, README подключения | `packages/ui` |
| React Compiler | `reactCompiler: true`; в чанках есть `memo_cache_sentinel` | `next.config.ts` |
| Контакты | email, Telegram, LinkedIn, GitHub: секция Contact, диалог в hero и шапке | `src/lib/contact.ts` |
| Кнопка паузы | удалена. Reduced motion по-прежнему не создаёт WebGL | `silver-stage.tsx` |
| Живее анимация | подпись пишется, утолщения текут вдоль штриха, шум изгибает форму, реакция на курсор и скролл | `components/silver/*` |
| Чёткие текстуры | студия в коде, PMREM 1024 вместо 256, DPR до 2, постеры 2x из самих сцен, `next/image` q90 AVIF/WebP | `studio.ts`, `render-posters.mjs` |
| Картинки → 3D | AI-картинки `silver-study` и `silver-arc` заменены живыми сценами: узел в Expertise, ленты в Projects | `scenes.tsx` |
| Liquid glass | капля с transmission и dispersion в hero; стеклянная шапка, навигация и подпись проекта | `material.ts`, `index.css` |
| CSP | nonce на запрос, `strict-dynamic`, `frame-ancestors 'none'`, плюс HSTS, nosniff, COOP, Permissions-Policy | `src/proxy.ts`, `next.config.ts` |
| Акцентный шрифт | Cormorant Garamond Italic с серебряной заливкой + JetBrains Mono для технических меток | `packages/ui/src/styles` |
| Дизайн | лента стека, индексы секций, секция Platform со схемой платформы, sticky glass-шапка с тоном для тёмных секций | `src/app/page.tsx` |

## Результаты проверок

- `pnpm lint` — pass. `pnpm typecheck` — pass (ui, i18n, landing-web). `pnpm build` — pass.
- `pnpm test:e2e` — **58 passed, 2 skipped**. Пропуски: жизненный цикл WebGL проверяется только в Chromium с GPU.
- Lighthouse 13 (headless, simulated throttling):

| Профиль | Performance | Accessibility | Best Practices | SEO | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| Desktop | **99** | 100 | 100 | 100 | 0.5 s | 0.8 s | 0 ms | 0.02 |
| Mobile (Moto G, 4G, CPU ×4) | **86–87** | 100 | 100 | 100 | 2.3 s | 3.6 s | 40 ms | 0.05 |

  Отчёт desktop: [lighthouse-desktop.html](lighthouse-desktop.html).
- FPS hero-сцены на реальном GPU при DPR 2 (canvas 1593×1656): **60.1 FPS**, p50 16.7 мс, p95 16.7 мс (ограничено vsync).

Скриншоты v0.2: `v2-desktop-hero-en.webp`, `v2-desktop-hero-ru.webp`, `v2-desktop-expertise.webp`, `v2-desktop-projects.webp`, `v2-desktop-header-scrolled.webp`, `v2-mobile-hero.webp`, `v2-mobile-platform.webp`, `v2-mobile-menu.webp`. PNG и `performance.json` без префикса `v2-` относятся к v0.1 (там замер на SwiftShader, 14.7 FPS).

## Известные ограничения

1. **Mobile LCP 3.6 s в симуляции.** LCP-элемент — постер подписи; реальный breakdown около 0.6 s. Дальнейший рост — через самохостинг на CDN и HTTP/3 в production и отказ от Cyrillic-начертаний на EN (Chrome их подгружает).
2. **Язык не индексируется отдельно:** RU существует только в cookie, поисковики видят EN.
3. **FPS на телефонах не замерялся** на реальных устройствах (input DEVICE-MATRIX). Программный рендер получает постер автоматически, слабые GPU снижают DPR.
4. **`THREE.Clock deprecated`** в консоли — предупреждение внутри R3F 9.8, не наше. Уйдёт с обновлением R3F.
5. **HSTS с `preload`** начнёт действовать только в production по HTTPS. В список preload домен вносится отдельным решением владельца.
