from seed_task_details import t

t('ID-01','BE-03 BE-04', 'Identity владеет кодом входа. Доставка будет подключена N-02 через интерфейс; local fake не доказывает доставку email.',
'Описать LoginChallenge с hash/expiry/attempts/consumedAt и neutral response § Реализовать start/resend/verify с атомарным consume и несколькими rate-limit keys § Подключить delivery port с fake для тестов; очищать plaintext после передачи § Создавать verified user/session только после успешной проверки и зафиксировать audit без кода',[
'Одноразовый код | Валидный challenge | Дважды verify одним кодом | Первый вход успешен, второй отклонён без новой сессии',
'Expiry | Clock после expiresAt | Verify правильный код | Код отклонён, сессия не создана',
'Перебор | Неверные коды до лимита | Проверить следующий запрос | Rate limit действует; ответ не раскрывает наличие email',
'Конкуренция | Два verify одновременно | Выполнить запросы через барьер | Только один consume; plaintext отсутствует в logs'])
t('ID-02','ID-01', 'Совпавший email не доказывает владение существующим аккаунтом. Linking требует отдельной проверки.',
'Реализовать Google callback validation по library docs и проверку provider subject/verified email § Для входа и привязки использовать разные use cases § При совпавшем email требовать существующую verified session/link intent, не auto-merge § Обработать unlink с защитой последнего способа и audit',[
'Новый вход | Проверенный provider subject | Пройти callback | Один user/identity, повтор callback не дублирует',
'Захват | Provider email совпадает с другим user, владение не доказано | Попытаться link | Существующий account не присоединён автоматически',
'Unlink | Единственный способ входа | Удалить identity | Отказ с понятным кодом; альтернативный verified способ позволяет unlink'],['GOOGLE-OAUTH'])
t('ID-03','ID-01', 'Гонку вкладок и потерянный ответ refresh нельзя трактовать одинаково с атакующим reuse.',
'Записать rotation contract: family/version, retry window, hash storage и доказательство допустимого retry § Реализовать single-flight и атомарную конкуренцию между процессами § Обработать потерянный ответ без выдачи бесконечного grace window § Добавить current/all revoke и fail-closed на недоступной проверке чувствительного запроса',[
'Две вкладки | Один session refresh version | Одновременно refresh из двух клиентов | Результат согласован с rotation contract, легитимная гонка не завершает всю сессию',
'Потерянный ответ | Ротация commit, HTTP response сброшен | Повторить в разрешённом окне | Клиент восстанавливается без неограниченного повторного использования',
'Атакующий reuse | Старый token вне retry window | Refresh | Family отозвано, security event не содержит token',
'Logout all | Несколько сессий user | Revoke all и чувствительный запрос | Все прежние сессии отклонены'])
t('ID-04','ID-03 BE-04', 'Центральный вход обслуживает разные origins. Протокол сначала выбирается и фиксируется, реализация не выдаётся за OIDC по одному названию endpoint.',
'Закрыть ADR выбора protocol library и issuer/client model на минимальном spike § Реализовать registered clients/exact redirect URI/state/PKCE/code expiry § Создать BFF обмен code и host-only HttpOnly Secure session cookie каждого app § Проверить logout и запрет frontend хранения refresh, описать CSRF boundary',[
'Cross-app | User начинает вход на pay | Пройти id и вернуться | Pay получает собственную session cookie, auth secret отсутствует в JS',
'Code binding | Code для client A/redirect A | Обменять из client B или redirect B | Отказ, сессия B не создана',
'Повтор | Code уже обменян | Обменять ещё раз | Отказ одноразового code',
'Подмена | Неверные state/PKCE или wildcard redirect | Пройти callback | Отказ до выдачи session'])
t('ID-05','ID-04', 'Новый passkey RP id.outegro.dev не переносит credentials старого домена.',
'Закрепить RP/origin config до регистрации credentials § Реализовать challenge/verify registration и authentication через проверенную WebAuthn library § Добавить список/name/delete и user verification policy § Сохранить recovery instructions, не делая email-only обходом сильного admin входа',[
'Passkey | Verified owner session и поддерживаемый authenticator | Зарегистрировать и войти | Challenge одноразовый, credential связан с правильным user',
'Origin | Assertion от другого origin/RP | Verify | Отказ, новая session не создана',
'Удаление | Credential последний пригодный способ | Delete | Отказ или явно завершённый альтернативный recovery workflow',
'Replay | Used challenge | Verify повтор | Отказ без нового authentication'])
t('ID-06','BE-03 BE-04', 'Административные permissions отделены от оплаченных product grants.',
'Создать Role/Permission/RolePermission/RoleBinding/AccessVersion с constraints § Seed системные роли и явную матрицу permissions § Реализовать policy guard по permission/scope/expiry и ownership checks § Добавить mutation version, audit и invalidation; неизвестное permission всегда deny',[
'Paid не admin | User имеет paid grant, но no role | Вызвать admin endpoint | 403 без side effects',
'Scope | Support binding ограничен разрешённым scope | Действовать за пределами scope | Отказ на backend, UI не основание авторизации',
'Expiry | RoleBinding истёк | Выполнить чувствительную команду со старым token | Отказ по свежей проверке',
'Unknown | Неизвестное permission key | Проверить доступ | Deny-by-default'])
t('ID-07','ID-05 ID-06', 'Владелец назначается контролируемо, а не по первому signup. Последний owner должен оставаться восстанавливаемым.',
'Создать повторяемую private bootstrap-команду по заранее verified userId § Защитить снятие/блокировку последнего активного owner транзакционной проверкой § Добавить step-up proof с TTL/action scope для чувствительных commands § Описать owner recovery и проверить его в изолированной среде',[
'Первый signup | Пустая БД и обычная регистрация | Зарегистрировать первого user | Owner автоматически не выдан',
'Последний owner | Один active owner | Отозвать binding или заблокировать account | Отказ, audit содержит попытку',
'Гонка owners | Два owners снимают друг друга одновременно | Выполнить операции | Хотя бы один активный owner остаётся',
'Step-up | Старый или другой action proof | Назначить owner | Отказ до mutation'])
t('ID-08','BE-06 ID-06 PAY-06', 'Identity получает проекцию grants из Payments и не вычисляет оплату самостоятельно.',
'Создать CommercialGrantProjection и handler billing.grant.changed.v1 § Применять только новую aggregateVersion для конкретного grantId § Вычислять доступ как объединение действующих источников по UTC § Реализовать stale-check для чувствительных операций и rebuild из authoritative API',[
'Версии | Projection v3 revoked | Доставить v2 active | Отозванный доступ не воскресает',
'Источники | Два активных grants одного feature | Отозвать один | Второй продолжает давать право',
'Expiry | Cron остановлен, now после validUntil | Access check | Доступ по истёкшему источнику запрещён',
'Stale | Свежесть projection неизвестна | Чувствительная команда | Проверка authoritative сервиса либо безопасный отказ'])
t('ID-09','DS-05 ID-03 ID-04 ID-05 ID-07', 'Кабинет заменяет fixtures реальными API и даёт управление собственными данными.',
'Подключить profile/locale/session/auth methods API через typed BFF § Реализовать revoke current/other/all, passkey management и confirmations § Показывать product access read model, empty/error/stale отдельно § Проверить EN/RU и не разрешать удаление последнего входа через UI обход',[
'Ownership | User A видит свою session list | Подставить sessionId user B в request | Backend отказывает, данные B не показаны',
'Locale | User явно выбирает RU | Reload и вход в другой сервис | Preference сохраняется; нет возврата на navigator default',
'Unavailable | Auth API временно недоступен | Открыть кабинет | Понятный error/retry, не фиктивная пустая история'])
t('ID-10','ID-04 ID-05 ID-07 ID-08', 'Набор негативных проверок закрывает auth release risk после интеграции компонентов.',
'Добавить integration cases для iss/aud/kid, revoke, role freshness, CSRF/Origin § Реализовать rotation runbook с overlap старого/нового JWKS § Проверить private/user/machine token boundaries § Записать evidence без raw tokens и unresolved issues',[
'Rotation | Старый ключ ещё валиден | Выпустить новым, проверить оба в overlap и после expiry | Новый работает, старый только в разрешённый срок',
'CSRF | Auth cookie есть, Origin чужой/CSRF invalid | Выполнить mutation | Отказ без side effect',
'Token confusion | Machine token на user endpoint и наоборот | Отправить запросы | Неверные aud/type отклонены',
'Revoke | Valid access token, user suspended | Sensitive mutation | Отказ несмотря на неистёкший JWT'])

t('N-01','BE-03 BE-04', 'Inbox и внешняя доставка имеют разные состояния и должны принадлежать конкретному user.',
'Создать intent/inbox/delivery/preferences schemas и unique source/channel keys § Реализовать create intent и inbox ownership queries § Разделить readAt, provider accepted и provider delivered § Добавить locale/category policy и version preferences',[
'Дубль intent | Один source event дважды | Создать notification | Один inbox item и одна delivery на канал',
'Read чужого | User A и item user B | Mark read B | Отказ, readAt B неизменен',
'Состояния | Email accepted, inbox unread | Получить UI model | Sent не отображается как read/delivered'])
t('N-02','N-01 ID-01 BE-02', 'Login code требует короткой приватной доставки, без широковещательного события с секретом.',
'Выбрать и записать ADR auth-delivery transport: private encrypted TTL queue либо закрытый adapter § Реализовать email adapter, template render и short-lived auth message § Подключить Identity delivery port с реальным статусом принятия/ошибки § Исключить код из logs/audit/DLQ previews; очистить временный payload',[
'Код | Валидный challenge с TTL | Передать auth-delivery в тестовый inbox | Письмо соответствует challenge, provider accepted записан',
'Истечение | Message дождался expiresAt в очереди | Возобновить worker | Устаревший код не отправлен',
'Provider down | Adapter возвращает timeout | Начать login | UI не сообщает ложную доставку, retry/cooldown понятны',
'Секрет | Тестовый код с уникальным маркером | Поиск в captured logs/audit | Маркер отсутствует'],['EMAIL-PROVIDER'])
t('N-03','N-02 BE-06', 'Delivery claim исключает конкурирующие workers, но crash после внешнего send остаётся отдельным случаем.',
'Реализовать atomic lease claim и attempt history § Отправлять вне DB transaction с provider idempotency, если поддерживается § Разделить temporary/permanent/expired/unknown; bounded retry и DLQ § Добавить controlled replay без дублирования inbox',[
'Два worker | Одна pending delivery | Claim одновременно | Только текущий lease owner отправляет',
'После send | Provider принял, DB result не записан | Crash/restart | Unknown/idempotent recovery согласно adapter; exactly-once не выдуман',
'Permanent | Неверный адрес | Обработать attempts | Остановка, без бесконечного retry',
'Replay | Dead-letter обычного сообщения | Повторить разрешённый command | Inbox не дублируется; auth-code replay запрещён'])
t('N-04','ID-09 N-01', 'Telegram платформенных уведомлений отделён от личного Hermes bot и его topics.',
'Создать short-lived one-time link intent для текущего user § Обработать подтверждение ботом и связать verified chat с account § Добавить unlink и проверку актуальности связи перед send § Сохранить отдельные credentials/config для platform bot и Hermes',[
'Привязка | Link intent user A | Подтвердить один раз и повторить | Связь создана один раз, повтор rejected',
'Подмена | Intent истёк/принадлежит другому flow | Подтвердить | Account не привязан ошибочному chat',
'Unlink | Pending Telegram delivery | Удалить связь до claim | Новое сообщение в удалённый chat не отправлено'],['PLATFORM-TELEGRAM'])
t('N-05','DS-05 N-01 ID-09', 'Inbox живёт в id-web и общих компонентах, отдельный notification frontend не нужен.',
'Добавить list/unread/read-all/preferences typed API § Подключить UI с pagination и category filter § Реализовать optimistic state с rollback при ошибке либо server-confirmed update § Проверить safe links и EN/RU во всех состояниях',[
'Unread | 3 unread и 1 read | Read one и read all | Счётчик совпадает с backend, повтор команд безопасен',
'Чужой resource | Подставлен userId/itemId | GET/PATCH | Backend не раскрывает чужое сообщение',
'Ошибка save | Preferences API отказал | Сменить настройку | UI показывает несохранённое состояние, не заявляет success'])
t('N-06','N-02 BE-04 PAY-05 PAY-07', 'Billing/security сообщения отражают committed факт; текст не должен выдавать ещё не подтверждённый доступ.',
'Создать EN/RU templates payment/subscription/security с версионированными keys § Подключить consumers подтверждённых событий и locale resolution § Вставлять только allowlisted deep links и escaped user text § Добавить snapshots для смысловых полей и проверку secret redaction',[
'Locale | Один billing event для EN и RU user | Render/send fake | Правильный язык, суммы/даты/статусы точны',
'Pending grant | Payment confirmed, projection lag | Render сообщение | Не обещает уже доступную функцию до фактической активации',
'XSS/link | В имени HTML и action URL чужого origin | Render/validate | Текст escaped, опасный redirect отклонён'])
