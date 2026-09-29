# Дизайн и локализация

## Содержание первого выпуска

Hero: Nick Lukashik, понятная full-stack роль, работа под ключ. Projects сразу после hero: работающие продукты с реальными экранами. Platform: что уже работает в production, без статусов «в разработке». Services, Process, Working together: что получает заказчик и как идёт работа. Stack — отдельная страница `/stack`. Contact: реальные проверенные ссылки. Не добавлять pricing, отзывы, awards и кейс outegro.com.

## Визуальные правила

Одна silver/chrome liquid signature как основной объект. Liquid glass применяется выборочно на навигации/акцентах. Формы и финансовые таблицы используют читаемую основу. Текст — DOM, не texture в WebGL. Декоративная сцена не участвует в keyboard navigation и не является обязательным способом перейти к контакту.

Semantic tokens: background/surface/text/muted/border/focus/accent/status; typography с EN/RU; spacing scale; radius; elevation; motion duration/easing. DS включает состояния default/hover/focus/disabled/loading/error/success, а data screens — empty/partial/stale/forbidden.

## Performance acceptance

L-05 фиксирует физические device/browser/refresh rate/viewport и sample method. Для 60 Гц frame budget около 16.7ms. Нельзя заявлять 60 FPS по ощущению или desktop trace вместо телефона. Измерять warm sustained run, p50/p95 frame intervals и долю плохих кадров; порог доли согласовать в device matrix до pass. Provisional lab targets для контента: LCP до 2.5s, CLS до 0.1 на согласованном профиле; field INP нельзя доказать одним Lighthouse run. Детали measurement в отчёте.

У сцены есть quality tiers и poster fallback, pause hidden/offscreen, reduced motion, context-loss recovery. Adaptive DPR не меняет resolution DOM. Число pixels ограничено. Изменение camera/geometry/material profile сохраняется для воспроизводимости. 120 FPS отдельный профиль на соответствующем дисплее.

## i18n

Landing `/` EN, `/ru` RU. Первый визит с ru браузером остаётся EN. Явный выбор имеет приоритет; service locale берёт профиль/explicit selection, fallback EN. Auth cookie не делается общей для домена ради locale. API errors содержат стабильный messageKey; frontend показывает перевод. Даты и деньги форматируются одинаковыми shared helpers. Все visible states/validation/empty emails имеют RU и EN. Payment source currency не конвертируется автоматически под язык.

## UI acceptance matrix

Минимальные ширины: 320, 390, 768, 1280, 1440. Браузеры: актуальные Chromium, Firefox, WebKit/Safari при наличии устройства. Обязательны keyboard-only, reduced motion, no-WebGL, slow-load, 200% zoom. Неисполненная среда отмечается not-run. Контраст/semantic structure/доступное название проверяются отдельно от screenshot diff.
