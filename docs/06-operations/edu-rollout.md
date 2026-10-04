# Обучение: первая выкатка edu.outegro.dev

Как у Морского боя: сначала база и вход, потом приложение. Шаги: 0 — владелец вне репозиториев, 1 — gitops (база, роль, вход), 2 — platform (образы), 3 — gitops (приложение). Порядок важен: Job миграций edu-backend — PreSync-хук общего приложения Argo `outegro`, и если он упадёт (нет образа, нет секрета, нет базы), встанут выкатки всех сервисов ([production.md](production.md#выпуск)). Документирование не разрешает выкатку: каждый шаг запускает владелец.

Изменения уже подготовлены в ветках `feat/edu` обоих репозиториев. В gitops второй шаг закомментирован, поэтому ветку можно сливать после шага 1, ничего не включая раньше времени.

## Шаг 0. Владелец, вне репозиториев

1. Cloudflare → DNS `outegro.dev`: запись `A edu → IPv4 сервера`, **Proxied** (как у `id`, `pay`, `battleship`). Сертификат не нужен: origin закрыт wildcard `*.outegro.dev` (`certificate.yaml`), край — Universal SSL Cloudflare.
2. Секрет базы на сервере (из корня gitops ветки `feat/edu`: её `node/secrets.sh` уже содержит строку `pg-edu`; без ключей на stdin скрипт только создаёт недостающие внутренние секреты и ничего не перезаписывает):

   ```text
   scp node/secrets.sh outegro-prod:/tmp/
   ssh outegro-prod 'sudo bash /tmp/secrets.sh; rm /tmp/secrets.sh' < /dev/null
   ssh outegro-prod 'sudo bash -s -- outegro/pg-edu' < node/seal.sh > apps/production/secrets/pg-edu.yaml
   ```

   Затем добавить `- pg-edu.yaml` в `apps/production/secrets/kustomization.yaml`. Открытое значение пароля сервер не покидает.
3. Ключ ИИ-помощника (MiniMax, ADR-010). Ключ берётся из `.env` проекта work-finder и уходит на сервер через stdin, нигде не печатаясь (из корня gitops; `secrets.sh` нужно скопировать снова — пункт 2 его удаляет; `tr` убирает кавычки и CR, если они есть в `.env`):

   ```text
   scp node/secrets.sh outegro-prod:/tmp/
   grep '^MINIMAX_API_KEY=' ../work-finder/.env | tr -d '\r"' | ssh outegro-prod 'sudo bash /tmp/secrets.sh; rm /tmp/secrets.sh'
   ssh outegro-prod 'sudo bash -s -- outegro/edu-assist' < node/seal.sh > apps/production/secrets/edu-assist.yaml
   ```

   Затем `- edu-assist.yaml` в `apps/production/secrets/kustomization.yaml`. Без этого секрета edu-backend стартует, а помощник просто выключен (`GET /v1/me/assist` → `enabled: false`). Ключ читается при старте пода: если edu-backend уже работает, после добавления или замены секрета нужен `ssh outegro-prod 'sudo k3s kubectl -n outegro rollout restart deploy/edu-backend'`; лимиты — `ASSIST_DAILY_LIMIT` (30 запросов на читателя в сутки, ответы из кэша не считаются) и общий `ASSIST_GLOBAL_DAILY_LIMIT` (500 запросов к модели в сутки на всех) в `edu.yaml`, расход — на сводке «Обучения» в админке.

## Шаг 1. gitops: база, роль, вход

В `feat/edu` репозитория gitops уже есть:

- `node/secrets.sh` — `pg-edu` (basic-auth, пользователь `edu`);
- `apps/production/postgres.yaml` — управляемая роль `edu` и `Database edu`;
- `apps/production/apps.yaml` — OAuth-клиент `edu-web` (`https://edu.outegro.dev/auth/callback`) в `OAUTH_CLIENTS`;
- `apps/production/kustomization.yaml` — записи `images` для `outegro/edu-backend` и `outegro/edu-web` (тег `pending`; CI запишет `<тег>@sha256`, пока на них никто не ссылается);
- `network-policies.yaml` и `platform/monitoring/extra/targets.yaml` — `edu-backend` (без подов ни на что не влияют).

Вместе с `pg-edu.yaml` и `edu-assist.yaml` из шага 0 — коммит в `master` gitops. Проверка:

```text
ssh outegro-prod 'sudo k3s kubectl -n outegro get database edu'
ssh outegro-prod 'sudo k3s kubectl -n outegro rollout restart deploy/auth-backend'
```

auth-backend читает `OAUTH_CLIENTS` только при старте, поэтому перезапуск обязателен; без него вход в edu-web ответит «неизвестный клиент».

## Шаг 2. platform: образы

Слить PR `feat/edu` в `master` репозитория platform. Изменения затрагивают Dockerfile и корневые файлы, поэтому CI проверит и соберёт всё, включая `edu-web` и `edu-backend`, и запишет их digest в записи `images` из шага 1. Остальные приложения выкатятся как обычно (новые контракты: права `edu.*`, роль `edu_editor`, Education в меню аккаунта). Пока не сделан шаг 3, smoke запускать как `SMOKE_SKIP=edu node tools/ops/smoke.mjs`.

## Шаг 3. gitops: приложение

После того как CI записал digest edu-образов и DNS-запись из шага 0 существует, раскомментировать:

- `apps/production/kustomization.yaml` — `- edu.yaml` в `resources`;
- `apps/production/watchdog.yaml` — пробы `edu-backend` и `edu`;
- `apps/production/admin.yaml` — `EDU_API_URL` (раздел «Обучение» в админке).

Коммит в `master` gitops. Argo выполнит `edu-migrate` (миграции и импорт обеих книг), поднимет `edu-backend` и `edu-web`, Ingress `edu`.

## Проверка

```text
curl -s https://edu.outegro.dev/health          # {"status":"ok","service":"edu-web"}
node tools/ops/smoke.mjs                          # из корня platform
ssh outegro-prod 'sudo k3s kubectl -n outegro logs job/edu-migrate'
```

В логе Job — `migrations applied` и импорт двух книг. В админке: «Обучение» → две опубликованные книги, в аудите — `book.imported`. Вход на edu.outegro.dev, первая глава открыта, третья закрыта. Выдать доступ себе или тестовому аккаунту: админка → пользователь → «Доступы к продуктам» → «Обучение — все книги» с причиной; глава 3 откроется без перезахода.

## Ресурсы

edu-backend 50m / 160Mi (лимит 320Mi), edu-web 50m / 128Mi (лимит 320Mi): +100m CPU и +288Mi к запросам. По OPS-08 минимум MemAvailable при полной выкатке был 761 МиБ; ожидаемо 400–600 МиБ после добавления — выше порога вытеснения (200 МиБ), но запас меньше. Следить за `resource-pressure` после первой полной выкатки.

## Помощник не отвечает

Алерт `EduAssistantFailing`: больше половины ответов ИИ-помощника за 30 минут закончились ошибкой провайдера. Книги при этом работают, читатель видит «Помощник сейчас не отвечает» и может повторить.

1. Что происходит — по видам исхода (Grafana → Explore → Prometheus): `sum by (outcome) (increase(edu_assist_requests_total[30m]))`. В логах edu-backend — вид сбоя без промптов и ключа: `ssh outegro-prod 'sudo k3s kubectl -n outegro logs deploy/edu-backend --since=30m' | grep -i assist`.
2. По виду сбоя:
   - `unavailable` — сбой или перегрузка у MiniMax: ждать; один повтор до первого текста сервер делает сам.
   - `timeout` — ответ не уложился в 90 секунд (не повторяется); `invalid` — ответ модели не прочитан. Если таких много — проверить статус MiniMax и модель `ASSIST_MODEL`.
   - `limit` — лимит или баланс аккаунта MiniMax: пополнить баланс у провайдера или снизить `ASSIST_DAILY_LIMIT` в `apps/production/edu.yaml`.
   - `rejected` — ключ отклонён: выпустить новый ключ у MiniMax и заменить секрет, как в шаге 0.3 (ключ только через stdin), затем `ssh outegro-prod 'sudo k3s kubectl -n outegro rollout restart deploy/edu-backend'`.
   - `aborted` — читатель сам остановил ответ, это не сбой.
3. Выключить помощника, не трогая книги: `ASSIST_ENABLED: "false"` в `edu.yaml` и коммит в gitops — Argo перезапустит под (или `SAFE_MODE`, если нужно остановить все внешние эффекты сервиса). При утечке ключа — отозвать его у MiniMax, удалить секрет `edu-assist` и сразу `rollout restart deploy/edu-backend`: без перезапуска работающий под продолжит звать модель со старым ключом. Кнопки помощника исчезают со страниц, ответы из кэша тоже перестают выдаваться.

Алерт `EduAssistantPaused`: исчерпан общий дневной лимит `ASSIST_GLOBAL_DAILY_LIMIT` — до полуночи UTC помощник отвечает «приостановлен», книги работают. Если это обычный рост чтения — поднять лимит в `edu.yaml`; если всплеск от немногих новых аккаунтов — это злоупотребление: оставить лимит и посмотреть `assist_usage` по `user_id`.

## Откат

Шаг 3 — `git revert` коммита (поды и Ingress уходят, база и данные остаются). Шаг 1 — откатывать только вместе с шагом 3; база `edu` удаляется отдельно и вручную, если владелец решит отказаться от сервиса.
