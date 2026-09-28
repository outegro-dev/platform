# Что нужно от владельца: аккаунты, доступы, покупки

Секреты никогда не отправляются в чат и не коммитятся. Локально они лежат в `apps/<service>/.env` (игнорируется git), в CI — в секретах организации GitHub, в кластере — в Sealed Secrets. Модель ссылается только на имена переменных.

## 1. GitHub: организация

Рекомендация — **организация на бесплатном плане**, а не личный аккаунт:

- образы в GHCR получают общий неймспейс: `ghcr.io/<org>/auth-backend`;
- секреты CI задаются один раз на уровне организации и доступны обоим репозиториям;
- автоматизация (CI → PR в gitops, Argo CD, Renovate) работает через GitHub App организации, а не через ваш личный токен;
- личный аккаунт `coping-barrel` остаётся владельцем, коммиты идут от вашего имени, а репозитории можно закрепить в профиле.

Старый проект публиковал образы в `ghcr.io/outegro`, то есть организация `outegro`, вероятно, уже ваша. Варианты:

| Вариант | Как | Когда выбрать |
|---|---|---|
| A. Новая организация `outegro-dev` | чистый старт, старые репозитории не мешают | хочется явно отделить новую платформу |
| B. Существующая `outegro` | новые репозитории рядом, старые — в архив | бренд один, не хочется второй организации |

Репозитории (оба **private**):

| Репозиторий | Что внутри |
|---|---|
| `platform` | этот монорепозиторий: apps, packages, docs |
| `gitops` | манифесты кластера: Argo CD app-of-apps, Helm values, Sealed Secrets |

Что сделать руками:

1. Создать организацию и включить обязательную 2FA для участников.
2. Создать пустые репозитории `platform` и `gitops` без README, чтобы запушить существующую историю.
3. **Settings → Actions → General:** разрешить Actions, «Read and write permissions» для `GITHUB_TOKEN` не включать.
4. **Settings → Packages:** видимость по умолчанию — private.
5. Позже, на этапе CI, я подготовлю GitHub App для PR в gitops и деплой-ключ для Argo CD; вам останется нажать «Install».

Сообщите email, привязанный к GitHub (или разрешите `<id>+coping-barrel@users.noreply.github.com`). Сейчас в локальной истории стоит `Nick Lukashik <coping.barrel@gmail.com>`; до первого push его можно заменить без следов.

## 2. Токены и доступы по этапам

| Когда | Что | Где взять | Переменные / куда |
|---|---|---|---|
| Сейчас (auth, notifications локально) | ничего | Mailpit, заглушки Google и Telegram | — |
| Реальная почта | аккаунт Resend, домен `outegro.dev` подтверждён, API key с правом только **Sending** | resend.com → Domains, API Keys | `RESEND_API_KEY`, отправитель `no-reply@outegro.dev`; DNS-записи SPF, DKIM, DMARC из панели Resend |
| Вход через Google | проект Google Cloud, OAuth consent screen (External), клиент типа Web | console.cloud.google.com → APIs & Services → Credentials | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`; redirect URI сообщу точные: `http://localhost:4001/…` и `https://id.outegro.dev/…`. Consent screen требует ссылку на privacy policy — её страницу сделаем на лендинге |
| Telegram-уведомления | бот платформы | @BotFather → /newbot | `TELEGRAM_BOT_TOKEN`, имя бота; секрет вебхука сгенерирую сам |
| Passkeys | ничего | — | RP ID `id.outegro.dev` |
| Кластер (этап 2) | VPS, SSH-доступ по ключу | провайдер VPS | ваш публичный SSH-ключ добавляется на сервер; приватный ключ остаётся у вас |
| DNS и сертификаты | зона `outegro.dev` в Cloudflare, API token с правом **Zone → DNS → Edit** только для этой зоны | dash.cloudflare.com → My Profile → API Tokens | `CLOUDFLARE_API_TOKEN` → Sealed Secret для cert-manager |
| Бэкапы | бакет Cloudflare R2 и S3-ключ с доступом **только к этому бакету** | Cloudflare → R2 → Manage API tokens | `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, endpoint → Sealed Secret для CloudNativePG |
| Алерты | Telegram-чат для Alertmanager (можно тот же бот или отдельный) | @BotFather, id чата | Sealed Secret |
| Внешний uptime-check | UptimeRobot или Better Stack (бесплатно) | их сайт | просто монитор на `https://outegro.dev/health` |
| Платежи (этап 6) | merchant-аккаунт Lava, тестовый режим | lava.top | `LAVA_API_KEY`, секрет вебхука |
| Hermes (этап 8) | отдельный бот, группа с темами, вход в ChatGPT Plus | @BotFather, Telegram | по карточкам H-01…H-04 |

## 3. Что купить

| Что | Обязательно | Ориентир |
|---|---|---|
| VPS 4 vCPU / 8 ГБ / 200 ГБ SSD | да, к этапу 2 | единственная регулярная трата |
| Домен `outegro.dev` | да, если ещё не куплен — подтвердите | `.dev` требует HTTPS (HSTS preload), у нас это и так есть |
| Всё остальное | нет | GitHub, Cloudflare (DNS, R2 до 10 ГБ), Resend (3 000 писем в месяц), Google OAuth, UptimeRobot — бесплатные тарифы, для старта хватит |

## 4. Что создать руками (коротко)

1. GitHub-организация и два пустых приватных репозитория.
2. Аккаунт Cloudflare и перенос DNS `outegro.dev` на Cloudflare (если домен у другого регистратора — сменить NS).
3. Аккаунт Resend и подтверждение домена DNS-записями.
4. Google Cloud: проект и OAuth-клиент (после того как будет privacy-страница).
5. @BotFather: бот уведомлений платформы.
6. Покупка VPS и добавление вашего SSH-ключа.
7. Позже: Lava merchant, бот и группа для Hermes.
