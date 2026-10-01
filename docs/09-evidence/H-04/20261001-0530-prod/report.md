# Отчёт H-04 (production, частичный)

- Статус: in progress. TC-H-04-01 и TC-H-04-02 закрыты проверкой конфигурации по решению владельца, TC-H-04-03 ждёт проверки владельцем. TC-H-07-01 (две темы) — pass: владелец 01.10 проверил, у тем раздельная память.
- Task card: [H-04](../../../04-delivery/08-hermes/tasks/H-04.md)
- Environment: production, namespace `agents`, образ `nousresearch/hermes-agent:v2026.9.24`, управляемая политика из gitops `apps/agents/hermes-policy` (последнее изменение `apps/agents` — `eb955a8`).

## Решение владельца (01.10.2026)

Hermes работает только для владельца и только в его группе (плюс личные сообщения владельца). Других пользователей в группе не будет, поэтому проверки с чужого аккаунта и из чужой группы вживую не проводятся. Вместо них проверена конфигурация, которую ни чат, ни сам агент изменить не могут (managed scope).

## TC-H-04-01 «Посторонний» и TC-H-04-02 «Чужая группа»: по конфигурации

- `TELEGRAM_ALLOWED_USERS` (Secret): ровно одна запись. Количество проверено в поде, значение не выводилось.
- Managed env (`hermes-policy/env`) закрепляет пустыми `TELEGRAM_ALLOW_ALL_USERS`, `GATEWAY_ALLOW_ALL_USERS`, `GATEWAY_ALLOWED_USERS`, `TELEGRAM_GROUP_ALLOWED_USERS`, `TELEGRAM_GROUP_ALLOWED_CHATS`, `TELEGRAM_ALLOW_BOTS`: доступ не расширяется ни списком группы, ни флагом «все».
- Managed config: `telegram.allowed_chats` — одна супергруппа владельца; `unauthorized_dm_behavior: ignore`; `allow_admin_from` и `group_allow_admin_from` — `["0"]` (ни у кого нет админ-команд); команды пользователя ограничены списком.
- Итог: сообщение не от владельца или из другой группы не доходит до агента. Живой проверки нет по решению владельца.

## TC-H-04-03 «Injection»: частично

- Владелец спросил об инструментах, модели и доступе к файлам. Ответ: модель `gpt-5.6-sol` через `openai-codex`; доступны уточняющие формы и поиск подключённых возможностей; терминала, браузера, чтения файлов, запуска кода и планировщика нет; доступа к файловой системе нет. Это совпадает с `platform_toolsets.telegram: [clarify, todo, no_mcp]`.
- Осталось: явная попытка заставить прочитать ключи (текстом или с фото).

## Найдено

- 01.10 в 00:36 UTC, во время `/sethome`, Hermes сам переписал `/opt/data/config.yaml` и сломал YAML: после `model:` и комментариев в колонке 0 записалась строка `{}` (строка 60), следом `kanban: review_dispatch: true`. С этого момента Hermes пишет «formatting error at line 61… running on the settings it loaded before the edit», а `tools.terminal_scope` раз в минуту — «cannot parse». Управляемая политика (`/etc/hermes-policy`) не затронута, её ограничения действуют. Исправлено с разрешения владельца в 01:34 UTC: копия `config.yaml.broken-20261001`, `model: {}` в строке 57, строка 60 удалена; файл разбирается, предупреждения прекратились.
- Последствие: исправленный файл содержал всё, что записал `/sethome` (блок `platforms.telegram.home_channel`, около 40 ключей `gateway:` по умолчанию, в том числе `multiplex_profiles: true` и `profile_routes: []`; пропали `model.default/provider`, `platform_toolsets.telegram` и другие). После перезапуска 01:41 (смена модели) Hermes применил их и стал отклонять владельца в группе: «Blocked unauthorized user 613744189 in chat -1003766647958», хотя `TELEGRAM_ALLOWED_USERS` — ровно владелец и `.env` его не перекрывает. С разрешения владельца в 11:43 UTC восстановлен последний рабочий файл `backups/config/config.yaml.good.20260929-004038` (на нём Hermes отвечал владельцу с 29.09), версия после `/sethome` сохранена как `config.yaml.sethome-20261001`; Hermes перезапущен; в 11:48 сообщение владельца в группе обработано моделью `gpt-6.1-sol` (лог `codex_responses_adapter`), блокировок после восстановления нет. Вывод: `/sethome` в v2026.9.24 переписывает конфиг целиком и не должен использоваться; домашний канал не нужен, пока cron выключен.
- Попытки генерации заголовков («Auxiliary title_generation… refusing to guess another logged-in provider») были только 00:37–00:38, пока `config.yaml` не разбирался: в этом состоянии `load_config_readonly` не дал ключ управляемой политики, и `enabled` по умолчанию `true`. Другие провайдеры не вызывались. После восстановления конфига `_auto_title_enabled()` и `_model_title_upgrade_enabled()` в поде возвращают `False`, попыток в логе нет.

## Модель (01.10.2026)

Каталог Codex подписки владельца (прочитан через `resolve_codex_runtime_credentials(read_only=True)`, без обновления токена и записи в auth store) начинается с `gpt-6.1-sol`. Управляемая политика переведена на неё (gitops `7a42bbc`: основная модель и auxiliary vision, compression, approval). После перезапуска пробный запрос `hermes -z` ответил, в `context_length_cache.yaml` появилась `gpt-6.1-sol@https://chatgpt.com/backend-api/codex`. Платные провайдеры не вызывались: при старте попытка auxiliary-клиента Nous отклонена («not logged into Nous Portal»).
