# Что нужно от владельца: аккаунты, токены, настройки

Секреты никогда не отправляются в чат и не коммитятся. До появления кластера они хранятся в менеджере паролей (запись «outegro production»). Для локальной проверки — в `apps/<service>/.env` (игнорируется git). В кластере — в Sealed Secrets: скрипт запечатывания запускает владелец у себя в терминале, значения модель не видит. В документах и отчётах упоминаются только имена переменных.

Порядок: **VPS → Cloudflare (зона, NS, токен) → GitHub-организация → Resend → R2 → Google → Telegram**. Lava и Hermes — на своих этапах.

## 1. VPS

Куплен 29.09.2026: 5 vCPU, 8 ГБ RAM, 200 ГБ, Ubuntu 24.04, ключ `outegro_vps` добавлен. Ждём IP.

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

Решение владельца 29.09.2026: записи идут **через прокси** (оранжевое облако). Аудитория — Европа; замедление у пользователей из России принято. Прокси защищает сайт, только если сервер принимает 80/443 исключительно от Cloudflare, а адрес посетителя берётся из `CF-Connecting-IP` — см. [deployment.md](../02-contracts/deployment.md#адрес-клиента). SSH прокси не касается.

1. Аккаунт и 2FA.
2. **Add a site** → `outegro.dev`, план Free. NS Cloudflare прописать у регистратора. **DNS → Settings → DNSSEC → Enable**, DS-запись — у регистратора.
3. Удалить записи, импортированные от регистратора (парковка, старый `www`, MX), если они не наши: CNAME не создаётся рядом с другой записью того же имени.
4. Записи, все **Proxied**:

   | Тип | Имя | Значение |
   |---|---|---|
   | A | `@`, `www`, `id`, `pay`, `admin`, `hooks` | IPv4 сервера |

   AAAA и CAA не нужны: IPv6 для посетителей и сертификаты на своей стороне Cloudflare обеспечивает сам. Для SSH записи нет — подключение по IP.
5. **Rules → Redirect Rules → Create rule**: шаблон «Redirect from WWW to root» или вручную `https://www.outegro.dev/*` → `https://outegro.dev/${1}`, 301, Preserve query string.
6. Настройки зоны (удобно через поиск панели, Ctrl+K):
   - SSL/TLS → Overview: **Full (strict)**. Пока сервер не готов, сайт отдаёт ошибку 52x — это ожидаемо;
   - SSL/TLS → Edge Certificates: Always Use HTTPS — On, Minimum TLS Version — 1.2;
   - выключить **Rocket Loader**, **Email Address Obfuscation** и **Web Analytics (RUM)**: они вставляют в страницы скрипты, которые блокирует CSP с nonce;
   - выключить **Bot Fight Mode**: на Free для него нет исключений по хосту, а он блокирует вебхуки Lava и внешний мониторинг.
7. **API-токен для cert-manager** (сертификат Let's Encrypt на сервере через DNS-01):
   1. https://dash.cloudflare.com/profile/api-tokens → **Create Token** → внизу **Custom token → Get started**, имя `cert-manager outegro.dev`.
   2. Permissions: `Zone · DNS · Edit` и `Zone · Zone · Read` (вторая строка — «+ Add more»).
   3. Zone Resources: `Include · Specific zone · outegro.dev`.
   4. Client IP Address Filtering: `Is in` → IPv4 и IPv6 сервера.
   5. TTL: End Date через год; напоминание в календаре за 2 недели.
   6. **Continue to summary → Create Token** → в менеджер паролей как `CLOUDFLARE_API_TOKEN`. Токен показывается один раз; команду проверки с curl никуда не вставлять — в ней токен.

   Ротация: новый токен с теми же правами → скрипт запечатывания обновляет Sealed Secret → cert-manager берёт его при следующей DNS-01 проверке → принудительно продлить один сертификат → удалить старый токен. Просроченный токен не роняет сайт сразу: сертификат живёт 90 дней и продлевается за 30; алерт «сертификат истекает меньше чем через 21 день» ловит это заранее. При смене IP сервера фильтр токена обновляется.
8. **R2 для бэкапов:**
   1. Меню аккаунта → **R2 Object Storage**; активировать R2 и привязать карту (до 10 ГБ бесплатно).
   2. **Create bucket**: `outegro-dev-backups`, Location — Automatic, hint **Western Europe (WEUR)**, Storage class — Standard, jurisdiction не выбирать. Публичный доступ (R2.dev subdomain, custom domains) не включать.
   3. **Manage API tokens → Create Account API token**: имя `cnpg-backups`, **Object Read & Write**, **Apply to specific buckets only** → `outegro-dev-backups`, TTL — Forever, Client IP filtering — IPv4 и IPv6 сервера (обязательно: в бэкапах данные пользователей).
   4. Сохранить `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` (показывается один раз) и `R2_ENDPOINT` = `https://<account-id>.r2.cloudflarestorage.com`. «Token value» не нужен. При восстановлении на новом сервере выпускается новый ключ под его IP.
9. По желанию **Email Routing**: `hello@outegro.dev` → ваша почта. MX и SPF — на корне домена, с Resend (`send.outegro.dev`) не конфликтует.

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

1. https://console.cloud.google.com → выбор проекта сверху → **New project** → `outegro` → Create; переключиться на него.
2. Меню → **Google Auth Platform → Get started**: App name `outegro`, User support email — своя почта; Audience — **External**; Contact information — своя почта; согласиться с условиями → Create.
3. **Branding:** логотип не загружать (с ним Google включает проверку бренда на несколько дней); Application home page `https://outegro.dev`; privacy policy `https://outegro.dev/privacy`; terms of service — пусто; Authorized domains — `outegro.dev` → Save.
4. **Audience → Publish app** → статус «In production». В режиме Testing войти могут только тестовые пользователи. Для `openid`, `email` и `profile` проверка Google не нужна.
5. **Data Access → Add or remove scopes:** `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile` → Update → Save.
6. **Clients → Create client:** Application type — **Web application**, name `id-web`; Authorized JavaScript origins — пусто (обмен кода идёт на сервере id-web); Authorized redirect URIs:
   - `https://id.outegro.dev/login/google/callback`
   - `http://localhost:3002/login/google/callback`
7. **Create** → `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET` в менеджер паролей (или Download JSON). Секрет показывается только при создании. Изменения вступают в силу от 5 минут до нескольких часов.

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
