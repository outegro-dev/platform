# Что дальше: ревью и план проверяемых этапов (28.09.2026)

Документ подготовлен после аудита legacy OuteGro (`C:\Users\working\Desktop\outegro`), документации и работающего лендинга. Карточки задач остаются источником деталей. Здесь только порядок и контрольные точки, по которым владелец проверяет результат.

## 1. Где проект сейчас

**Готово:**
- лендинг `apps/landing-web` (EN/RU, R3F-подпись, дизайн-галерея);
- `packages/ui` (Button, Dialog, Accordion, Input);
- 92 карточки задач, контракты, ADR, runbooks.

**Не начато:**
- весь backend;
- K3s и GitOps;
- Hermes.

**Git:** репозиторий инициализирован, коммитов нет.

**Инструменты:** скрипты `tools/documentation/*.py` требуют Python, а в PATH его нет (только заглушка Microsoft Store).

Состояние лендинга и замечания к нему: [../09-evidence/landing-build/report.md](../09-evidence/landing-build/report.md).

### Что взять из legacy OuteGro

**Переносим:**
- модель токенов auth: ES256 + JWKS, refresh в Redis с атомарной ротацией, passkeys, Google PKCE, email-код, rate limit;
- transactional outbox;
- `packages/contracts` (envelope, топология RabbitMQ, DLQ);
- Dockerfile'ы;
- Helm chart `outegro-service` (версия из gitops);
- app-of-apps с sync-wave;
- CNPG + barman → R2;
- sealed-secrets;
- Prometheus, Loki, Alloy, Alertmanager → Telegram;
- CI: образ → GHCR → PR с bump тега.

**Дописываем, в legacy этого нет:**
- проверка ролей: RolesGuard и admin API. Сейчас роли попадают в JWT, но нигде не проверяются;
- весь payments;
- подписки и entitlements;
- ретраи и доставка по каналам в notifications. Сейчас одна ошибка отправляет всё событие в DLQ;
- grace-окно ротации refresh-токена. Без него параллельный refresh на двух поддоменах сжигает сессию;
- общие пакеты `nest-common` и BFF-helper вместо копипасты;
- next-intl во всех фронтах;
- трейсинг;
- блокирующая валидация манифестов.

**Не переносим:**
- budget, itmaxxing, trips;
- старые данные, секреты и БД.

## 2. Замечания к документации

1. **Гостевой режим.** Упоминается в `01-specification/chapters/00-project-charter.md:29` (D-13) и `chapters/13-future-applications.md:7`, хотя владелец отменил это требование. Формулировку нужно убрать.
2. **Статусы расходятся с реальностью.** `project-context.md`, `repository-map.md`, `09-evidence/README.md` и `04-delivery/README.md` утверждают, что кода нет. Задачи BOOT/L/DS реально частично выполнены, но значатся `planned`.
3. **Карточки неатомарны для слабой модели.** Около 70% каждой карточки — повторяющийся шаблон, предметная часть — 4 общие строки без путей, сигнатур и команд. Эпики, которые нужно дробить: BE-03, OPS-02, OPS-04, OPS-08, R-02, ID-04, H-01.
4. **Пробелы:**
   - нет задачи на CI (GitHub Actions);
   - нет юридических страниц (privacy, terms/оферта для Lava);
   - не выбраны email-провайдер и SPF/DKIM/DMARC;
   - не выбраны DNS-провайдер и регистратор;
   - нет процедуры ротации секретов;
   - нет Renovate;
   - из 11 обязательных runbook есть 6.
5. **Версии не зафиксированы:** K3s, PostgreSQL, Redis, RabbitMQ, Argo CD.
6. **Конфликт версий:** `@golevelup/nestjs-rabbitmq` требует `@nestjs/core ^11`. Для Nest 12 нужен собственный тонкий AMQP-модуль.
7. **Дубли и wallet.** `01-specification/portfolio-plan.md` (188 КБ) — сгенерированная склейка глав. Wallet (6 задач) — scope, который владелец не просил. Его стоит вынести в `archive`.

## 3. Варианты, что делать дальше

| Вариант | Суть | Плюсы | Минусы |
|---|---|---|---|
| **A (рекомендую)** | Довести лендинг до v1 и **выкатить его одного** на новый VPS: минимальный K3s, Traefik, cert-manager, Argo. Затем строить платформу уже на живом кластере. | Сайт на outegro.dev работает через 1–2 недели. Кластер и CI проверяются на простом приложении. | Небольшое отступление от порядка «инфраструктура после платформы»: базовый кластер поднимается раньше. |
| B | Строго по исходному порядку: лендинг → вся платформа → интеграция → production. | Соответствует исходному плану. | Сайт появится в сети через месяцы. Проблемы кластера всплывут в самом конце. |
| C | Сначала переработать документацию: атомарные карточки и синхронизация статусов. Потом код. | Слабые модели будут работать надёжнее. | Ещё неделя без видимого результата. |

## 4. План этапов с контрольными точками (вариант A)

Каждый этап заканчивается **чекпоинтом**: что именно проверяет владелец. Этап не закрывается без evidence в `docs/09-evidence/<этап>/`.

### Этап 0. Гигиена (0.5 дня)
- [x] 0.1 Установлены правила Claude Code: `CLAUDE.md`, `.claude/skills/*`, Context7 MCP (`.mcp.json`) и ctx7 CLI. **Сделано 28.09.**
- [x] 0.2 Починена битая ссылка на отчёт лендинга (validate.py падал). **Сделано 28.09.**
- [ ] 0.3 Python 3.13 есть (`C:\Users\working\.local\bin\python3.13.exe`), но не в PATH: `python` открывает Microsoft Store. Добавить в PATH или выключить App execution alias. Либо портировать `tools/documentation` на Node.
- [x] 0.4 Локальный git с логической историей коммитов. **28.09** Публикация на GitHub — после создания организации ([owner-checklist](owner-checklist.md)).
- [ ] 0.5 Убран гостевой режим из D-13 и главы 13. Статусы в README и start-here синхронизированы с фактом.

**Чекпоинт 0:** `git log` показывает коммит; `validate.py` → pass; в документации нет упоминаний guest mode.

### Этап 1. Лендинг v1 (3–5 дней)
- [x] 1.1 Sticky glass-header, мобильная навигация всегда доступна, пункт Contact. **28.09**
- [x] 1.2 Signature v2: прорисовка, текучая деформация, реакция на курсор, liquid glass, PMREM 1024, DPR 2. **28.09**
- [x] 1.3 Секция Platform — схема платформы со статусами, лента стека, стек в Expertise виден без аккордеона. **28.09**
- [x] 1.4 Reveal без скрытия SSR, `NL`-глиф убран, AI-картинки заменены живыми 3D-сценами. **28.09**
- [x] 1.5 Новый копирайт EN/RU, акцентные шрифты, токены вместо hex (UI kit `@outegro/ui`). **28.09**
- [x] 1.6 Реальные контакты: email, Telegram, LinkedIn, GitHub. **28.09**
- [x] 1.7 FPS на реальном GPU (60 при DPR 2) и Lighthouse (desktop 99, mobile 86–87, остальные категории 100). **28.09**
- [x] 1.8 Standalone, `/health`, React Compiler, CSP с nonce, язык через cookie `og_locale` (`@outegro/i18n`). **28.09**
- [ ] 1.9 Страница privacy (нужна до auth и платежей) и ссылка на неё в footer.
- [ ] 1.10 Проверка на телефоне владельца (реальный FPS мобильного GPU).

**Чекпоинт 1:** владелец смотрит `localhost:3000` на своём компьютере и телефоне. Доказательства: [landing-build/report.md](../09-evidence/landing-build/report.md) — скриншоты v2, Lighthouse, FPS, 58 e2e.

### Этап 2. Минимальный production-кластер (2–4 дня)
- [ ] 2.1 Новый VPS 4/8/200 и DNS outegro.dev (нужен владелец).
- [ ] 2.2 K3s (версия зафиксирована), Traefik, cert-manager + wildcard, Sealed Secrets, Argo CD. Повторяем legacy `gitops`, но с блокирующим kubeconform.
- [ ] 2.3 CI: lint/test/build → GHCR → PR в gitops. Образы по digest.
- [ ] 2.4 Лендинг в K3s. Внешний uptime-check.

**Чекпоинт 2:** `https://outegro.dev` открывается с валидным TLS. Коммит в main сам доходит до production через PR в gitops. Откат — revert PR.

### Этап 3. Backend-фундамент (1 неделя)
- [x] 3.1 `packages/nest-common` (config, pino, health, JWKS-guard, RolesGuard, валидация Standard Schema, rate limit в Valkey) и `packages/db` (Drizzle, миграции, outbox/inbox). **28.09**
- [x] 3.2 Модуль RabbitMQ под Nest 12 (confirms, TTL-ретраи, DLQ), outbox relay, `packages/contracts`. **28.09**
- [x] 3.3 docker-compose: Postgres 18, Valkey 9, RabbitMQ 4, Mailpit (`pnpm infra:up`). **28.09**
- [ ] 3.4 В кластер: CNPG (1 instance + backup в bucket), Valkey, RabbitMQ, Prometheus, Loki, Grafana с лимитами под 8 ГБ — вместе с этапом 2.

**Чекпоинт 3:** шаблонный сервис стартует локально и в кластере. Событие проходит outbox → RabbitMQ → inbox с дедупликацией. Restore БД из бэкапа отрепетирован.

### Этап 4. Identity: auth-backend + id-web (1–1.5 недели)
- [ ] 4.1 Email-код, Google OAuth, passkeys, SSO через `id.outegro.dev`, refresh с grace-окном.
- [ ] 4.2 Роли платформы, RolesGuard, entitlements (проекция от Payments), audit.

**Чекпоинт 4:** вход на id.outegro.dev работает. Сессии видны и отзываются. Запрос без роли получает 403 (есть тест).

### Этап 5. Notifications (3–5 дней)
- [ ] Email и Telegram, ретраи с backoff по каждому каналу, предпочтения, шаблоны EN/RU.

**Чекпоинт 5:** код входа приходит на почту (SPF/DKIM настроены). Упавший канал не блокирует остальные.

### Этап 6. Payments + подписки (1.5–2 недели)
- [ ] Адаптер Lava, invoice, webhook, журнал, сверка, подписки, выдача и отзыв entitlements, pay-web.

**Чекпоинт 6:** тестовый сценарий Lava проходит от начала до конца. Повторный webhook ×10 не удваивает grant. Продажи выключены флагом до решения владельца.

### Этап 7. Admin (1 неделя)
- [ ] admin-web и admin-backend: пользователи, сессии, роли, платежи, подписки, цепочка событий, replay с reason и audit.

**Чекпоинт 7:** владелец находит пользователя и видит его платежи, гранты и уведомления в одной цепочке.

### Этап 8. Hermes (1 неделя, можно параллельно с 6–7)
- [ ] 8.1 Spike: вход ChatGPT Plus (codex OAuth) в headless-поде, лимиты, отсутствие платных fallback.
- [ ] 8.2 Gateway в namespace `agents`, Telegram-группа с topics, правила на каждый topic.
- [ ] 8.3 `assistant-store`: фото → карточка вещи (цены, состояние, описание) → черновик объявления.

**Чекпоинт 8:** фото в topic «Вещи» создаёт запись в каталоге. В billing OpenAI нет API-расходов.

### Этап 9. Интеграционный релиз
- [ ] E2E по всем сервисам, нагрузка на 8 ГБ, runbooks, restore-drill.

**Чекпоинт 9:** release gate D пройден, все runbooks проверены.

### Этап 10. Морской бой
Отдельное ТЗ после чекпоинта 9.

## 5. Какие задачи каким моделям

| Тип задачи | Модель |
|---|---|
| Архитектура, ревью, безопасность auth и платежей, 3D-сцена | Opus / GPT-5-класс |
| CRUD-модули по готовому контракту, UI по макету, Helm values, тесты по списку TC | Sonnet / Codex |
| Переводы, копирайт-варианты, мелкие правки, обновление статусов | Haiku / MiniMax / Kimi |

Слабой модели давать только атомарную карточку: пути файлов, сигнатуры, команда проверки.

## 6. Что нужно от владельца

- Контакты для сайта: email, Telegram, LinkedIn, GitHub.
- GitHub-репозиторий: приватный или публичный, организация.
- Покупка VPS и доступ к DNS outegro.dev (где зарегистрирован домен).
- Bucket для бэкапов (Cloudflare R2 или аналог).
- Email-провайдер (Resend, как в legacy?) и домен отправителя.
- Google OAuth client.
- Lava: merchant-аккаунт, тестовый сценарий.
- Hermes: бот и группа с topics, личный вход в ChatGPT.
