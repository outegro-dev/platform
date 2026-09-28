# Глава 11. Hermes Agent в K3s и подписка OpenAI

> Версия 0.3: детальные действия, зависимости и test cases находятся в [карточках задач](../../04-delivery/README.md). Эта глава задаёт предметный контекст.

## 11.1. Требование и место в плане

Добавлено владельцем: Hermes Agent должен работать в том же K3s до разработки морского боя и использовать включённые лимиты его подписки OpenAI, без оплаты model API по токенам. Под Hermes понимается [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent); другой продукт владельцем не указан. Интеграция включена в платформенный этап и готовность первого production.

Уточнено владельцем: ChatGPT Plus (личная подписка около $20), личный помощник только для Nick через Telegram-группу с темами. Каждая тема — отдельный контекст задач и правила. Первый сценарий: каталог вещей по фото с ценой покупки, желаемой ценой продажи, состоянием, характеристиками и описанием; затем подготовка публикации на барахолке. Другие темы определятся позже. Одна активная model-задача за раз — ресурсное предложение, а не ограничение количества тем. Агент не становится публичным chatbot портфолио.

## 11.2. Подключение подписки

Hermes документирует provider `openai-codex` с OAuth; это отдельный маршрут от `openai-api` с платным API key. Возможен собственный Hermes loop либо опциональный Codex app-server runtime. [Providers](https://hermes-agent.nousresearch.com/docs/integrations/providers).

Вариант A, стартовый кандидат: Hermes loop + openai-codex OAuth, чтобы сохранить его memory/session/skills workflow. Вариант B: Codex app-server runtime, когда нужны именно инструменты Codex; у этого режима есть ограничения части инструментов Hermes и отдельное auth state. Выбор фиксируется после короткого compatibility spike, не переключается незаметно при сбое. [Hermes Codex runtime](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/codex-app-server-runtime.md).

Официальная документация OpenAI разделяет ChatGPT-managed auth и API-key auth; app-server умеет сообщать account/plan и rate limits. Codex usage делится с другими соответствующими возможностями аккаунта; дополнительные credits могут продолжать использование после включённых лимитов. [Authentication/account API](https://learn.chatgpt.com/docs/app-server), [pricing/limits](https://learn.chatgpt.com/docs/pricing).

Практический вывод: технический путь через подписку есть, но точные доступные модели, лимиты и режим списаний конкретного аккаунта подтверждаются на нём. Нельзя обещать бесконечный бесплатный агент или считать поддержку OAuth доказательством полного совпадения всех billing-сценариев стороннего клиента.

## 11.3. Политика «без дополнительных расходов»

1. Provider зафиксирован как openai-codex, выбран доступный аккаунту model ID. Не использовать auto-routing на неизвестный платёжный маршрут.
2. OPENAI_API_KEY, OPENROUTER_API_KEY и платные fallback credentials не передаются контейнеру. `fallback_providers` не переключает запрос на платный API при quota/rate limit.
3. Проверяются все auxiliary вызовы: compression, title, vision, memory review/goal judge. Они либо используют тот же разрешённый subscription route, либо отключены. Background review не должен незаметно съедать остаток общего лимита.
4. Search/image/TTS/browser/cloud tools не считаются включёнными автоматически. В P0 отключены инструменты с отдельным платным провайдером; отсутствие API-key для основной модели не делает остальные сервисы бесплатными.
5. При UsageLimitExceeded/429 — приостановка задачи, видимый статус и сообщение владельцу. Нет ротации аккаунтов, обхода лимитов и автоматической покупки/reset/пополнения.
6. Проверяются настройки купленных credits, extra usage и auto top-up конкретного аккаунта. Если нельзя технически подтвердить запрет расхода сверх включённого лимита, режим «нулевые дополнительные списания» остаётся непрошедшим приёмку, а unattended работа не включается.
7. При доступном usage API — контроль перед стартом и между turns с резервом, чтобы не занять весь лимит у ручной работы владельца. При неизвестной свежести quota не выдумывать remaining%; остановить длительные автономные задачи до проверки. Точный резерв выбирает владелец.

Одна длительная задача может делать много model turns. Число пользовательских сообщений в Telegram не эквивалентно числу model requests. No-spend относится к дополнительным AI/tool расходам; VPS, bucket и уже оплаченная подписка остаются обычными расходами проекта.

## 11.4. OAuth и секреты

Первый вход выполняет владелец через device-code/browser flow на собственной странице OpenAI. Пароль, refresh/access token не пересылаются в чат и не коммитятся. Hermes хранит обновляемое auth state на приватном PVC; при app-server режиме Codex auth state отдельное и тоже доступно только этому runtime. Не копировать без необходимости всю папку локального Codex с plugins/credentials.

Kubernetes Secret используется для bootstrap/channel credentials, но mutable refresh-state нельзя постоянно перетирать старым read-only Secret. Предусмотреть права файлов, consistent backup, reauth after revoke и kill switch. Rollout не запускает два процесса, одновременно refresh-ящих одну credential session. Для восстановления допустим повторный ручной OAuth; наличие backup токена не гарантирует, что он всё ещё действителен.

## 11.5. K3s deployment

Отдельный namespace `agents`; один StatefulSet replica=1 либо Deployment Recreate с одним PVC — выбрать один. Основное состояние официального container image находится в `/opt/data`. Pin image digest; updates через CI/GitOps и smoke, не самостоятельное обновление core агентом. Не запускать два gateway над одним data directory. [Docker guide](https://hermes-agent.nousresearch.com/docs/user-guide/docker/).

PVC 10 ГБ как стартовый ориентир: sessions, memories, skills, конфигурация, разрешённые artifacts. Backup согласованный для SQLite, с проверкой восстановления. Пользовательский workspace ограничен и очищается по retention. Собственные данные Hermes не смешиваются с PostgreSQL сервисов.

SecurityContext, допустимые filesystem mounts и entrypoint проверяются на выбранном образе: s6/init может иметь свои требования, поэтому не заявлять runAsNonRoot/readOnlyRootFilesystem рабочими до smoke. Цель — непривилегированный runtime, dropped capabilities, ограниченные writable dirs, без hostPID/hostNetwork/hostPath и без Docker/containerd socket. Если стандартный образ не подходит, собрать минимальный совместимый image с фиксированной версией вместо выдачи privileged.

K3s использует containerd: установка Docker внутри pod ради доступа к host socket не требуется. Terminal tool при необходимости выполняется только в ограниченном workspace контейнера; расширенный sandbox/выделенные job runners — отдельная реализация. ServiceAccount token автоматически не монтируется, RBAC к Kubernetes API по умолчанию отсутствует.

## 11.6. Сеть и пользовательский доступ

Вход — Telegram bot в приватной supergroup с Topics. Проверяются и точный owner userId, и разрешённый chatId. Не использовать chat-wide authorization, разрешающую любому участнику группы давать задания: в Hermes такая настройка существует и отличается от sender allowlist. Anonymous sender/chat impersonation не получает owner access. Dashboard/API не выставляются анонимно через публичный ingress; отдельный `agent.outegro.dev` пока не нужен.

Egress разрешает DNS и необходимые HTTPS endpoints OpenAI/выбранного канала. Private DB/Redis/AMQP/admin API по умолчанию недоступны. При использовании FQDN-policy проверить поддержку сетевого движка; стандартная NetworkPolicy не решает произвольные доменные allowlists сама по себе. Для сложного egress использовать контролируемый proxy или проверенные policy возможности.

## 11.7. Интеграция с платформой

P0: owner-only агент, Telegram topics, собственная память, каталог вещей и private media, разрешённый workspace, quota/no-spend, backup/alerts. Каталог обслуживает небольшой `assistant-store` API с собственной БД/ролью в общем PostgreSQL; Hermes получает только typed tools к этому API. Прямой доступ к DB других сервисов, kubeconfig, payment key, auth signing key и автоматическому refund не выдаётся. Админка может показывать owner-only status агента/каталога, но не копирует всю личную переписку в общий audit.

Если позже нужен coding workflow: отдельный checkout, ограниченный GitHub token, branch/PR, тесты; merge/deploy по принятому workflow. Если нужен ops workflow: сначала read-only dashboards/runbooks, затем точно перечисленные команды с audit и подтверждением. Произвольный shell root на VPS не является необходимой частью «добавить Hermes в кластер».

## 11.8. Ресурсы

Добавочный целевой working set Hermes и небольшого assistant-store вместе — 768 MiB; раздельные requests/limits выводятся из spike, для Hermes limit-кандидат 1024 MiB, CPU request около 100–250m и burst до 1 CPU. Это гипотеза для проверки, не характеристики Hermes. Одна активная задача; local LLM/GPU inference не размещается на этом VPS. Тяжёлый браузер, build большого monorepo и параллельные subagents могут не поместиться; такие workloads пока выключены. Каталожные фото хранятся в private object storage/ограниченном media PVC с backup, а не бесконечно в контейнерном слое.

Общий ориентир платформы увеличивается с 5980 до 6748 MiB. При 8192 остаётся 1444 MiB, поэтому acceptance full-stack нагрузкой становится особенно важным. Agent имеет более низкий приоритет, чем identity/payments/DB, и может быть остановлен при pressure. Если минимальный полезный workload не помещается, следующий шаг — вертикальный upgrade или уменьшение разрешённого workload, не второй VPS.

## 11.9. Наблюдаемость и приёмка

Статусы: ready, running, waiting_for_owner, quota_exhausted, auth_required, paused, failed. Метрики/лог: active jobs, duration, last successful turn, provider route, quota status/freshness, resource use, restart; prompts/credentials/private memory в общие логи не попадают. Operational alert не зависит от способности модели сгенерировать сообщение.

Проверки: owner allowlist; исключение постороннего; проверенный ChatGPT auth mode; запрос с ожидаемым расходом лимита; отсутствие API/paid fallback; auxiliary routing; quota exhaustion simulation; expired token/relogin; pod restart; restore memory; concurrent rollout exclusion; заблокированный доступ к DB/Kubernetes; ограниченный disk/CPU/RAM; недоступный Telegram; корректная остановка задания. Subscription-only acceptance подтверждается наблюдением маршрута и account usage, а не только названием модели в конфиге.

## 11.10. Атомарные задачи

| ID | Результат | Зависимости |
|---|---|---|
| H-01 | Подтверждены Plus OAuth, runtime, модель и каталог как workload | Docs + account spike |
| H-02 | Воспроизводимый pinned image/PVC/startup | OPS-01, H-01 |
| H-03 | Приватный OAuth, auth persistence и reauth | H-02, участие владельца |
| H-04 | Allowlist канала, tools/egress/resource policy | H-02 |
| H-05 | No-spend/auxiliary/quota acceptance | H-03, H-04 |
| H-06 | Backup/restore/alerts и full-stack load test | H-05, OPS-05…08 |
| H-07 | Topics routing, owner/chat allowlist, versioned rules | H-04 |
| H-08 | Assistant-store/Drizzle schema, media ingest, idempotency | BE-03, H-07 |
| H-09 | Фото → item draft → уточнения → сохранённая карточка | H-08, H-05 |
| H-10 | Черновики объявлений, версии и управляемая публикация | H-09, выбранный destination |
| H-11 | Тесты контекстов/альбомов/restart/restore/no-spend | H-06…10 |

Ориентир: 3–5 дней базовое размещение плюс 5–8 дней topic/catalog MVP, всего 8–13 рабочих дней без внешних marketplace-коннекторов и расширенного browser/coding/ops automation. Этап завершается до NEXT-01 (Battleship).

## 11.11. Темы, правила и разделение контекста

В документации Hermes подтверждены отдельные sessions для forum topics, group-topic skill bindings и channel/topic prompts. Это функциональная изоляция диалога; память профиля и поиск по прошлым sessions могут быть общими. Поэтому правила требуют не подтягивать содержимое других тем без явного указания, а для строгой границы — отдельный profile/tool scope. [Telegram setup](https://hermes-agent.nousresearch.com/docs/user-guide/messaging/telegram), [sessions](https://hermes-agent.nousresearch.com/docs/user-guide/sessions).

TopicBinding: chatId + threadId → topicKey, displayName, promptVersion, skill, allowedTools, storageScope. Название видно человеку и может меняться; routing/ownership опираются на IDs. Первая тема «Вещи на продажу» имеет каталог и свои инструкции. Остальные новые темы сначала регистрируются владельцем; неизвестная тема не получает автоматически полный набор tools. General — короткая справка/статус, без смешивания задач.

После `/new` сбрасывается разговор темы, но правила и данные каталога сохраняются. Правки правил версионируются, а не генерируются моделью из сообщения случайного участника. Topic prompt не считается security boundary: backend tools проверяют owner и scope. Если выбранная версия Hermes не умеет нужное ограничение tools по теме, оно реализуется в adapter; до этого неизвестные темы не имеют mutating tools.

Telegram должен доставлять обычные сообщения/фото боту: настроить privacy/минимально необходимые права, затем проверить фактический receive flow. Для приватной группы можно отключить необходимость @mention, сохраняя строгий owner+chat gate. Bot не требует права удаления всех сообщений только ради чтения фото. [Telegram FAQ](https://core.telegram.org/bots/faq).

## 11.12. Каталог вещей: модель данных

| Сущность | Основные поля |
|---|---|
| Item | id, ownerId, title, category, description, condition, conditionNotes, specs JSON, status, version |
| ItemPrice | purchaseAmount/currency, desiredSaleAmount/currency, actualSaleAmount/currency отдельно |
| ItemMedia | itemId, private object key, mime/size/hash, Telegram source IDs, order, publishedVariant |
| ItemSource | botId/chatId/threadId/messageId/updateId/mediaGroupId, receivedAt |
| ListingDraft | itemId, locale, title/body, selected media, askingPrice, version, readyState |
| Publication | draftVersion, targetChat/topic, state, Telegram messageIds, sentAt, failure/unknown |
| ItemAudit | who/command/sourceMessage, old/new version, result |

Статусы: draft → needs_details → ready → listed → reserved → sold/archived; переходы предлагаемые, уточняются в макете бота. Удаление и архив различаются. Цена покупки остаётся личной и не входит в публичное объявление по умолчанию. Цена продажи не вычисляется из фото и не меняется моделью без указания владельца. Состояние и дефекты отмечаются отдельно; визуальная гипотеза хранится как предложенная, не подтверждённая характеристика.

Ассистент не получает произвольный SQL-tool. Typed operations: create_item, attach_media, update_item(version), find_items, create_listing_draft, mark_reserved/sold, request_publish. Credentials assistant-store имеют доступ только к своему API; DB role у API только к assistant database. Нет связи личных вещей с коммерческими балансами пользователей платформы.

## 11.13. Фото и последовательность действий

1. Проверить sender/chat/topic, принять текст/фото или альбом, надёжно сохранить source IDs и private media до дорогого model анализа.
2. Создать/найти item draft по idempotency/source key; отметить приём коротким ответом в исходной теме.
3. Если есть vision-модель на subscription route — извлечь предполагаемое название/видимые характеристики. Если quota закончилась, сохранить фото и оставить `analysis_pending`; не уходить в платный vision API.
4. Применить данные владельца: цена покупки, желаемая цена/валюта, состояние, описание. При отсутствии поля спросить коротко; не требовать сразу весь опросник.
5. Ответить карточкой с item ID, заполненными полями и тем, что нужно уточнить. Редактирование по reply/ID обновляет конкретную вещь, а не «последнюю где-то в памяти».
6. По команде сформировать объявление, показать выбранные фото/публичные поля/цену/целевую группу. Хранить версию draft.
7. Публиковать в разрешённый destination после отдельного решения владельца либо заранее заданного узкого правила для этого destination. Сохранять message IDs и результат.

Несколько фото одного media_group объединяются с debounce/timeout; два товара, присланные подряд, не сливаются автоматически. Photo hash помогает показать возможный дубль, но не доказывает, что две физически одинаковые вещи — одна. Лимиты размера/count/type защищают память; originals доступны приватно, public variants не содержат лишних metadata/личных деталей.

## 11.14. Надёжность Telegram и публикаций

Не полагаться только на in-memory dedup Hermes. Item mutations имеют durable source/command idempotency, unique constraints и optimistic version. Бот отвечает «сохранено» только после commit. При падении после Telegram send до записи результата Publication становится unknown: не делать слепой repost, чтобы не дублировать объявление. Прямая Bot API отправка не даёт произвольного idempotency key.

Cold boot backlog поведение выбранной версии проверяется: важные новые фото не должны молча теряться на restart. Нужен durable ingest/краткая собственная запись источника до async обработки; если adapter подтверждает update раньше этой точки, реализовать hook приёма или явно ограничить гарантию и показывать пользователю подтверждение получения. Telegram не является бессрочным резервным хранилищем исходников.

Барахолка должна разрешать публикацию ботом и предоставить соответствующий доступ. Отправка от личного аккаунта через userbot не считается частью P0. Если внешняя группа не принимает бота, результатом будет готовое объявление для ручного размещения, а не обещание невозможной интеграции. Публикация реальных объявлений сейчас не выполняется.

## 11.15. Дополнительная приёмка личного помощника

Две темы не смешивают текущий диалог; rename не меняет привязку; `/new` сохраняет правила/каталог; посторонний участник не запускает tools; альбом создаёт одну вещь; отдельные предметы остаются разными; повтор update после restart не создаёт дубль; цена покупки не попадает в объявление; неизвестная характеристика требует уточнения; фото сохраняется при quota exhaustion; редактирование проверяет version; backup восстанавливает и Item rows, и media; публикация хранит именно подтверждённую draftVersion/target и не дублируется слепым retry.
