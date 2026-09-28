# Production: сервер, выпуск, секреты

Состояние на 29.09.2026. Первый выпуск: CI, GHCR и Argo CD ещё нет, выпуск идёт скриптом с машины разработчика.

## Где что

- Один VPS: Ubuntu 24.04, 5 vCPU, 8 ГБ, 200 ГБ; K3s `v1.36.4+k3s1` (stable на 29.09.2026).
- Доступ: `ssh outegro-prod` — запись в `~/.ssh/config` владельца (пользователь `deploy`, ключ `~/.ssh/outegro_vps`). IP сервера в git не хранится: origin спрятан за прокси Cloudflare. root по SSH и пароли выключены.
- kubectl — на сервере: `sudo k3s kubectl`. API K3s наружу закрыт.
- Namespaces: `outegro` — приложения, PostgreSQL `pg` (CloudNativePG), Valkey, RabbitMQ; `cert-manager`; `cnpg-system` — оператор и плагин Barman Cloud; `kube-system` — Traefik.
- Трафик: Cloudflare (Full (strict)) → Traefik :443 → Ingress `web` (`outegro.dev`, `id.outegro.dev`). На 80/443 сервер пускает только диапазоны Cloudflare — [deployment.md](../02-contracts/deployment.md#адрес-клиента).

## Новый сервер с нуля

Скрипты идемпотентны, порядок важен:

1. `ssh root@<ip> 'bash -s' < infra/server/bootstrap.sh` — обновления, автопатчи, fail2ban, пользователь `deploy`.
2. Проверить `ssh deploy@<ip>`, затем `ssh deploy@<ip> 'sudo bash -s' < infra/server/harden-ssh.sh`.
3. `… < infra/server/firewall.sh`, перезагрузить, убедиться, что таблица `outegro_guard` загрузилась.
4. `… < infra/server/install-k3s.sh`.
5. `… < infra/server/install-platform.sh` — cert-manager, CloudNativePG, плагин Barman Cloud (версии закреплены в скрипте).
6. Секреты: `scp infra/server/secrets.sh outegro-prod:/tmp/`, затем строки `KEY=value` из менеджера паролей в stdin `ssh outegro-prod 'sudo bash /tmp/secrets.sh; rm /tmp/secrets.sh'`. Имена ключей — в скрипте.
7. `infra/deploy/platform.sh` — issuer, сертификат, PostgreSQL, Valkey, RabbitMQ.
8. `infra/deploy/release.sh` — приложения.

## Выпуск

- Только с чистого коммита: `infra/deploy/release.sh`. Тег образа — 12 символов коммита.
- Образы собираются локально (Docker, один `Dockerfile` на все приложения) и загружаются в containerd узла; на сервере ничего не собирается.
- Сначала Job'ы миграций (`auth-migrate-<tag>`, `notifications-migrate-<tag>`), выкатка — только после их успеха. Затем ожидание rollout всех четырёх приложений.
- Откат совместимого релиза: `sudo k3s kubectl -n outegro rollout undo deploy/<app>` — образы прошлых релизов остаются на узле. Несовместимая схема — только forward-fix ([release-rollback.md](release-rollback.md)).

## Секреты

Значения в git не попадают; секреты в датасторе K3s зашифрованы (`secrets-encryption`).

| Secret | Namespace | Источник |
|---|---|---|
| `cloudflare-api-token` | cert-manager | владелец: токен DNS (права Zone · DNS · Edit и Zone · Zone · Read) |
| `r2-backups` | outegro | владелец: ключ R2 и endpoint |
| `notifications-providers` | outegro | владелец: Resend, Telegram |
| `google-oauth` | outegro | владелец: Google OAuth client |
| `lava` | outegro | владелец: Lava |
| `platform-internal`, `auth-signing`, `pg-auth`, `pg-notifications`, `valkey`, `rabbitmq` | outegro | сгенерированы на сервере один раз |

Замена ключа провайдера: снова `secrets.sh` с нужной строкой, затем `sudo k3s kubectl -n outegro rollout restart deploy/<app>`. Сгенерированные секреты скрипт не трогает: их замена — отдельная процедура (сессии, пароли БД).

Для восстановления датастора K3s нужен ключ шифрования `/var/lib/rancher/k3s/server/cred/encryption-config.json` — его копия хранится у владельца в менеджере паролей.

## Бэкапы

- PostgreSQL: WAL непрерывно и полная копия ежедневно в 03:00 UTC в R2 `outegro-dev-backups/postgres`, хранение 30 дней.
- Проверка: `sudo k3s kubectl -n outegro get backups` и условия `cluster pg`: `ContinuousArchiving=True`, `LastBackupSucceeded=True`.
- После смены ObjectStore перезапустить под базы (`kubectl annotate cluster pg kubectl.kubernetes.io/restartedAt=…`): плагин кэширует настройки.
- Пока не покрыто: копия датастора K3s, мониторинг свежести бэкапов, restore-drill (OPS-06). Тома Valkey и RabbitMQ не копируются: их потеря завершает сессии и теряет только непереданные события, бизнес-данные — в PostgreSQL.

## Проверки после выпуска

- Снаружи: `https://outegro.dev/health`, `https://id.outegro.dev/health/deep`, вход по коду.
- Обход Cloudflare не отвечает: `curl -k --max-time 5 https://<ip>` — таймаут.

## Чего ещё нет

- CI → GHCR → Argo CD (этап 2): выпуск скриптом.
- Мониторинг и алерты (OPS-05).
- Лимиты `NetworkPolicy` внутри кластера.
