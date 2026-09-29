# Production: сервер, выпуск, секреты

Состояние на 29.09.2026.

## Где что

- Один VPS: Ubuntu 24.04, 5 vCPU, 8 ГБ, 200 ГБ; K3s `v1.36.4+k3s1`.
- Доступ: `ssh outegro-prod` — запись в `~/.ssh/config` владельца (пользователь `deploy`, ключ `~/.ssh/outegro_vps`). IP сервера в git не хранится: origin спрятан за прокси Cloudflare. root по SSH и пароли выключены; kubectl — на сервере, `sudo k3s kubectl`.
- Репозитории организации `outegro-dev`: [platform](https://github.com/outegro-dev/platform) — код и CI; [gitops](https://github.com/outegro-dev/gitops) — состояние кластера, скрипты сервера, Sealed Secrets. Основная ветка — `master`.
- Namespaces: `outegro` — приложения, PostgreSQL `pg` (CloudNativePG), Valkey, RabbitMQ, watchdog; `agents` — Hermes; `argocd`; `cert-manager`; `cnpg-system`; `kube-system` — Traefik, Sealed Secrets.
- Трафик: Cloudflare (Full (strict)) → Traefik :443 → Ingress `web` (сайты) и `hooks` (вебхуки). На 80/443 сервер пускает только диапазоны Cloudflare — [deployment.md](../02-contracts/deployment.md#адрес-клиента).

## Выпуск

1. PR в `platform` → CI (`.github/workflows/ci.yml`): lint, типы, тесты с настоящими PostgreSQL/Valkey/RabbitMQ, сборка.
2. Слияние в `master` → образы всех приложений одним графом (`docker-bake.hcl`) в `ghcr.io/outegro-dev/<app>:<12 символов коммита>`.
3. CI коммитит новые теги в `gitops/apps/production/kustomization.yaml` (deploy-ключ `GITOPS_DEPLOY_KEY`); Argo CD синхронизирует: PreSync-миграции, выкатка, проверки готовности. Argo опрашивает git раз в 3 минуты.
4. Откат — `git revert` коммита с тегом в `gitops`.

## Новый сервер

Порядок — в [README репозитория gitops](https://github.com/outegro-dev/gitops#новый-сервер): скрипты `node/` (bootstrap, SSH, firewall, K3s, Argo CD), восстановление ключа Sealed Secrets, `bootstrap/root.yaml`.

## Секреты

Только Sealed Secrets в `gitops`; открытые значения не покидают сервер ([gitops/README](https://github.com/outegro-dev/gitops#секреты)). Секреты в датасторе K3s дополнительно зашифрованы (`secrets-encryption`). Новые сгенерированные секреты добавляются в `node/secrets.sh` (режим `once`) и запечатываются `node/seal.sh`.

| Secret | Namespace | Источник |
|---|---|---|
| `cloudflare-api-token` | cert-manager | владелец: токен DNS (Zone · DNS · Edit и Zone · Zone · Read) |
| `r2-backups` | outegro | владелец: ключ R2 и endpoint |
| `notifications-providers` | outegro | владелец: Resend, Telegram-бот уведомлений |
| `google-oauth` | outegro | владелец: Google OAuth client (auth-backend) |
| `lava`, `lava-webhook` | outegro | владелец: ключ API Lava; секрет вебхука `X-Api-Key` (сгенерирован, внесён в Lava) |
| `alerts-telegram` | outegro | владелец: бот алертов и chat id (watchdog) |
| `ghcr-pull` | outegro | владелец: classic PAT `read:packages` |
| `hermes-telegram` | agents | владелец: бот Hermes, allowlist владельца |
| `platform-internal`, `auth-signing`, `pg-auth`, `pg-notifications`, `pg-payments`, `pg-battleship`, `valkey`, `rabbitmq`, `telegram-webhook` | outegro | сгенерированы на сервере один раз |

У владельца в менеджере паролей: ключ шифрования K3s и приватный ключ Sealed Secrets. Без них секреты не восстановить на новом сервере.

## Вебхуки: `hooks.outegro.dev`

Ingress `hooks` пропускает только точные пути; Traefik-middleware `webhooks-prefix` добавляет `/webhooks`, сервисы обслуживают `/webhooks/<провайдер>` вне `/v1`.

| Публичный путь | Сервис | Аутентификация |
|---|---|---|
| `POST /telegram` | notifications-backend | заголовок `X-Telegram-Bot-Api-Secret-Token` = `TELEGRAM_WEBHOOK_SECRET`; вебхук регистрируется при старте сервиса |
| `POST /lava` | payments-backend (после выкатки) | заголовок `X-Api-Key` = `LAVA_WEBHOOK_SECRET` |

Всё остальное на хосте — 404. В Cloudflare для хоста выключена Browser Integrity Check.

## Вход через Google

auth-backend получает `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` из `google-oauth` и `GOOGLE_REDIRECT_URI=https://id.outegro.dev/login/google/callback` (зарегистрирован в Google Console вместе с localhost). id-web берёт настройки из `GET /v1/login/google/config`.

## Мониторинг: watchdog

CronJob `outegro/watchdog` раз в 5 минут (образ `alpine/k8s`, только чтение кластера, кроме своего ConfigMap `watchdog-state`) проверяет и пишет в Telegram через бота алертов:

- поды: CrashLoopBackOff, ошибки образа, OOM, «не готов» дольше 10 минут (namespaces outegro, agents, argocd, cert-manager, cnpg-system, kube-system);
- узел: Ready и давление памяти/диска/PID; диск сервера ≥ 80 % (через маленький local-path том);
- сертификаты: не готов или меньше 14 дней;
- PostgreSQL: `Ready`, `ContinuousArchiving`, `LastBackupSucceeded`, возраст последнего бэкапа ≥ 26 ч;
- Argo CD: приложение не Synced/Healthy дольше 15 минут;
- HTTP: `outegro.dev`, `id.outegro.dev/health` через Cloudflare, `/health/deep` сервисов изнутри (2 провала подряд).

Сообщения: проблема (после льготного периода), напоминание каждые 6 часов, восстановление, дайджест раз в сутки после 07:00 UTC. Состояние: `sudo k3s kubectl -n outegro get configmap watchdog-state -o jsonpath='{.data.state}'`; журнал запуска: `sudo k3s kubectl -n outegro logs job/<последний watchdog-…>`.

## Бэкапы

- PostgreSQL: WAL непрерывно и полная копия ежедневно в 03:00 UTC в R2 `outegro-dev-backups/postgres`, хранение 30 дней. Свежесть проверяет watchdog.
- Проверка вручную: `sudo k3s kubectl -n outegro get backups`, условия `cluster pg`: `ContinuousArchiving=True`, `LastBackupSucceeded=True`.
- После смены ObjectStore перезапустить под базы (`kubectl annotate cluster pg kubectl.kubernetes.io/restartedAt=…`): плагин кэширует настройки.
- Пока не покрыто: копия датастора K3s, restore-drill (OPS-06).

## Проверки после выпуска

- Снаружи: `https://outegro.dev/health`, `https://id.outegro.dev/health/deep`, вход по коду.
- Вебхуки: `POST https://hooks.outegro.dev/telegram` без секрета → 401, любой другой путь → 404.
- Обход Cloudflare не отвечает: `curl -k --max-time 5 https://<ip>` — таймаут.

## Чего ещё нет

- Метрики и графики (Prometheus/Grafana или VictoriaMetrics) — пока только watchdog.
- `NetworkPolicy` внутри кластера.
