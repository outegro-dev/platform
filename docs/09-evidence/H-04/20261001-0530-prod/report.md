# Отчёт H-04 (production, частичный)

- Статус: in progress. TC-H-04-01 и TC-H-04-02 закрыты проверкой конфигурации по решению владельца, TC-H-04-03 ждёт проверки владельцем.
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
- `auxiliary.title_generation.enabled: false` в управляемой политике не останавливает попытки генерации заголовков: в логе «main provider openai-codex is unavailable… refusing to guess another logged-in provider». Другие провайдеры не вызывались (для H-05 это отказ, а не трата), но ключ, похоже, читается не там. Проверить по исходникам v2026.9.24.

## Модель (01.10.2026)

Каталог Codex подписки владельца (прочитан через `resolve_codex_runtime_credentials(read_only=True)`, без обновления токена и записи в auth store) начинается с `gpt-6.1-sol`. Управляемая политика переведена на неё (gitops `7a42bbc`: основная модель и auxiliary vision, compression, approval). После перезапуска пробный запрос `hermes -z` ответил, в `context_length_cache.yaml` появилась `gpt-6.1-sol@https://chatgpt.com/backend-api/codex`. Платные провайдеры не вызывались: при старте попытка auxiliary-клиента Nous отклонена («not logged into Nous Portal»).
