# Production: сервер, выпуск, секреты

Состояние на 29.09.2026.

## Где что

- Один VPS: Ubuntu 24.04, 5 vCPU, 8 ГБ, 200 ГБ; K3s `v1.36.4+k3s1`.
- Доступ: `ssh outegro-prod` — запись в `~/.ssh/config` владельца (пользователь `deploy`, ключ `~/.ssh/outegro_vps`). IP сервера в git не хранится: origin спрятан за прокси Cloudflare. root по SSH и пароли выключены; kubectl — на сервере, `sudo k3s kubectl`.
- Репозитории организации `outegro-dev`: [platform](https://github.com/outegro-dev/platform) — код и CI; [gitops](https://github.com/outegro-dev/gitops) — состояние кластера, скрипты сервера, Sealed Secrets. Основная ветка — `master`.
- Namespaces: `outegro` — приложения, PostgreSQL `pg` (CloudNativePG), Valkey, RabbitMQ; `argocd`; `cert-manager`; `cnpg-system`; `kube-system` — Traefik, Sealed Secrets.
- Трафик: Cloudflare (Full (strict)) → Traefik :443 → Ingress `web`. На 80/443 сервер пускает только диапазоны Cloudflare — [deployment.md](../02-contracts/deployment.md#адрес-клиента).

## Выпуск

1. PR в `platform` → CI (`.github/workflows/ci.yml`): lint, типы, тесты с настоящими PostgreSQL/Valkey/RabbitMQ, сборка.
2. Слияние в `master` → образы всех приложений одним графом (`docker-bake.hcl`) в `ghcr.io/outegro-dev/<app>:<12 символов коммита>`.
3. CI меняет теги в `gitops/apps/production/kustomization.yaml`; Argo CD синхронизирует: PreSync-миграции, выкатка, проверки готовности.
4. Откат — `git revert` коммита с тегом в `gitops`.

Пока в организации выключены deploy-ключи, шаг 3 не автоматический: тег меняется коммитом в `gitops`, состояние применяется вручную (`kubectl kustomize` + `kubectl apply --server-side` на сервере). Включение: Settings организации → Member privileges → Deploy keys → Enabled.

## Новый сервер

Порядок — в [README репозитория gitops](https://github.com/outegro-dev/gitops#новый-сервер): скрипты `node/` (bootstrap, SSH, firewall, K3s, Argo CD), восстановление ключа Sealed Secrets, `bootstrap/root.yaml`.

## Секреты

Только Sealed Secrets в `gitops`; открытые значения не покидают сервер ([gitops/README](https://github.com/outegro-dev/gitops#секреты)). Секреты в датасторе K3s дополнительно зашифрованы (`secrets-encryption`).

| Secret | Namespace | Источник |
|---|---|---|
| `cloudflare-api-token` | cert-manager | владелец: токен DNS (Zone · DNS · Edit и Zone · Zone · Read) |
| `r2-backups` | outegro | владелец: ключ R2 и endpoint |
| `notifications-providers` | outegro | владелец: Resend, Telegram |
| `google-oauth` | outegro | владелец: Google OAuth client |
| `lava`, `lava-webhook` | outegro | владелец: ключ API Lava; секрет вебхука (сгенерирован) |
| `ghcr-pull` | outegro | владелец: classic PAT `read:packages` |
| `platform-internal`, `auth-signing`, `pg-auth`, `pg-notifications`, `valkey`, `rabbitmq` | outegro | сгенерированы на сервере один раз |

У владельца в менеджере паролей: ключ шифрования K3s и приватный ключ Sealed Secrets. Без них секреты не восстановить на новом сервере.

## Бэкапы

- PostgreSQL: WAL непрерывно и полная копия ежедневно в 03:00 UTC в R2 `outegro-dev-backups/postgres`, хранение 30 дней.
- Проверка: `sudo k3s kubectl -n outegro get backups`, условия `cluster pg`: `ContinuousArchiving=True`, `LastBackupSucceeded=True`.
- После смены ObjectStore перезапустить под базы (`kubectl annotate cluster pg kubectl.kubernetes.io/restartedAt=…`): плагин кэширует настройки.
- Пока не покрыто: копия датастора K3s, мониторинг свежести бэкапов, restore-drill (OPS-06).

## Проверки после выпуска

- Снаружи: `https://outegro.dev/health`, `https://id.outegro.dev/health/deep`, вход по коду.
- Обход Cloudflare не отвечает: `curl -k --max-time 5 https://<ip>` — таймаут.

## Чего ещё нет

- Мониторинг и алерты (OPS-05).
- `NetworkPolicy` внутри кластера.
