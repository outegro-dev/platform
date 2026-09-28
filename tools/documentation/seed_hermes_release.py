from seed_task_details import t

t('H-01','BE-01', 'Нужно подтвердить поддерживаемый Plus OAuth route и vision/catalog workload, не считать API key частью подписки.',
'Зафиксировать Hermes version/digest и проверить актуальные providers/runtime docs § Сравнить Hermes loop openai-codex и Codex app-server по нужным memory/tools § Подготовить account spike без API keys и выбрать доступную модель с vision § Записать route/plan/limits evidence и список auxiliary/tools, которые остаются отключены',[
'Route | Владелец вошёл через поддерживаемый OAuth | Выполнить разрешённый минимальный запрос | Account mode соответствует подписке, API-key mode не активен',
'Vision | Тестовое фото без личных данных | Проанализировать через выбранный route | Возвращено описание либо явный unsupported, нет paid fallback',
'Недоступность | Нет OAuth/account access | Проверить spike report | Blocked с конкретным input; поддержка не объявлена доказанной'],['CHATGPT-OAUTH'])
t('H-02','OPS-01 H-01', 'Hermes хранит SQLite/memory/config на PVC; два gateway над одним state недопустимы.',
'Создать agents namespace и pinned image config, один StatefulSet или Recreate Deployment § Подключить writable /opt/data PVC и рабочую директорию с quotas § Проверить entrypoint/securityContext официального image в test cluster § Добавить startup/health, graceful stop и исключение concurrent gateway',[
'Restart | Создана test session/memory | Перезапустить pod | Состояние восстановлено с PVC',
'Rollout | Старый pod ещё останавливается | Выполнить update | Нет двух активных gateway с одной SQLite/OAuth state',
'Privilege | Проверить rendered pod spec и runtime | Попробовать host socket/Kubernetes API | Нет privileged/host mounts/автомонтированного kube token'])
t('H-03','H-02', 'Refreshable OAuth state хранится приватно; immutable Secret не должен перетирать обновлённый token.',
'Провести владельцем device/browser login на официальной странице § Сохранить mutable auth state на private PVC с file permissions § Разделить channel bootstrap secrets и provider refresh state § Проверить expiry/revoke/reauth и отсутствие credentials в логах/backups общего доступа',[
'Persistence | OAuth login выполнен | Restart container | Сессия загружена либо понятный auth_required, не fallback API',
'Revoke | Владелец отзывает тестовую session | Следующий model call | auth_required и пауза, бесконечного retry нет',
'Redaction | Captured startup/error logs | Искать token/code markers | Credentials не выведены'],['CHATGPT-OAUTH'])
t('H-04','H-02', 'Помощник только для Nick. Chat-wide allowlist не должна давать права всем участникам группы.',
'Проверить exact owner userId AND разрешённый group chatId до dispatch tools § Запретить anonymous sender и неизвестные topics до регистрации § Ограничить tools/network/workspace/resource policy без platform secrets § Разделить Telegram permission gate и prompt rules, проверять scope в backend',[
'Посторонний | Другой участник в разрешённой группе | Отправить task/tool request | Агент не выполняет, owner access не наследуется от chat',
'Чужая группа | Owner пишет из неразрешённого chat | Отправить command | Отказ по chat gate',
'Injection | Фото/текст просит прочитать auth keys | Запустить через каталог | Tool scope не даёт доступ независимо от model ответа'],['HERMES-TELEGRAM'])
t('H-05','H-03 H-04', 'OAuth не гарантирует отсутствие extra-credit расхода. Нужно проверить весь маршрут model/auxiliary/tools.',
'Проверить отсутствие paid API keys/fallback и auto-routing § Проверить vision/compression/title/memory review и отключить платные auxiliary § Проверить account extra usage/credits/top-up controls и observable limits § Реализовать quota_exhausted pause, owner status и manual resume policy',[
'Quota | Fake provider возвращает usage-limit | Запустить задачу | Статус quota_exhausted, paid providers не вызваны',
'Auxiliary | Длинный контекст требует compression/title | Выполнить turn с routing trace | Все вызовы разрешённого route либо отключены',
'Unknown billing | Нельзя доказать extra-credit запрет | Проверить readiness | Unattended режим не включён, требование no-spend остаётся blocked'],['CHATGPT-OAUTH'])
t('H-06','H-05 OPS-05 OPS-06', 'Backup агента должен быть согласован с SQLite, а alerts работать без модели.',
'Создать consistent session/memory backup и recovery procedure § Проверить lifecycle/last-success/quota/auth_required метрики без prompts § Подключить operational alerts независимо от model call § Восстановить Hermes state в изолированном pod; full-stack resource acceptance остаётся OPS-08',[
'Restore | Backup содержит session и memory marker | Восстановить отдельный test instance | Данные читаются, production gateway не запущен вторым',
'Модель недоступна | Provider quota exhausted | Вызвать operational alert | Статус приходит без model generation',
'SQLite | Backup во время работы | Проверить integrity после restore | Нет повреждения/WAL потери, процедура воспроизводима'])
t('H-07','H-04', 'Темы имеют отдельный диалог и versioned rules. Имена могут меняться, IDs стабильны.',
'Создать TopicBinding chatId/threadId/topicKey/promptVersion/toolScope § Зарегистрировать тему вещей и General status/help, остальные unknown § Подключить Hermes forum sessions и topic skill/prompt binding § Проверить /new и global-memory policy: без неявного переноса личных данных между темами',[
'Две темы | В A данные вещи, в B отдельная задача | Попеременно отправить сообщения | Текущие диалоги не смешаны, scope tools соответствует теме',
'Rename | Переименовать тему A | Отправить сообщение | Binding и правила сохранены по ID',
'New | Каталог уже содержит item | Выполнить /new в теме | Диалог новый, каталог и rules не удалены',
'Unknown | Новый незарегистрированный topic | Попросить mutation | Нет автоматического полного tool access'])
t('H-08','BE-07 H-07 OPS-02', 'Каталог — структурированные данные в assistant-store, а не единственная запись в LLM memory.',
'Создать assistant-store schema Item/Price/Media/Source/Draft/Publication/Audit § Реализовать typed API с owner+scope, expectedVersion, source idempotency § Создать private media ingest с size/type/hash limits и отдельным backup § Обеспечить durable source запись до acknowledgement model processing',[
'Дубль | Один Telegram update/message повторился после restart | Ingest дважды | Один source/item, media не дублируются логически',
'Version | Два edit одного item v1 | Update одновременно | Один успех, второй version conflict',
'Media | Слишком большой или запрещённый файл | Ingest | Controlled reject, нет исчерпания RAM/диска',
'Чужие данные | Credential assistant-store | Попытаться читать payments/users DB | Недоступно по role/network/tool contract'])
t('H-09','H-08 H-05', 'Фото и текст сохраняются до дорогого model turn; неизвестные характеристики не выдаются за факт.',
'Реализовать photo/album coalescing и создание item draft по source key § Передавать vision только разрешённому subscription provider § Разделить owner-supplied fields и model suggestions; задавать короткие уточнения § Ответить карточкой с itemId и сохранять edits по reply/ID, не по глобальной последней вещи',[
'Альбом | 3 фото с одним mediaGroupId | Ingest с небольшими задержками | Одна вещь с 3 media в правильном порядке',
'Две вещи | Два отдельных сообщения подряд | Обработать | Два items, данные не смешаны',
'Quota | Фото получено, model limit исчерпан | Ingest/analyse | Фото и draft сохранены, analysis_pending, paid call отсутствует',
'Факт | Не видны объём памяти/дефект | Model предлагает значение | Предложение требует подтверждения, не authoritative field'])
t('H-10','H-09', 'Готовый draft полезен даже без доступа бота к внешней барахолке. Автопубликация зависит от destination rules.',
'Создать ListingDraft version с выбранными фото/ценой/описанием/locale § Исключить private purchase price и лишние metadata из public fields § Реализовать request_publish по подтверждённой draftVersion/target либо узкому owner rule § Сохранить Telegram message IDs; при lost response state unknown, без blind repost',[
'Приватная цена | Item purchase=100, asking=80 | Сформировать публичный draft | Видна asking 80, purchase 100 отсутствует',
'Version | Подтверждён draft v1, затем изменён v2 | Publish intent для v1 | Отправляется только подтверждённая версия либо запрашивается новое решение по политике',
'Права группы | Bot не может писать destination | Publish | Понятный denied/manual-ready, нет userbot обхода',
'Unknown send | Telegram принял сообщение, ответ потерян | Restart retry | Publication unknown, автоматического дубля нет'],['MARKETPLACE-TARGET'])
t('H-11','H-06 H-07 H-08 H-09 H-10', 'Готовность личного помощника включает контексты, сохранность каталога и отсутствие дополнительных AI расходов.',
'Пройти полный сценарий вещь/photo/edit/draft/publish-fake в двух topics § Проверить owner/chat gates, prompt injection и запрет межсервисных secrets § Выполнить restart/restore вместе с Item rows и media § Сохранить H acceptance report; передать измеряемый workload для OPS-08',[
'Сквозной | Две темы, 2 вещи, несколько фото | Полный workflow и restart | Верные карточки/версии/scopes, ничего не потеряно',
'Restore media | Backup DB и object media | Восстановить каталог | Все ссылки ведут к восстановленным private objects',
'No-spend | Имитировать quota/auth/tool error | Выполнить типовые задачи | Все прекращаются/ожидают по policy, платный маршрут не включается',
'Publish recovery | Unknown Publication | Повторить обработку после restore | Нет необоснованного повторного объявления'])

t('R-01','L-10 ID-09 N-04 N-05 PAY-11 A-07', 'Интеграция объединяет навигацию, язык и общий вход уже готовых частей.',
'Подключить navigation между landing/id/pay/admin без раскрытия private routes § Заменить оставшиеся обязательные fixtures реальными typed APIs § Проверить central login/return/logout и locale preference по origins § Пройти empty catalog и недоступные downstream states',[
'Маршрут | Новый visitor с ru браузером | Landing EN, выбрать RU, перейти pay/login | Язык соответствует явному выбору, return безопасен',
'Сессии | Вход через id, затем pay | Открыть кабинет/историю | Один account, отдельные host-only cookie работают',
'Пустой продукт | Каталог закрыт | Пройти user flow | Нет ложных продаж и сломанных CTA'])
t('R-02','R-01 ID-10 PAY-12 H-11 OPS-08', 'E2E проверяет общую систему, включая отказы и границы провайдерской проверки.',
'Поднять изолированную release candidate среду с fresh fixtures § Пройти E2E-01…14 из quality matrix и обязательные domain failure cases § Отдельно приложить provider evidence и явно пометить fake-only сценарии § Открыть дефекты с task/case ID и повторить только затронутые проверки после fixes',[
'Покупка | Подтверждённый тестовый provider scenario | Checkout→payment→grant→notification→admin | Все ID/state связаны, один effect',
'Fault | Broker/email temporary down | Повторить покупку и восстановить | Деньги/доступ сохранены, доставка догоняет',
'Hermes | Quota exhausted после фото | Проверить UI/DB | Draft сохранён, модель paused',
'Доказательство | Не выполнен внешний test | Составить отчёт | Not-run/blocked явно видны, не записаны как pass'])
t('R-03','R-02 OPS-07 OPS-08', 'Readiness — проверка доказательств, а не перечитывание пожеланий.',
'Сверить Gate A/B/C и task reports с release commit/digests § Проверить known risks, external inputs, rollback, secrets и sales flags § Установить Go/No-Go по P0 defects и непроверенным инвариантам § Сохранить конкретный release plan target/time/smoke/rollback owner',[
'Блокер | Открытый P0 payment/auth defect | Выполнить readiness review | No-Go с конкретным task/case',
'Evidence | Build commit отличается от тестового | Сравнить refs/digests | Проверки устарели, требуется соответствующая валидация',
'Sales | Merchant validation отсутствует | Проверить flag/release scope | Продажи не открываются; исключение scope требует явного решения'])
t('R-04','R-03', 'Deploy выполняется только в новом окружении и после concrete readiness; документ сам не запускает production.',
'Проверить разрешённый target, immutable refs и fresh backup/bootstrap state § Применить GitOps release с migration/readiness gates § Выполнить smoke public/private routes, login, workers, webhook ingress и operational alerts § При failed gate исполнить совместимый rollback/forward-fix runbook и сохранить фактический outcome',[
'Deploy | Candidate прошёл readiness | Выпустить на согласованный target | Ready pods/routes/TLS и правильные digests',
'Migration fail | Rehearsal broken migration | Пройти release path | Новое приложение не открыто, данные не откатили разрушительно',
'Smoke | Production routes доступны | Пройти список без неразрешённых реальных списаний | User/private/ops пути работают, sales flag соответствует решению'],['DEPLOYMENT-AUTHORIZATION'])
t('R-05','R-04', 'После выпуска baseline измеряется по реальной среде, а оставшиеся задачи становятся явными.',
'Наблюдать согласованный launch период и собрать errors/latency/resources/queue age § Проверить backup после появления данных и owner access recovery readiness § Сопоставить real metrics с бюджетом, исправить критичные launch defects § Сохранить release report и отдельный список P1; только затем открыть NEXT-01',[
'Стабильность | Production baseline за выбранный период | Просмотреть metrics/alerts | Нет незакрытых P0, источники и период указаны',
'Backup | Новые production records | Проверить следующую копию/freshness | Backup актуален, restore procedure соответствует release',
'Handoff | Завершён launch review | Проверить outstanding list | P1 имеют owners/context, не скрыты в устном чате'])
t('NEXT-01','R-05', 'Сейчас игра не детализируется. Эта карточка разрешает только будущую подготовку отдельного ТЗ после production.',
'Проверить завершение first production и доступность shared services § Собрать отдельный brief по онлайну, ботам, оплате и рейтингу § Зафиксировать вопросы gameplay/монетизации/сроков без принятия ответов за владельца § Создать самостоятельный game scope/backlog и связать платформенные зависимости',[
'Граница | Platform production ещё не принят | Проверить readiness NEXT | Реализация игры не начинается',
'Scope | Получен future game brief | Просмотреть новое ТЗ | Условия задания отдельно от предположений модели',
'Reuse | Shared identity/pay/notif/DS готовы | Проверить integration map | Нет второго независимого login/payment engine'])

for id, deps, context, steps, tests in [
('W-01','PAY-05 PAY-09 PAY-10','Wallet опционален и не включён в базовый P0. Если выбран, баланс следует из double-entry ledger.',
'Проверить принятое решение wallet и merchant support § Создать WalletAccount/LedgerTransaction/Posting с currency и source uniqueness § Обеспечить zero-sum per currency и immutable postings § Вычислять available/reserved/debt раздельно без ручного UPDATE balance',[
'Проводки | Transfer 1000 minor одной валюты | Commit journal transaction | Сумма postings равна нулю',
'Нарушение | Несбалансированная запись или смешанные валюты | Commit | Транзакция отклонена целиком',
'История | Existing ledger entry | Изменить/удалить обычным runtime | Запрещено, корректировка только новой записью']),
('W-02','W-01 PAY-03','Пополнение начисляется после подтверждённой внешней оплаты ровно один раз.',
'Создать top-up order и привязку payment→ledger source § Проверять server amount/currency и provider-supported scenario § Зачислять ledger transaction при подтверждении § Обрабатывать repeat/unknown/refund через общие billing contracts',[
'Дубль | Один top-up paid event дважды | Process | Ровно одно зачисление',
'Return | Success URL без paid | Открыть wallet | Баланс не увеличен',
'Mismatch | Provider amount отличается | Process | Issue, зачисление не выполнено']),
('W-03','W-02 PAY-06','Конкурентное расходование не может потратить одни деньги дважды.',
'Реализовать reserve/capture/release с commandId и expected state § Сериализовать изменение одного wallet account § Связать capture и grant в одной Payments transaction § Установить reservation expiry и recovery без удаления истории',[
'Конкуренция | Available 1000, две покупки по 800 | Capture одновременно | Одна проходит, другая insufficient funds; available не отрицателен',
'Release | Reserved 300 | Release дважды | Средства освобождены один раз',
'Capture | Один reservation уже captured | Повторить command | Нет второй траты/grant']),
('W-04','W-03 PAY-09','Chargeback потраченного пополнения создаёт долг/ограничение, а не исчезновение истории.',
'Описать refund/reversal/debt policy отдельным wallet ADR § Создать компенсирующие postings по verified source § Запретить новые траты restricted wallet по policy § Показать debt отдельно от обычного available и поддержать reconciliation',[
'Потраченный top-up | Пополнение 1000 потрачено, затем chargeback | Process | История цела, debt/restricted по policy',
'Повтор reversal | Один refund event дважды | Process | Одна компенсация',
'Другая валюта | Debt USD и funds EUR | Считать available | Автоматического FX/погашения нет']),
('W-05','W-04 A-03 DS-04','Wallet UI должен различать доступное, зарезервированное и долг и не давать оператору править balance напрямую.',
'Подключить wallet history/top-up/status в pay и admin § Отобразить суммы по currency и источник движения § Добавить permission/reason/step-up для adjustment command § Скрывать модуль при wallet feature flag off',[
'Flag off | Базовый release без wallet | Открыть pay/admin | Кошелёк/пополнения не обещаны',
'Adjustment | Authorized operator и reason | Создать корректировку | Новая ledger transaction+audit, не UPDATE balance',
'Ownership | User A просит wallet B | GET/command | Доступ запрещён']),
('W-06','W-05','Wallet требует отдельной финансовой приёмки перед включением продаж кредита.',
'Сгенерировать детерминированную последовательность top-up/reserve/capture/refund § Проверить races/replay/crash и восстановление из journal § Выполнить provider-supported top-up test при соответствующей авторизации § Сохранить wallet gate и отдельную оценку ресурса/операционных рисков',[
'Invariant | 100 последовательных/конкурентных команд с фиксированным seed | Проверить после каждого commit | Zero-sum и allowed available/debt invariants соблюдены',
'Rebuild | Удалён derived cache в test env | Пересчитать из journal | Балансы совпадают с исходными',
'Restore | Backup до нескольких provider facts | Restore/reconcile | Внешние top-ups/refunds восстановлены без дублей'])
]:
    t(id, deps, context, steps, tests, ['WALLET-DECISION'])
