"""Authoring data for the initial v0.3 task pack; not a product runtime."""
TASKS = {}
def t(id, deps, context, steps, tests, external=()):
    TASKS[id] = dict(dependencies=deps.split(), context=context, steps=steps.split(' § '), tests=[x.split(' | ') for x in tests], external=list(external))

# Identity, notification and billing task details follow the same explicit schema.

t('BOOT-01','', 'Новый каталог содержит только документацию. Нужен независимый репозиторий с сохранённой документацией и явными границами.',
'Проверить существующие файлы и наличие .git; сохранить inventory, ничего не перезаписывать § Создать локальный Git-репозиторий, если его нет; remote не угадывать § Добавить .gitignore для env/secrets/build/cache и шаблон .env.example без значений § Зафиксировать дерево apps/packages/infra/tests как структуру, пока без массового копирования старого кода',[
'Сохранность | В корне есть docs и AGENTS.md | Сравнить inventory до/после bootstrap | Документация сохранена; старый каталог не изменился',
'Секреты | Создать локальный тестовый .env с ненастоящим значением | Проверить git check-ignore и staged diff | .env исключён, .env.example содержит только имена переменных',
'Повтор | Bootstrap уже выполнен | Повторить проверку готовности | Нет второго .git, дублей или сброса истории'])
t('BOOT-02','BOOT-01', 'Повторно используем полезный код OuteGro, но переносим только явно выбранные компоненты и не наследуем старую production-среду.',
'Составить список старых приложений и shared packages из repository-map § Для каждого нужного файла записать reuse/rewrite/drop и причину § Проверить выбранные файлы на hardcoded домены, secrets, Prisma и старый branding § Подготовить manifests переноса по этапам; переносить landing/UI на первом этапе, backend позже',[
'Полнота | Нужны landing/id/auth/notif/pay и shared UI/contracts | Сопоставить список с исходным деревом | Для каждой области есть решение и источник',
'Исключения | В старом проекте есть budget/trips/itmaxxing | Просмотреть manifest | Эти приложения не включены, secrets и данные отсутствуют',
'Независимость | Новый проект использует fresh DB | Проверить план переноса | Нет restore старых users/passkeys/payments'])
t('BOOT-03','BOOT-02', 'Визуальный этап должен собираться независимо от будущих backend и Kubernetes.',
'Создать минимальный pnpm workspace с landing-web, ui, contracts/config и Turborepo tasks § Выбрать точные совместимые версии frontend по текущим docs; записать lockfile и версии runtime § Перенести только выбранные skeleton/config файлы без бизнес-страниц старого бренда § Проверить импорт ui и typed fixtures из landing; backend-запуски не требуются',[
'Чистая установка | Новый checkout и зафиксированный lockfile | Выполнить documented install и landing build | Сборка проходит без локальных неопубликованных пакетов',
'Граница | Backend и provider credentials отсутствуют | Запустить landing preview | Landing работает, не обращается к старому production',
'Воспроизводимость | Установленные версии известны | Сравнить package manifest, runtime и lockfile | Нет конфликтующих package managers и плавающей версии runtime'])
t('BOOT-04','BOOT-03', 'Исполнитель должен знать реальные команды проверки, а не угадывать их из текста плана.',
'Создать scripts lint/typecheck/test/build для существующих packages, без пустых success-заглушек § Настроить UI preview и минимальный test runner; integration/e2e команды добавлять вместе с реальными harness § Записать docs/05-quality/command-map.md: cwd, команда, окружение, результат § Проверить каждую записанную команду; недоступные будущие проверки пометить not_available',[
'Команды | Есть package.json выбранных workspaces | Выполнить command map | Все enabled команды существуют и имеют реальные результаты',
'Ошибка | Внести обратимую type error в тестовую ветку | Запустить typecheck | Команда возвращает nonzero; после исправления проходит',
'Безопасность | Нет production keys | Выполнить test и build | Проверки не вызывают реальный платёж или deploy'])
t('L-01','BOOT-04', 'Публичный сайт должен быстро объяснять, кто Nick и чем полезен. Кейсов ещё нет.',
'Прочитать решения D-01…D-18 и выписать audience/основной CTA § Зафиксировать секции hero, expertise, approach, projects placeholder, contact § Для каждой секции определить одно сообщение, содержание и переход пользователя § Сохранить content-map с обязательными/необязательными полями и запретом фиктивных кейсов',[
'Идентичность | Brief владельца | Проверить имена и домены во всех секциях | Только Nick Lukashik и outegro.dev как публичный бренд',
'Projects | Нет готовых кейсов | Проверить wireframe и CTA | Заглушка честная, отсутствуют ссылки на несуществующее demo',
'Контакт | Реальные ссылки пока не выбраны | Просмотреть модель контента | Поля обозначены pending, выдуманных адресов нет'])
t('L-02','L-01', 'Профессиональные сведения уже предоставлены. Текст должен показывать компетенции без приписанных результатов.',
'Создать согласованный EN/RU content object с одинаковыми ключами § Написать hero и expertise по подтверждённым TS/React/Next/Nest/DB/DevOps компетенциям § Дать короткие описания подхода и projects placeholder, не придумывая клиентов/метрики § Отметить неполученные контактные ссылки отдельно от публичных строк',[
'Два языка | EN и RU content | Сравнить ключи и смыслы | Все обязательные ключи существуют, перевод не меняет факты',
'Доказательства | Нет цифр улучшения CWV и названий клиентов | Прочитать тексты | Нет придуманной статистики/отзывов',
'Длина | RU строки длиннее EN | Подставить строки в content preview | Нет ручных переносов внутри слова и невидимого CTA'])
t('DS-01','L-01', 'Одна дизайн-система должна объединить эффектный landing и читаемые формы/таблицы сервисов.',
'Определить semantic colors: canvas/surface/text/muted/border/accent/status без привязки компонентов к hex § Выбрать шрифт с кириллицей, начертаниями и разрешённым использованием; записать источник § Описать typography/spacing/radius/elevation/focus/motion tokens § Создать gallery контраста и silver/glass surfaces; form/table поверхности оставить читаемыми',[
'Контраст | Текст и все статусы на реальных surfaces | Измерить контраст для обычного/крупного текста и focus | Выполнены принятые WCAG AA критерии без зависимости от цвета',
'Кириллица | EN/RU наборы и числа | Сравнить glyphs и font loading | Нет missing glyph, скачка на случайный системный шрифт',
'Токены | Две темы поверхности и состояния ошибки | Изменить semantic token в gallery | Все связанные компоненты обновляются без локальных hex overrides'])
t('L-03','DS-01 L-02', 'Выбран стиль жидкой подписи. Нужно конкретное изображение композиции до кода сцены.',
'Прочитать установленные taste/image-to-code skills и визуальные референсы § Подготовить читаемые desktop/mobile hero варианты внутри silver signature, не новые несвязанные концепции § Отдельно описать форму подписи, свет, материал, фон, место текста и CTA § Выбрать рабочий вариант по читаемости/узнаваемости/стоимости рендера и сохранить annotated brief',[
'Читаемость | Макет на small laptop и mobile | Посмотреть первый экран в масштабе 100% | Имя, роль и основной CTA видны без скрывающей их сцены',
'Авторство | Исходные референсы | Сопоставить форму/контент | Не скопированы персонажи, имя и достижения другого автора',
'Реализуемость | Описание материала и motion | Проверить список эффектов | Есть fallback и перечень обязательных/опциональных эффектов'])
t('L-04','L-03', 'Нужен изолированный R3F prototype серебряной подписи, чтобы оценить качество до встраивания в hero.',
'Создать отдельно запускаемую сцену с выбранной формой и освещением § Добавить плавную ограниченную деформацию и реакцию указателя без React state update на каждый кадр § Добавить pause вне viewport/hidden tab и reduced-motion/static вариант § Освобождать GPU resources при unmount, обработать WebGL unavailable/context loss',[
'Жизненный цикл | Сцена открыта | 20 раз mount/unmount и проверить renderer/resources | Не растёт число listeners/canvas и удержанных ресурсов',
'Fallback | WebGL недоступен или context потерян | Открыть страницу/вызвать потерю context | Текст и CTA работают, виден согласованный poster',
'Motion | prefers-reduced-motion включён | Открыть/переключить вкладку | Деформация остановлена или минимальна согласно DS, скрытая вкладка не рендерится'])
t('L-05','L-04', '60 FPS и чёткая картинка конфликтуют с неограниченным DPR; качество выбирается по измерениям.',
'Зафиксировать устройства/браузеры/размер viewport и режим питания § Измерить frame time после прогрева и 5 минут движения, отдельно page load § Настроить tiers geometry/DPR/postprocessing с hysteresis, без снижения чёткости DOM § Сохранить отчёт raw samples, p50/p95, dropped frames и выбранные defaults',[
'Цель | Согласованное 60-Hz устройство, прогретая сцена | Записать 5-минутный trace | Отчёт показывает целевой frame budget около 16.7 ms и причины отклонений, pass только по согласованному порогу',
'Деградация | Ограничить GPU/CPU в воспроизводимом профиле | Наблюдать downgrade/upgrade | Нет дрожания между tiers; текст остаётся чётким',
'Стабильность | Долгая сессия/смена viewport | Повторить тест после resize | Нет утечки памяти и резкого длительного freeze'],['DEVICE-MATRIX'])
t('DS-02','DS-01 BOOT-03', 'Формы входа и оплаты должны использовать одинаковые доступные primitives.',
'Реализовать Button/Link/FormField/Input через semantic tokens § Добавить disabled/loading/error/success, labels и описания ошибок § Привязать keyboard/focus и aria к реальным элементам, не clickable div § Создать gallery с EN/RU, длинными labels и async submit',[
'Keyboard | Форма из gallery | Пройти Tab/Shift-Tab/Enter/Space | Фокус виден, порядок логичен, действия срабатывают один раз',
'Ошибка | Невалидное поле | Отправить форму | Ошибка связана с полем и доступна screen reader',
'Повтор submit | Promise отправки pending | Нажать кнопку несколько раз | UI исключает случайный повтор, не подменяя серверную idempotency'])
t('DS-03','DS-02', 'Диалоги и меню нужны всем приложениям и не должны терять focus или переключать язык неожиданно.',
'Реализовать Dialog/Menu/LocaleSwitch/Toast с выбранными primitives § Определить focus trap, Escape, возврат фокуса и outside click § Добавить live announcements только для значимых событий § Проверить touch/keyboard и длинные RU подписи в gallery',[
'Dialog | Открыт с кнопки | Tab до конца, Escape | Фокус остаётся внутри и затем возвращается к trigger',
'Locale | EN экран и открытое меню | Выбрать RU клавиатурой | Метка/сообщения обновлены, выбор сохраняется явно',
'Toast | Несколько ошибок подряд | Прослушать announcements/закрыть | Нет бесконечного спама и перекрытого основного действия'])
t('DS-04','DS-02', 'Админка и payments показывают длинные ID, суммы и состояния. Декоративный glass не должен мешать чтению.',
'Создать DataTable/filter/pagination/status/timeline/Amount primitives § Описать loading/empty/error/partial/stale состояния и mobile overflow § Суммы форматировать по currency metadata из exact representation, без float arithmetic § Добавить copy ID, доступные названия статусов и поддержку длинных значений',[
'Данные | 64-символьные IDs, RU labels, большие суммы | Открыть 390px и desktop | Колонки/действия доступны, нет наложения текста',
'Валюты | USD 12345 minor, currency с иным scale | Отобразить fixtures | Формат соответствует scale, валюта явно видна',
'Partial | Один источник read model недоступен | Показать screen state | Устаревшие данные помечены, destructive actions не маскируются как безопасные'])
t('DS-05','DS-03 DS-04', 'Shell-макеты заранее доказывают, что общая DS подходит landing/id/pay/admin.',
'Собрать навигацию и layouts трёх service fronts на typed fixtures § Покрыть login/profile/payment history/admin table и error/empty states § Убрать локальные дубли tokens/components в пользу ui package § Пометить fixture mode и не подключать реальные providers на этом этапе',[
'Единство | Landing/id/pay/admin shell | Изменить общий token и посмотреть все shells | Изменение согласовано, функциональная плотность экранов сохраняется',
'States | Fixtures empty/error/forbidden/stale | Переключить каждое состояние | Нет пустых белых экранов и фиктивного успеха',
'Изоляция | Provider credentials отсутствуют | Просмотреть все shells | Ни один UI не вызывает production API'])
t('L-06','L-02 BOOT-03', 'Текущая основа выбирала RU из браузера. Новый сайт начинает с EN независимо от navigator.',
'Установить единый locale resolver: URL/явный выбор, затем профиль для service UI, fallback EN § Настроить / и /ru для landing с next-intl по текущим docs § Добавить language links, canonical/hreflang и отсутствие авто-RU redirect первого визита § Настроить словари ошибок/чисел/дат и сохранить ручной выбор без общей auth cookie',[
'Первый визит | Новый профиль браузера Accept-Language ru | Открыть / | Показан EN, нет автоматического перехода на /ru',
'Явный выбор | Открыт /ru | Reload и переход по внутренним ссылкам | RU сохраняется в пределах выбранного языка',
'Metadata | EN/RU страницы | Прочитать HTML до hydration | Lang/canonical/hreflang соответствуют URL'])
t('L-07','L-05 L-06 DS-03', 'Hero должен работать до загрузки тяжёлой сцены и сохранять ясный путь к контакту.',
'Сверстать header/hero по выбранному макету с server-rendered текстом § Подключить сцену lazy после критичного контента и зарезервировать размеры § Реализовать anchors/mobile menu/CTA без scroll hijack § Проверить scene fallback и pointer layer: canvas не перехватывает links',[
'Без JS | Отключить JavaScript/WebGL | Открыть landing | Имя/роль/контакт доступны в HTML, layout не исчезает',
'Медленная сеть | Ограничить загрузку assets | Открыть первый экран | CTA доступен до сцены, нет значимого layout jump',
'Указатель | Canvas перекрывает визуальную область hero | Нажать/Tab по CTA | Links не блокируются сценой'])
t('L-08','L-02 DS-02 L-06', 'Компетенции заменяют отсутствующие кейсы; visitor не должен принимать заглушку за готовый проект.',
'Сверстать expertise с коротким объяснением практического применения технологий § Добавить approach без неподтверждённых достижений § Создать Projects placeholder с будущим обновлением, без неработающих карточек § Проверить якоря, порядок headings и обе локали',[
'Контент | Предоставленные профессиональные сведения | Сопоставить секции с источником | Нет чужих проектов и выдуманных компаний',
'Заглушка | Projects пуст | Нажать все видимые элементы | Нет demo buttons с # и ложных доступных приложений',
'Адаптивность | 320/390/768/1440px | Просмотреть EN/RU | Секции читаемы, нет горизонтального scroll страницы'])
t('L-09','L-06 L-08', 'Контакты должны вести к реальному человеку; private service страницы не должны индексироваться.',
'Получить подтверждённые public contacts и хранить их в одном content config § Сделать footer/mail/contact links с понятными названиями § Настроить title/description/OG/canonical/sitemap/robots для landing § Проверить noindex service/private routes в общей политике, не выдавая robots за access control',[
'Контакт | Проверенные owner ссылки | Открыть каждый CTA | Правильный получатель/профиль, нет placeholder email',
'SEO | HTML EN/RU | Сравнить metadata и sitemap | Оба языка корректны, нет старого домена',
'Приватность | Private route | Проверить auth и indexing headers | Данные защищены auth, noindex применён отдельно'],['PUBLIC-CONTACTS'])
t('L-10','L-07 L-08 L-09 DS-05', 'Gate A заканчивает landing/DS до backend-этапа. Красивый desktop screenshot не заменяет mobile/a11y/performance приёмку.',
'Выполнить viewport/browser/locale matrix из quality guide § Проверить keyboard, focus, reduced motion, unavailable WebGL и touch § Снять Web Vitals/lab report и frame profile, разделить реальные измерения и прогноз § Сохранить Gate A report с найденными дефектами и устранёнными блокерами',[
'Матрица | Согласованные браузеры/устройства, EN/RU | Пройти обязательные UI cases | Все P0 pass; unavailable hardware отмечен как blocked, не pass',
'Navigation | Keyboard-only и mobile touch | Пройти все секции/контакт | Нет недоступных действий и ловушек focus',
'Gate | Список L/DS задач | Проверить артефакты и отчёты | Все обязательные результаты доказаны; код backend ещё не нужен'])
t('BE-01','L-10', 'Nest 12, AMQP adapter и Drizzle нельзя обновлять одним force override. Нужен минимальный совместимый runtime.',
'Создать отдельный минимальный Nest app на выбранной Node patch и Nest 12 § Проверить ESM/CJS требования зависимостей, build/start/shutdown и test runner § Зафиксировать compatible exact versions в compatibility matrix и lockfile § Перенести только backend skeleton выбранных сервисов после успешного spike',[
'Старт | Чистая установка выбранной матрицы | Build/start/health/shutdown | Нет peer/runtime ошибок, процесс завершается корректно',
'Тесты | Minimal module и DB adapter stub | Запустить существующий test runner | Тесты реально исполняются, не выключены ради миграции',
'Peer mismatch | Старый AMQP wrapper требует Nest 11 | Проверить dependency tree | Конфликт документирован и решается BE-02, не скрыт force'])
t('BE-02','BE-01', 'Транспорт обязан переживать reconnect и подтверждать публикацию. Совместимость Nest по peer range сама по себе этого не доказывает.',
'Сравнить поддерживаемый Nest adapter и тонкий AMQP adapter по текущим docs § Реализовать connection lifecycle, publisher confirms, ack/nack и bounded prefetch § Добавить reconnect/backoff и graceful drain § Зафиксировать выбранный transport contract без бизнес-логики',[
'Confirm | Broker доступен и очередь привязана | Publish с confirm | Caller получает подтверждение; nack/error не отмечается как успех',
'Reconnect | Worker потребляет сообщение | Остановить/восстановить тестовый broker | Connection восстановлен, unacked message доступен заново',
'Shutdown | Есть in-flight handler | Послать termination | Новые messages не берутся, незавершённое не теряется'])
t('BE-03','BE-01', 'Каждый сервис получает собственную новую схему. Эта задача создаёт инфраструктуру миграций, а предметные таблицы дополняют domain tasks.',
'Создать Drizzle config/schema/migrations entrypoint отдельно для пяти DB владельцев § Определить IDs/UTC/exact amounts/version conventions из contracts § Проверить SQL bootstrap на пустой тестовой PostgreSQL и повтор seeds § Подготовить migration test harness; не пытаться угадать все будущие domain columns',[
'Bootstrap | Пустые logical DB | Применить начальные migrations/seeds | Все базовые схемы созданы, нет обращения к legacy DB',
'Повтор | Migration уже применена | Запустить runner ещё раз | Нет повторного DDL/seed дублей',
'Ошибка | Тестовая некорректная migration | Запустить runner | Nonzero, дальнейший rollout блокируется, ошибка видна'])
t('BE-04','BE-01', 'DTO и event schemas должны быть согласованы до независимой реализации сервисов.',
'Создать contracts package по HTTP/event/error/money документам § Зафиксировать schemaVersion/eventId/correlation/aggregateVersion и валидаторы § Добавить valid/invalid fixtures без PII/secrets и compatibility checks § Опубликовать internal client interfaces и error-code registry для будущих реализаций',[
'Schema | Валидное событие v1 | Parse/serialize roundtrip | Смысл и exact amounts сохраняются',
'Невалидное | Нет eventId или неизвестная версия | Вызвать validator | Controlled rejection/quarantine contract, не process crash',
'PII | User/event fixtures | Проверить поля по allowlist | Нет login code, refresh, cookie и полного user object'])
t('BE-05','BE-02 BE-03 BE-04', 'Сеть не должна удерживать бизнес-транзакцию. Outbox фиксирует событие вместе с изменением, relay допускает дубли транспорта.',
'Создать outbox schema с eventId/state/lease/attempts и уникальностью § Реализовать business transaction helper и короткий atomic claim пачки § Публиковать вне DB transaction с confirms и mark по lease token § Добавить recovery expired lease, ограничение пачки и metrics',[
'Broker down | Business command и выключенный broker | Commit команду | Domain row+outbox сохранены; событие уйдёт после восстановления',
'Crash window | Publish confirmed, mark ещё нет | Убить relay и перезапустить | Возможно повторное событие с тем же ID, потери нет',
'Два relay | Одинаковая pending пачка | Запустить одновременно | Claim исключает одновременную обработку в пределах lease; stale worker не меняет новую lease'])
t('BE-06','BE-05', 'Consumer обрабатывает доставку at-least-once, но бизнес-эффект должен оставаться единственным.',
'Создать inbox unique(consumer,eventId) и транзакционный handler boundary § Сохранить processed marker вместе с business effect, ack после commit § Реализовать bounded retry для transient и quarantine для invalid schema § Добавить controlled replay исходного eventId и retry observability',[
'Дубль | Одно eventId доставлено 10 раз | Обработать всеми workers | Ровно один business effect и один processed marker',
'Crash | Commit произошёл, ack нет | Перезапустить worker | Повтор ack без нового effect',
'Poison | Schema invalid | Доставить сообщение | Quarantine с redacted reason, без бесконечного requeue'])
t('BE-07','BE-03', 'Runtime credentials не должны позволять DDL и чтение соседних баз.',
'Создать роли runtime/migrator для каждой logical DB § Отозвать default privileges и выдать runtime только нужные objects/actions § Развести config variables и secret references migration/runtime § Добавить тесты через реальные роли, не superuser',[
'Runtime | Подключение auth runtime | SELECT/INSERT своей таблицы | Разрешены нужные операции',
'DDL | То же подключение | CREATE/ALTER table | Permission denied',
'Соседняя БД | Auth credential | Подключиться/прочитать payments | Доступ запрещён; migrator не попадает в app env'])
