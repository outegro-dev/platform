# Отчёт: Обучение (edu.outegro.dev)

- Статус: в production с 06.10.2026 (platform `f5ef90d`, gitops `dee4b10`)
- Задание: прямые поручения владельца 03.10.2026 — учебники «Node.js изнутри» и «SQL изнутри» как часть платформы на edu.outegro.dev, роль или подписка, раздел в админке, компоненты проекта; 04.10.2026 — перенос основательнее, ИИ-помощник на MiniMax, UI-кит и правила сервисов; [глава 17](../../01-specification/chapters/17-education.md), [ADR-010](../../03-decisions/adr/010-education.md)
- Commit/ref: platform#97 (`0f1930a`…`19dc10e`, слияние `f5ef90d`); gitops `75e3f53`, `0c6d5cc`, `dee4b10`
- Environment: Windows 11, Node 26.8.1, pnpm 12.3.4, Docker Desktop (Testcontainers: PostgreSQL 18.6, Valkey 9.1, RabbitMQ 4.3)
- Прочитанные contracts/ADR: identity-access, events, http-errors, invariants, deployment, billing; ADR-003, 004, 005, 008, 009

## Изменения 03.10

- **Контент.** `apps/edu-backend/tools/import-artifact.mjs` конвертирует экспорт артефакта в `BookDocument` (без HTML; SVG по белому списку; падает на неизвестном). `content/books/nodejs-internals.json` (13 глав, 55 схем, 76 упражнений, 65 тем, 122 карточки, 5 сценариев симулятора) и `sql-internals.json` (13 глав, 71 схема, 120 упражнений из них 46 SQL-задач, 66 тем, 102 песочницы с вводной, 121 карточка); `content/manifest.json` — начальные статус и правило. Числа совпадают со счётчиками оригинальных страниц.
- **Контракты.** `packages/contracts/src/edu.ts` (`@outegro/contracts/edu`): документ, правило доступа, DTO читателя и админки; `access.ts` — `edu.read`, `edu.manage`, роль `edu_editor`, `edu.read` у support; `envelope.ts` — продюсер `edu`.
- **apps/edu-backend** (NestJS 12, БД `edu`, порт 4005): схема и миграция `0000_init`, импорт книг в `db/migrate.js`, доменная модель доступа, API читателя и прогресса, проекции грантов и статуса Identity, admin API с `expectedVersion`, причиной, аудитом и проверкой свежести токена.
- **apps/edu-web** (Next.js 16, порт 3006): библиотека, книга, глава, вводная, колода; рендер всех типов блоков компонентами платформы; интерактив; SQL-песочница — sql.js (asm) в Web Worker с остановкой через 3 с; прогресс через server actions; SSO-клиент `edu-web`; CSP с `worker-src 'self' blob:`; сжатие отдано Cloudflare (`compress: false`).
- **apps/admin-web**: раздел «Обучение» (сводка, книги, читатели, аудит, команды статуса и доступа), панель и карточка здоровья на дашборде, вкладка в карточке пользователя, выдача `edu:library` / `edu:book.<slug>` вручную, подписи роли `edu_editor`.
- **id-web, pay-web, battleship-web, packages/ui, packages/bff**: Education в реестре приложений и меню аккаунта, `EDU_URL`, «Ваши приложения», сервис `edu` в pay-web (иконка, «Вернуться в Учебники»); магазин Морского боя строго проверяет только свои продукты каталога; `PUT` в клиенте BFF.
- **Сборка и окружение**: Dockerfile (цели `edu-web`, `edu-backend`, копия `content/`), `docker-bake.hcl`, `tools/ci/scope.mjs`, `infra/local/postgres/init.sql`, `tools/dev/generate-env.mjs`, `OAUTH_CLIENTS` в `.env.example` auth-backend, `tools/ops/smoke.mjs` (Education и `SMOKE_SKIP`), `packages/system-tests` (edu-backend в стеке и сквозной тест грантов).
- **gitops** (`feat/edu`): `apps/production/edu.yaml`, роль и база `edu` в `postgres.yaml`, `pg-edu` в `node/secrets.sh`, OAuth-клиент в `apps.yaml`, записи `images`, сетевые политики, PodMonitor; включение приложения (ресурс `edu.yaml`, пробы watchdog, `EDU_API_URL` админки) закомментировано до шага 3 runbook.
- **Документация**: глава 17, ADR-010, [edu-rollout.md](../../06-operations/edu-rollout.md), обновления identity-access, http-errors, events, deployment, observability, production, restore, owner-checklist, handoff, архитектура и матрица прав админки.

## Проверки 03.10

| Проверка | Окружение | Результат |
|---|---|---|
| `python tools/documentation/validate.py` | локально | pass, 2011 ссылок |
| `pnpm lint` | весь монорепо | pass, 1038 файлов |
| `pnpm typecheck` | весь монорепо | pass, 28 задач |
| `pnpm build` | весь монорепо | pass, 15 задач |
| `pnpm test` | весь монорепо, Testcontainers | pass, 26 задач: contracts 34, bff 56, ui 16, db 14, nest-common 36, battleship-engine 25, auth-backend 88, notifications-backend 83, payments-backend 143, battleship-backend 128, edu-backend 57, id-web 13, pay-web 140, battleship-web 141, admin-web 155, edu-web 64, system-tests 6 |
| system-tests «Education» | собранные бэкенды на PostgreSQL, Valkey, RabbitMQ, SMTP | ручной грант Payments `edu/book.sql-internals` открывает главу 3 через `billing.grant.changed.v1`, вторая книга остаётся закрытой, отзыв закрывает главу (TC-EDU-01, TC-EDU-03) |
| `kubectl kustomize apps/production` | gitops, шаг 1 и полный | рендерится |
| contracts / ui тесты | vitest | 34 / 16 pass |
| edu-backend тесты (Testcontainers) | PostgreSQL, Valkey, RabbitMQ | 57 pass |
| edu-backend импорт на локальной базе | `node dist/db/migrate.js` дважды | вставка обеих книг, затем «unchanged» |
| edu-web unit / e2e | vitest / Playwright на production-сборке | 64 / 46 pass (повтор на финальном коде: 46 pass) |
| admin-web unit / e2e | vitest / Playwright | 155 / 192 pass (повтор на финальном коде: 192 pass) |
| `docker buildx bake edu-web edu-backend` (`BUILD_APPS=edu-web edu-backend`) | Docker Desktop, linux/amd64 | образы собраны: edu-web 396 МБ, edu-backend 468 МБ |
| Образ edu-backend: `node dist/db/migrate.js` | локальный PostgreSQL | `migrations applied`, обе книги `book unchanged`; `/app/content` в образе; uid 1000 |
| Образ edu-web | `docker run`, порт 3006 | `/health` → `{"status":"ok","service":"edu-web"}`; `/` → 200, CSP с nonce и `worker-src 'self' blob:`, `private, no-store`, без `x-powered-by` |
| pay-web unit / e2e, battleship-web unit / e2e, id-web unit | vitest / Playwright | 140 / 51, 141 / 118, 13 pass |

## Итерация 04.10.2026: перенос основательнее, ИИ-помощник, UI-кит

Задание владельца 04.10: подготовить перенос основательнее, языковую модель взять от MiniMax (ключ — из проекта work-finder), привести Обучение к UI-киту и правилам сервисов outegro. Основание для проверки — QA-аудит Обучения против `.claude/agents/*.md` и аудит паритета с оригинальными страницами книг.

### Изменения

- **`packages/edu-engine`** (новый, как `battleship-engine`): правила без React и Nest для edu-web и edu-backend — `checkAttempt` (вердикт сервера), нормализация и отпечатки результатов SQL, оценки упражнений, колода, симулятор, обход документа главы, `readableAccess`, белый список SVG (один для конвертера и читалки), текст разделов и глав для помощника, правило оценки понимания. Правила из `apps/edu-web/src/lib` и из контракта перенесены сюда; в контракте остались схемы и DTO.
- **Контракт** `@outegro/contracts/edu`: попытка упражнения вместо `{ solved }`, отпечаток `expected` у SQL-задач, API и события помощника, `assist` в сводке админки, `understanding` в прогрессе; `adminReasonSchema` — общий в корне контрактов.
- **Сервер решает результат.** `POST /v1/me/books/:slug/exercises/:id/attempts` проверяет ответ движком; SQL — по отпечатку эталона, вычисленному конвертером (`tools/sql-expectations.mjs`, 46 задач), без выполнения SQL на сервере; `Idempotency-Key` у попыток и карточек; смена вида объяснения не считается активностью.
- **ИИ-помощник** (решение владельца, ADR-010, §17.11): «Объясни иначе» (6 стилей, свой вопрос, «Ещё вариант»), «Объясни своими словами» с оценкой 1–10, «Спросить, что не так» у SQL-задачи. edu-backend: промпты `AssistPrompts`, порт `TextModel` и адаптер MiniMax (Anthropic-совместимый API, поток), SSE с keep-alive, квота с резервом под блокировкой, кэш ответов по стилю, слоты, `SAFE_MODE`, метрики. edu-web: BFF `POST /api/books/:slug/assist/:kind` (только свой Origin, поток без буферизации, обрыв доходит до модели), сторы и безопасный рендер Markdown в React-элементы.
- **edu-web по правилам платформы:** MobX-сторы на классах с «use no memo» и тестом-сторожем; компоненты кита; тексты книги — namespace `book` в сообщениях; шапка, подвал, ошибки, смена языка и выход — как в id-web и pay-web; скелетоны загрузки и настоящие 404; паритет с оригиналом (песочницы выполняются сами при подходе к экрану, счётчики, якоря упражнений, текущий раздел в оглавлении, перемешивание на каждый визит, формулировки).
- **UI-кит:** Tabs, ToggleGroup, Progress, Notice и StatePanel, CopyButton; общие токены статусов и тени; у Button `sm` и `icon-sm` невидимая зона нажатия до 44 px; разделы в галерее `/design-system`.
- **admin-web:** панель ИИ-помощника на сводке Обучения, общая таблица прогресса читателей, типизированные действия аудита, общая схема причины во всех разделах.
- **gitops:** переменные `ASSIST_*` и необязательный секрет `edu-assist` в `edu.yaml`, `edu-assist` в `node/secrets.sh`, алерт `EduAssistantFailing`.
- **Документация:** глава 17 v1.1 (§17.5, §17.6, §17.9 TC-EDU-09/10, §17.11), ADR-010, http-errors, runbook (ключ, «Помощник не отвечает»), production, handoff, owner-checklist, DESIGN.md.

### Проверки 04.10

| Проверка | Окружение | Результат |
|---|---|---|
| `python tools/documentation/validate.py` | локально | pass, 2014 ссылок |
| `pnpm lint` | весь монорепо | pass, 1168 файлов (финальный код, после исправлений QA) |
| `pnpm typecheck` | весь монорепо | pass, 30 задач (финальный код) |
| `pnpm build` | весь монорепо | pass, 16 задач (финальный код) |
| `pnpm test` | весь монорепо, Testcontainers | pass, 28 задач, 1534 теста на финальном коде: contracts 33, edu-engine 74, ui 70, bff 56, db 14, nest-common 36, battleship-engine 25, auth-backend 88, notifications-backend 83, payments-backend 143, battleship-backend 128, edu-backend 146, id-web 13, pay-web 140, battleship-web 141, admin-web 184, edu-web 154, system-tests 6 |
| e2e | Playwright на production-сборках | финальный код: edu-web 107 pass (1 skip), admin-web 219; до исправлений QA, без изменений в этих приложениях после: battleship-web 118, pay-web 51, id-web 39 (настоящие auth и notifications), лендинг с галереей кита 136 (17 skip — проверки одного движка браузера). Нестабильный тест ожидания в «Объясни своими словами» (задержка фейка 300 мс) исправлен: 1500 мс, 5 из 5 повторов |
| Импорт книг заново на общем белом списке SVG | `tools/import-artifact.mjs` на оригинальных страницах | обе книги байт в байт как в `content/` |
| Живой MiniMax через адаптер и промпты | MiniMax-M3, ключ из локального `.env` | «Объясни иначе»: первый текст 1,0–1,6 с, ответ 4–8 с; «Объясни своими словами»: оценка распознана, 18–26 с; подсказка к SQL — см. ниже |
| Живой сквозной прогон | локальные auth-backend (JWKS), edu-backend, edu-web; PostgreSQL, Valkey, RabbitMQ | статус `enabled: true`; поток через BFF: первый текст 1,3 с, ответ 5,6 с, 15 фрагментов; повтор того же стиля из кэша за 0,2 с, лимит не тратится; обрыв в браузере останавливает модель (`aborted`); чужой Origin — 403, без сессии — 401; глава в браузере: панель, стили, блок кода, «Ещё вариант», «Осталось 19 из 30»; в логах нет промптов, ответов и ключа |
| Подсказка к SQL, найдено живьём | MiniMax-M3 | без размышления модель выдала исправленный запрос целиком и ошиблась в правилах кавычек PostgreSQL; с `adaptive` и ужесточённым промптом — только фрагмент и верные факты (первый текст 4,5–9,5 с); закреплено тестом |
| Docker | `docker buildx bake edu-web edu-backend` (`BUILD_APPS=edu-web edu-backend`), linux/amd64 | собраны дважды, последний раз на финальном коде: edu-web 399 МБ, edu-backend 469 МБ. edu-backend: миграции применены, обе книги `unchanged`, `/health/deep` ok (PostgreSQL, Valkey, RabbitMQ), `@outegro/edu-engine` и `content/` в образе, uid 1000. edu-web: `/health` ok, `/` 200 с CSP на nonce и `private, no-store`, BFF помощника без Origin — 403, uid 1000 |
| Секреты | рабочие деревья обоих репозиториев | ключа MiniMax и токенов в изменениях нет; локальные `.env` в `.gitignore` |

### Финальное QA-ревью и исправления

Независимое ревью (агент QA, только чтение) по правилам `.claude/agents/*.md`: P0 нет, три P1 и ряд P2. Исправлено до слияния:

- **P1.** Оценка понимания терялась при других вариантах Markdown («**Оценка понимания**: 8», «… **8**», «— 8 из 10», строчные): разбор принимает их, берёт последнюю строку, значения вне 1–10 не обрезает, а отбрасывает. Удаление секрета `edu-assist` без перезапуска не выключало помощника: спецификация и runbook требуют `rollout restart`. Списки читателей в админке запрашивали имя каждого читателя у Identity (25 запросов на страницу при лимите 120 в минуту): теперь короткий ID со ссылкой на карточку, e2e проверяет ноль таких запросов.
- **P2, edu-backend.** Ответ модели не попадает в лог при сбое записи кэша (безопасная сводка ошибки); данные удалённого читателя не возвращаются, если ответ или попытка были в пути (общая блокировка с удалением); уход из очереди к модели считается `aborted`; одинаковые правила с другим порядком `features` не меняют версию; конвертер и импорт отказываются от SQL-задач больше 200 строк или 100 столбцов и от SVG, не прошедшего `isSafeSvg` (`>` в атрибутах экранируется); общий дневной потолок расходов `ASSIST_GLOBAL_DAILY_LIMIT` (503 `paused`, алерт `EduAssistantPaused`, расход на сводке админки).
- **P2, edu-web.** Помощник скрыт, пока статус неизвестен; «приостановлен» без повтора; ограничение размера тела 96 кБ с понятной ошибкой вместо бесполезного повтора; фокус не теряется при исчезновении кнопок; «Вернуть исходный» не срабатывает во время запуска; офлайн-состояние песочницы; резерв трёх строк статуса на 360 px; проверка e2e на элементы за краем экрана; подписи для экранных чтецов (счётчики оглавления, карточки, язык обложки); оставшиеся правила упражнений — в `@outegro/edu-engine`; цвет книги — только у схем и интерактива.
- **P2, admin-web.** Зона нажатия ссылки «назад» 44 px; состояния грантов (запланирован, действует, истёк, отозван) по окну действия; «было → стало» в аудите Обучения; неизвестное действие аудита не ломает ленту.
- **Документация и ops.** Порядок проверок, область ключа идемпотентности, `messageKey`, `/cards`, потребители событий, метрики edu-backend и алерты в observability, шаги runbook и комментарии gitops, очистка кавычек при передаче ключа.

### Сознательно не перенесено

- Тёмная тема оригинала: платформа не следует теме ОС (DESIGN.md).
- Сохранение прогресса без входа: ни одна книга не `free`, читать без входа нельзя.

### Отдельные задачи (вне Обучения)

- nest-common: слишком большое тело запроса отвечает 500 во всех сервисах; ожидаемые 503 пишутся в лог как ошибки.
- UI-кит: при первом холодном открытии русской главы замена кириллического шрифта сдвигает вёрстку на 0,034 (цель платформы 0,02).
- admin-web: пять страниц других разделов с инлайн-стилем у ссылки «назад» (`BackLink` уже есть); pay-web и admin-web пока со своими тенью и мягкими цветами статусов (значения отличаются от кита).
- `assist_cache`: ответы прошлых версий книг и моделей не удаляются.

## Выкатка в production (05–06.10)

| Шаг | Что сделано | Проверка |
|---|---|---|
| 0 | `pg-edu` создан на сервере, `edu-assist` — ключ MiniMax через stdin; оба запечатаны (`0c6d5cc`) | секреты «created/set», остальные «kept»; SealedSecret синхронизированы контроллером |
| 1 | gitops `75e3f53`: роль и база `edu`, OAuth-клиент `edu-web`, записи образов, алерты помощника | Argo Synced/Healthy; `Database edu` applied; auth-backend перезапущен, в его окружении есть `edu-web` |
| 2 | слияние platform#97 → CI (повтор после нестабильного системного теста) → образы 11 приложений, gitops `776a346` | девять приложений на `f5ef90dcda1a`, без перезапусков и OOM; smoke 26/26 (`SMOKE_SKIP=edu`) |
| 3 | gitops `dee4b10`: `edu.yaml`, пробы watchdog, `EDU_API_URL` админки | Job `edu-migrate`: «migrations applied», обе книги `inserted`; smoke 30/30; `/health/deep` ok; watchdog 0 failing; цель edu-backend up; алертов нет (кроме служебного Watchdog); админка → edu-backend 200; MiniMax из пода 200; MemAvailable 1609 МиБ |

Публично: `https://edu.outegro.dev` — библиотека с обеими книгами, страницы книг и глав 200, несуществующие книга и глава — 404, CSP с nonce, `private, no-store`, HSTS. Помощник включён (`ASSIST_ENABLED=true`, ключ задан, MiniMax-M3, лимиты 30 и 500). Живой ответ помощника читателю после входа не проверен: у агента нет аккаунта на платформе.

По ходу: 05.10 примерно 22:45–23:55 UTC сервер был недоступен по сети (Cloudflare 522, SSH не отвечал), но не перезагружался — новые версии в это время ещё не применялись; затем инцидент GitHub не пускал Argo по SSH-ключу gitops, после его окончания Argo применил релиз сам.

## Ограничения и незавершённое

- Продажа: продукта Education в каталоге Payments нет (цена, период и оффер Lava — решение владельца; в production продажи включены глобально). Ссылка на подписку в edu-web проверена unit-тестами, сценарий с настоящим продуктом — после решения.
- Скриншоты pay-web в git (`apps/pay-web/e2e/screenshots/account-menu--*`) сняты до появления Education в меню; перегенерация переписывает все 66 снимков, оставлена владельцу.
- Turbopack кладёт исходник воркера песочницы (`sql.worker.<hash>.ts`) рядом с чанком как несвязанный файл — свой код, без секретов.

## Откат

Код — не сливать ветку или revert слияния. Production — `git revert` коммита шага 3 в gitops (поды и Ingress уходят, база `edu` и прогресс читателей остаются).

## Следующий шаг

Владелец: войти на edu.outegro.dev, выдать себе доступ из админки («Доступы к продуктам» → «Обучение — все книги»), проверить ИИ-помощника на главе; решение о продаже и, при желании, ссылка на Обучение на лендинге.
