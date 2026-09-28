# Глава 2. Общая дизайн-система

> Версия 0.3: детальные действия, зависимости и test cases находятся в [карточках задач](../../04-delivery/README.md). Эта глава задаёт предметный контекст.

## 2.1. Назначение

Один визуальный и поведенческий фундамент для landing, id, pay, notifications UI, admin и будущего Battleship. Публичная главная выразительна; сервисные экраны спокойнее и плотнее. Общность создают типографика, пропорции, состояния, материалы и навигационные паттерны, а не обязательный WebGL на каждой странице.

## 2.2. Принципы «жидкой подписи»

Основной образ: полированное серебро на графитовом или светлом нейтральном фоне. Отражения крупные и чистые, без радужного шума. Стекло тонкое, с аккуратным бликом по краю. Пластичность ощущается в материале и реакции на движение, но текст не деформируется вместе с объектом.

Предлагается тёмная выразительная главная и светлая/нейтральная рабочая поверхность приложений на тех же semantic tokens. Это одна DS с разными surface presets; полноценный пользовательский light/dark switch не обязателен для первого релиза. После макетов можно выбрать единую тёмную основу, если контраст таблиц и форм останется достаточным.

## 2.3. Слои токенов

| Слой | Примеры | Правило |
|---|---|---|
| Primitive | neutral-0…950, silver ramps, spacing, durations | Не использовать напрямую в продуктовых компонентах без необходимости |
| Semantic | background, surface, text-primary, border, focus, danger | Значение одинаково во всех приложениях |
| Material | glass-opacity, blur, edge, reflection intensity | Есть opaque fallback |
| Component | button-height, input-radius, table-row-height | Компоненты не копируют локальные значения |
| Motion | enter, exit, hover, easing, reduced | Время и easing согласованы |
| 3D quality | DPR cap, render pixel cap, geometry tier | Не смешивать с CSS-токенами темы |

Стартовые предложения для макетов: graphite #101215; text #F5F6F7 на тёмном; light surface #F5F6F8; dark text #17191D; silver #B8BEC6/#E9EDF2. Итоговые пары подтверждаются контрастом, а не названием цвета. Ошибка/успех/предупреждение имеют и цвет, и текст/иконку. Фокус хорошо заметен на серебре и стекле.

## 2.4. Типографика и композиция

Один основной гротеск с качественной кириллицей и variable weights, один моноширинный для IDs/технических значений по необходимости. Финальный шрифт выбирается на макетах с проверкой лицензии. Self-hosted subset, корректный fallback и минимальный layout shift. Hero-scale адаптивный, формы и таблицы не уменьшаются ради декоративного воздуха.

Сетка и spacing основаны на кратности 4 px; контейнер и поля адаптируются; длинные значения в админке имеют копирование и перенос/обрезку с доступным полным значением. Радиусы ограничены несколькими размерами. Мягкость hero не требует круглых финансовых таблиц.

## 2.5. Библиотека компонентов

| Семейство | Компоненты P0 | Обязательные состояния |
|---|---|---|
| Основы | Button, Link, IconButton, Text, Heading, Separator | Hover, focus, active, disabled |
| Формы | Input, CodeInput, Select, Checkbox, Switch, FormField | Empty, invalid, read-only, pending, error |
| Обратная связь | Alert, Toast, InlineError, Spinner, Skeleton | Доступное объявление, retry, timeout |
| Наложения | Dialog, ConfirmDialog, Popover, Tooltip, Menu | Focus trap, Escape, возврат фокуса |
| Навигация | Header, ServiceNav, Tabs, Breadcrumbs, LocaleSwitch | Active, keyboard, mobile |
| Данные | Table, Pagination, FilterBar, SortHeader, EmptyState | Loading, empty, partial, stale, forbidden |
| Identity | LoginMethod, SessionItem, PasskeyItem | Current/revoked/unavailable |
| Billing | Amount, PaymentStatus, SubscriptionSummary, ReceiptRow | Валюта, precision, pending, refund |
| Operations | Timeline, EventStatus, Diff, ReconciliationIssue | Failed, duplicate, unmatched, resolved |

Составные компоненты знают формат отображения, но не хранят бизнес-логику оплаты или ролей. Например, PaymentStatus получает typed state; решения о доступе остаются на backend. API-запросы не зашиваются в базовый Button или Table.

## 2.6. Паттерны экранов

Landing: выразительный hero + секции. Identity: короткая последовательность действий и ясное восстановление после ошибки. Payments: товар, сумма, валюта, период, подтверждённое состояние; декоративные эффекты не отвлекают от цены. Admin: таблица → карточка → действие → audit result. Battleship позже наследует typography/buttons/statuses, но игровое поле получает собственные компоненты.

Все фронты имеют согласованные page title, account menu, locale, error boundary, not-found, maintenance и support/contact route. ServiceSwitcher показывает только реально запущенные сервисы, учитывает права и не раскрывает админку обычному пользователю; backend всё равно независимо проверяет доступ.

## 2.7. Реализация в monorepo

Предлагаемые packages: `design-tokens`, `ui`, `i18n`, `brand-scene`, `contracts`, `auth-client` и общие конфиги. Использовать существующий `packages/ui` как основу, выделяя токены без бесцельного переименования. `brand-scene` не импортируется в ui root, чтобы формы не получали Three.js автоматически. Server/client entrypoints разделены. Схемы API и UI-локализация не образуют циклических зависимостей.

Component gallery/Storybook разворачивается локально или в защищённом preview; отдельный постоянно работающий production-pod для неё не нужен. В галерее — EN/RU, mobile, длинные значения, disabled/error/loading, keyboard. Визуальные regression-снимки делаются для значимых экранов и состояний, а не для каждой технической функции.

## 2.8. Liquid glass: варианты реализации

Базовый UI-материал — CSS backdrop blur, прозрачность, граница, highlight и надёжная подложка. Для фирменной сцены — R3F/Three.js shader/material. `liquid-glass-js` рассматривается как эксперимент, а не как обязательная основа форм: WebGL2/html2canvas требуют измерения, React-интеграция и доступность проверяются отдельно. `liquid-logo` — референс металлического материала. Shadergradient — необязательный кандидат для мягкого фона; не добавлять второй WebGL canvas без пользы и замеров.

## 2.9. Definition of Done

Токены документированы; основные компоненты имеют типизированные props и состояния; EN/RU не ломают размеры; keyboard/focus/reduced motion работают; светлая/тёмная поверхность не теряет контраст; bundle приложения без сцены не содержит её тяжёлые зависимости; минимум один экран id и один pay собраны из DS до завершения лендинга. Любое изменение shared tokens проверяется на landing, id, pay и admin.
