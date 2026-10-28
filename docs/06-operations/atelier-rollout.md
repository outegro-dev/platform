# Atelier: первая выкатка atelier.outegro.dev и cv.outegro.dev

Как у Education ([edu-rollout.md](edu-rollout.md)): сначала база, секреты и вход, потом образы, потом приложение. Job миграций `atelier-migrate` — PreSync-хук общего приложения Argo `outegro`: если он упадёт (нет образа, секрета или базы), встанут выкатки всех сервисов, поэтому порядок шагов обязателен. Решение и состав — [ADR-013](../03-decisions/adr/013-atelier.md).

Изменения gitops разложены на три ветки репозитория gitops, по одной на шаг:

| Ветка | Что | Когда сливать |
|---|---|---|
| `feat/atelier-images` | записи `images` пяти образов (`pending`), OAuth-клиент `atelier-web`, патч приоритетов, `atelier.yaml` (выключен), строки `node/secrets.sh` | до платформы: CI пишет digest только в существующие записи. В отрисовке меняется одна строка — OAuth-клиент |
| `feat/atelier-database` | роль и `Database atelier` (`postgres.yaml`) | вместе с запечатанными секретами шага 0 |
| `feat/atelier-on` | `- atelier.yaml` в `resources` | после шагов 0–2, когда база создана |

## Шаг 0. Владелец, вне репозиториев

1. Cloudflare → DNS `outegro.dev`: `A atelier` и `A cv` → IPv4 сервера, **Proxied**. Origin закрыт wildcard `*.outegro.dev` (`certificate.yaml`). Сделано владельцем 28.10.2026.
2. Секреты на сервере. Из корня gitops (ветка `feat/atelier`); значения идут через stdin и нигде не печатаются. Вход Codex берётся из тома Work Finder (`work-finder_codex_auth`), ключи Claude и MiniMax — из `.env` Work Finder:

   ```text
   scp node/secrets.sh outegro-prod:/tmp/
   { printf 'ATELIER_CODEX_AUTH_B64=%s\n' "$(docker run --rm -v work-finder_codex_auth:/a:ro alpine:3.22 base64 -w0 /a/auth.json)"; grep -E '^(MINIMAX_API_KEY|CLAUDE_CODE_OAUTH_TOKEN)=' ../work-finder/.env | sed 's/^/ATELIER_/' | tr -d '\r"'; } | ssh outegro-prod 'sudo bash /tmp/secrets.sh; rm /tmp/secrets.sh'
   for s in pg-atelier atelier-internal atelier-codex atelier-llm; do ssh outegro-prod "sudo bash -s -- outegro/$s" < node/seal.sh > "apps/production/secrets/$s.yaml"; done
   ```

   Затем добавить четыре файла в `apps/production/secrets/kustomization.yaml` и закоммитить их в ветку `feat/atelier-database`. `pg-atelier` и `atelier-internal` (сервисные токены между backend, llm-gateway, tex и browser) создаются один раз и больше не меняются; `atelier-codex` — только затравка: при первом старте init-контейнер копирует `auth.json` в том `llm-gateway-home`, дальше Codex обновляет вход там.

## Шаг 1a. gitops: записи образов и вход

Слить `feat/atelier-images` в `master` gitops. Ничего не запускается; OAuth-клиент `atelier-web` подхватит auth-backend при выкатке шага 2 (его образ пересобирается из-за контрактов).

## Шаг 1b. gitops: база и секреты

Слить `feat/atelier-database` вместе с файлами секретов из шага 0.

```text
ssh outegro-prod 'sudo k3s kubectl -n outegro get database atelier'
```

## Шаг 2. platform: образы

Слить PR `feat/atelier` в `master` platform (можно до шага 1b, но после 1a). Изменены Dockerfile, контракты (право `atelier.use`) и корневые файлы, поэтому CI проверит и соберёт все приложения, включая `atelier-backend`, `atelier-web`, `llm-gateway`, `atelier-tex`, `atelier-browser`, и запишет их digest в gitops. Пока не сделан шаг 3, smoke — `SMOKE_SKIP=atelier node tools/ops/smoke.mjs`.

## Шаг 3. gitops: приложение

Слить `feat/atelier-on` (раскомментирует `- atelier.yaml`), когда шаг 1b применён и digest образов записаны. Argo выполнит `atelier-migrate`, поднимет пять деплойментов и Ingress `atelier` и `cv`.

## Шаг 4. Профиль владельца

Профиль собирается локально из Work Finder и попадает в базу через под, файл в репозиторий не попадает. Порядок компаний, квоты буллетов и ответы для анкет (локация, формат работы, зарплата, срок уведомления) лежат рядом с банком в `atelier-settings.json` папки Work Finder (схема — `profileSettingsSchema` в `apps/atelier-backend/src/tools/profile/build-profile.ts`); другой файл — `--settings <путь>`:

```text
pnpm --filter @outegro/atelier-backend build
node apps/atelier-backend/dist/tools/import-profile.js --work-finder C:\Users\working\Desktop\work-finder --out %TEMP%\atelier-profile.json
ssh outegro-prod 'sudo k3s kubectl -n outegro exec -i deploy/atelier-backend -- node dist/tools/import-profile.js --stdin --user owner' < %TEMP%\atelier-profile.json
```

Профиль с ключом `owner` достаётся первому пользователю с правом `atelier.use` при первом входе.

## Проверка

```text
curl -s https://atelier.outegro.dev/health
curl -sI https://cv.outegro.dev/unknown/file.pdf      # 404
ssh outegro-prod 'sudo k3s kubectl -n outegro logs job/atelier-migrate'
ssh outegro-prod 'sudo k3s kubectl -n outegro logs deploy/llm-gateway --tail=50'
```

Войти на atelier.outegro.dev, добавить вакансию по ссылке, дождаться колонки «Готово», открыть ссылку на CV.

## Ресурсы

Запросы: atelier-backend 50m/192Mi, atelier-web 30m/128Mi, llm-gateway 20m/128Mi, atelier-tex 20m/96Mi, atelier-browser 20m/128Mi — всего +140m CPU и +672Mi. Пики (Codex, XeLaTeX, Chromium) до 1 ГБ на под, но они в `outegro-agents` и при нехватке памяти вытесняются первыми. Параллельность в проде: Codex 3 вызова, TeX 1 сборка, браузер 1 вкладка. Следить за `resource-pressure` после первых генераций.

## Откат

Шаг 3 — `git revert` коммита (поды и Ingress уходят, база и данные остаются). Шаг 1 откатывать только вместе с шагом 3.
