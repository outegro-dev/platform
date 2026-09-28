# Что нужно от владельца: аккаунты, токены, настройки

Секреты никогда не отправляются в чат и не коммитятся. До появления кластера они хранятся в менеджере паролей (запись «outegro production»). Для локальной проверки — в `apps/<service>/.env` (игнорируется git). В кластере — в Sealed Secrets: скрипт запечатывания запускает владелец у себя в терминале, значения модель не видит. В документах и отчётах упоминаются только имена переменных.

Порядок на сегодня: **VPS → Cloudflare (зона, NS, токен) → GitHub-организация → Resend → R2 → Google → Telegram**. Lava и Hermes — на своих этапах.

## 1. VPS

| Параметр | Что выбрать | Почему |
|---|---|---|
| Виртуализация и архитектура | KVM, x86_64 (amd64) | K3s нужны свои cgroups, iptables и overlayfs; образы собираем под amd64 |
| Ресурсы | 4 vCPU, 8 ГБ RAM, 200 ГБ NVMe SSD | бюджет из [deployment.md](../02-contracts/deployment.md) |
| ОС | Ubuntu 24.04 LTS, минимальный образ | основная тестовая платформа K3s |
| Сеть | статический IPv4, IPv6 — если дают бесплатно | A/AAAA-записи домена |
| Регион | ЕС: Нидерланды, Германия, Финляндия | рядом с аудиторией EN и RU |
| Лишнее | панели (cPanel, ISPmanager), предустановленный Docker или Kubernetes, SMTP (порт 25) | всё ставим сами; почта уходит через Resend по HTTPS |

Если важна аудитория из России, перед оплатой откройте с российского подключения сайт провайдера или его looking glass. В 2025 году российские провайдеры замедляли Cloudflare и часть зарубежных хостингов. Старый VPS проекта не трогаем.

При создании сервера вставить публичный ключ из `~/.ssh/outegro_vps.pub` (создан на рабочем ПК, fingerprint `SHA256:TCMvFIA6vU+Yb5DZQ4kg7XsaIwP+AdiDkUjWApFzeKY`). Вход по паролю не нужен. На другой ПК приватный ключ переносится отдельно, как и остальные секреты, либо туда добавляется второй ключ.

Сообщить: провайдера, IPv4/IPv6, имя пользователя по умолчанию (`root` или `ubuntu`). Пароль root не присылать. Дальше — отдельное поручение на bootstrap (OPS-01): пользователь `deploy`, SSH только по ключу, firewall (22, 80, 443; API K3s наружу закрыт), обновления, K3s.

## 2. Cloudflare

1. Аккаунт и 2FA.
2. **Add a site** → `outegro.dev`, план Free. Cloudflare выдаст два NS — прописать их у регистратора домена вместо текущих. Если домен куплен в Cloudflare Registrar, шаг уже выполнен.
3. **DNS → Settings → DNSSEC → Enable**, DS-запись добавить у регистратора (в Cloudflare Registrar — автоматически).
4. После покупки VPS создать записи. Все — **DNS only (серое облако)**:

   | Тип | Имя | Значение |
   |---|---|---|
   | A | `@` | IPv4 сервера |
   | A | `id`, `pay`, `admin`, `hooks` | IPv4 сервера |
   | CNAME | `www` | `outegro.dev` |
   | AAAA | те же имена | IPv6, если есть |
   | CAA | `@` | `0 issue "letsencrypt.org"` |

   Почему без прокси. Во-первых, у пользователей из России прокси Cloudflare в 2025 году замедлялся. Во-вторых, через прокси реальный IP клиента приходит в `CF-Connecting-IP`, а последним в `X-Forwarded-For` стоит адрес Cloudflare, и ограничения входа по IP считали бы узлы Cloudflare. Если прокси понадобится (защита от DDoS), то сначала 80/443 закрываются для всех, кроме диапазонов Cloudflare, а BFF переходит на `CF-Connecting-IP`.
5. **My Profile → API Tokens → Create Token → Custom token** для cert-manager (wildcard-сертификат Let's Encrypt через DNS-01):
   - Permissions: `Zone → DNS → Edit` и `Zone → Zone → Read`;
   - Zone Resources: `Include → Specific zone → outegro.dev`;
   - Client IP Address Filtering: IPv4 сервера;
   - результат → `CLOUDFLARE_API_TOKEN`.
6. **R2** (для бэкапов нужна привязанная карта; до 10 ГБ бесплатно):
   - Create bucket `outegro-backups`, location hint — Europe;
   - **Manage API tokens → Create Account API token**: `Object Read & Write`, «Apply to specific buckets only» → `outegro-backups`;
   - сохранить `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (показывается один раз) и endpoint `https://<account-id>.r2.cloudflarestorage.com`.
7. По желанию **Email Routing**: `hello@outegro.dev` → ваша почта. Cloudflare добавит MX и SPF на корень домена. С Resend не конфликтует: его записи живут на `send.outegro.dev`.

Не включать: прокси, Always Use HTTPS, Page Rules и Bot Fight Mode. Без прокси они не работают, а редирект на HTTPS делает Traefik.

## 3. GitHub: организация

Рекомендация — **организация на бесплатном плане**, а не личный аккаунт:

- образы в GHCR получают общий неймспейс: `ghcr.io/<org>/auth-backend`;
- секреты CI задаются один раз на уровне организации;
- автоматизация (CI → PR в gitops, Argo CD, Renovate) работает через GitHub App организации, а не через ваш личный токен;
- личный аккаунт `coping-barrel` остаётся владельцем, коммиты идут от вашего имени.

| Вариант | Как | Когда выбрать |
|---|---|---|
| A. Новая организация `outegro-dev` | чистый старт, старые репозитории не мешают | хочется явно отделить новую платформу |
| B. Существующая `outegro` | новые репозитории рядом, старые — в архив | бренд один, не хочется второй организации |

Репозитории (оба **private**): `platform` — этот монорепозиторий; `gitops` — манифесты кластера (Argo CD app-of-apps, Helm values, Sealed Secrets).

1. Создать организацию и включить обязательную 2FA.
2. Создать пустые репозитории `platform` и `gitops` без README.
3. **Settings → Actions → General:** разрешить Actions; «Read and write permissions» для `GITHUB_TOKEN` не включать.
4. **Settings → Packages:** видимость по умолчанию — private.
5. На этапе CI: GitHub App для PR в gitops и деплой-ключ Argo CD (подготовлю я, вам — «Install»); для скачивания образов кластером — classic PAT только с `read:packages` (fine-grained токены GHCR не поддерживает).

Сообщите email, привязанный к GitHub (или разрешите `<id>+coping-barrel@users.noreply.github.com`). Сейчас в истории `Nick Lukashik <coping.barrel@gmail.com>`; до первого push его можно заменить без следов.

## 4. Resend: почта

1. resend.com → аккаунт и 2FA.
2. **Domains → Add domain** `outegro.dev`, регион **EU (Ireland)**. Показанные записи (TXT `resend._domainkey`, MX и TXT на `send`) добавить в Cloudflare как DNS only → **Verify**.
3. DMARC в Cloudflare: TXT `_dmarc` = `v=DMARC1; p=none; rua=mailto:<ваша почта>`. Через 2–4 недели без проблем → `p=quarantine`.
4. **API Keys → Create**: Permission `Sending access`, Domain `outegro.dev` → `RESEND_API_KEY`.
5. Бесплатно: 3 000 писем в месяц и 100 в день. Для кодов входа на старте хватит.

Проверка локально: в `apps/notifications-backend/.env` поставить `EMAIL_PROVIDER=resend` и ключ. Отправитель — `EMAIL_FROM` из `.env.example`.

## 5. Google: вход через Google (ID-02)

1. console.cloud.google.com → новый проект `outegro`.
2. **Google Auth Platform → Branding:** имя `outegro`, support email, домашняя страница `https://outegro.dev`, политика `https://outegro.dev/privacy`, authorized domain `outegro.dev`, контакт разработчика.
3. **Audience:** External → **Publish app**. Для `openid`, `email` и `profile` отдельная проверка Google не нужна. Для показа логотипа Google может попросить подтвердить домен в Search Console (TXT-запись в Cloudflare).
4. **Data access:** scopes `openid`, `userinfo.email`, `userinfo.profile`.
5. **Clients → Create client → Web application** (`id-web`), Authorized redirect URIs:
   - `https://id.outegro.dev/login/google/callback`
   - `http://localhost:3002/login/google/callback`

   JavaScript origins не нужны: обмен кода идёт на сервере id-web.
6. `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` — секрет сохранить сразу, повторно Google его не покажет.

## 6. Telegram

1. @BotFather → `/newbot`: имя `outegro`, username на `bot` (например `outegro_bot`) → `TELEGRAM_BOT_TOKEN`. По желанию `/setdescription` и `/setuserpic`.
2. Отдельный бот для алертов → `ALERTS_TELEGRAM_BOT_TOKEN`. Написать ему любое сообщение и открыть у себя `https://api.telegram.org/bot<token>/getUpdates` → `chat.id` → `ALERTS_TELEGRAM_CHAT_ID`.
3. Секрет вебхука генерирую сам.

## 7. Позже

| Этап | Что | Где | Переменные |
|---|---|---|---|
| Платежи (6) | аккаунт продавца lava.top, верификация, продукты и подписки в кабинете, тестовый сценарий | lava.top → кабинет → API | `LAVA_API_KEY`; вебхук `https://hooks.outegro.dev/lava` с `X-Api-Key` (значение генерирую я) |
| Мониторинг | UptimeRobot или Better Stack, бесплатно | их сайт | мониторы `https://outegro.dev/health` и `https://id.outegro.dev/health` после деплоя |
| Hermes (8) | отдельный бот, группа с темами, вход в ChatGPT Plus | @BotFather, Telegram | по карточкам H-01…H-04 |

## 8. Сводка переменных

| Переменная | Откуда | Кто использует |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → API Tokens | cert-manager |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT` | Cloudflare → R2 | бэкапы CloudNativePG и K3s |
| `RESEND_API_KEY` | Resend → API Keys | notifications-backend |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Auth Platform → Clients | auth-backend, id-web |
| `TELEGRAM_BOT_TOKEN` | @BotFather | notifications-backend |
| `ALERTS_TELEGRAM_BOT_TOKEN`, `ALERTS_TELEGRAM_CHAT_ID` | @BotFather, getUpdates | Alertmanager |
| GHCR pull token | GitHub → classic PAT `read:packages` | imagePullSecret кластера |
| `LAVA_API_KEY` | lava.top | payments-backend |

## 9. Что купить

| Что | Обязательно | Ориентир |
|---|---|---|
| VPS 4 vCPU / 8 ГБ / 200 ГБ NVMe | да | единственная регулярная трата |
| Домен `outegro.dev` | да, если ещё не куплен | `.dev` требует HTTPS (HSTS preload), у нас это и так есть |
| Всё остальное | нет | GitHub, Cloudflare (DNS, R2 до 10 ГБ), Resend (3 000 писем в месяц), Google OAuth, UptimeRobot — бесплатные тарифы |
