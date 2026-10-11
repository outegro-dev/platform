# Watchdog: спецификация (Go и Rust)

Учебный проект вне репозиториев платформы (`outegro-watchdog-lab`): две независимые реализации одного сервиса — `go/` и `rust/` — на замену shell-скрипту watchdog из gitops (`apps/production/watchdog.yaml`, sh + jq + kubectl). Поведение для владельца остаётся тем же: те же проверки, те же сообщения в Telegram. Цель — production-качество по практикам, принятым в компаниях, и учебный материал: одна спецификация, два языка, сравнение с NestJS.

Статус: эксперимент. В production не выкатывается, пока владелец не решит; предусмотрен теневой режим (`DRY_RUN`) для сравнения со скриптом.

## 1. Что делает

Запускается Kubernetes CronJob раз в 5 минут, делает один проход и завершается:

1. Собирает **находки** (finding: ключ + сообщение) всеми проверками параллельно.
2. Сравнивает их с **состоянием** прошлого прохода (ConfigMap) и решает, что отправить: новая проблема, напоминание, восстановление, приветствие, суточная сводка.
3. Отправляет сообщения в Telegram (в `DRY_RUN` — печатает в stdout).
4. Сохраняет новое состояние (в `DRY_RUN` — не сохраняет).

## 2. Проверки

Время `now` берётся один раз на проход. Наблюдаемые namespace: `outegro`, `agents`, `argocd`, `cert-manager`, `cnpg-system`, `kube-system` (настраивается). Ключ — стабильный идентификатор проблемы; по нему проблема узнаётся в следующих проходах. Если одинаковый ключ получен несколько раз, остаётся первый.

| Проверка | Источник | Правило → находка `ключ` · сообщение |
|---|---|---|
| Поды: сбой контейнера | `pods` во всех наблюдаемых namespace, кроме фазы `Succeeded` и подов, принадлежащих `Job` | контейнер в `waiting` с причиной `CrashLoopBackOff`, `ImagePullBackOff`, `ErrImagePull` или `CreateContainerConfigError` → `pod:<ns>/<app>` · `<ns>/<pod>: <reason>` |
| Поды: не готов | те же | условие `Ready` не `True` дольше 600 с (от `lastTransitionTime`, иначе от `creationTimestamp`) → `pod:<ns>/<app>` · `<ns>/<pod> not ready for <N> min` |
| Поды: OOM | все поды наблюдаемых namespace | `lastState.terminated.reason == OOMKilled` и `finishedAt` моложе 900 с → `oom:<ns>/<container>` · `<ns>/<pod>: container <container> ran out of memory` |
| Узлы | `nodes` | `Ready` не `True` или любое другое условие `True` (давление памяти, диска, PID) → `node:<node>:<type>` · `node <node>: <type>=<status> (<reason>)` |
| Диск | `statfs` пути `DISK_PATH` (том узла, `/probe`) | занято ≥ 80 % (как `df`: used / (used + available), округление вверх) → `disk` · `server disk <P>% used` |
| Сертификаты | `certificates.cert-manager.io/v1`, все namespace | `Ready` не `True` → `cert:<name>` · `certificate <name> not ready: <message или unknown>`; иначе до `notAfter` меньше 14 дней → `cert:<name>` · `certificate <name> expires in <D> days` |
| PostgreSQL | `clusters.postgresql.cnpg.io/v1` `pg` в `NAMESPACE` | условие `Ready`, `ContinuousArchiving` или `LastBackupSucceeded` не `True` → `pg:<type>` · `PostgreSQL <type>: <reason> <message>`; кластера нет → `pg:cluster` · `PostgreSQL cluster pg is missing` |
| Бэкапы | `backups.postgresql.cnpg.io/v1` в `NAMESPACE` | самый свежий `completed` по `stoppedAt` старше 26 ч → `pg:backup-age` · `last completed backup is <H> h old`; нет ни одного → `pg:backup-age` · `no completed backup found` |
| Argo CD | `applications.argoproj.io/v1alpha1` в `argocd` | `sync.status != Synced` или `health.status != Healthy` → `argo:<app>` · `Argo CD <app>: <sync или ?> / <health или ?>` |
| HTTP | список `PROBES` (`имя=URL`) | ответ не 200 за 10 с → `http:<имя>` · `<URL> answered <код или no response>` |
| Prometheus | `GET $PROMETHEUS_URL/api/v1/alerts` | алерт в состоянии `firing`, кроме `Watchdog`, `InfoInhibitor`, `KubePodCrashLooping`, `KubePodNotReady`, `ContainerOOMKilled` и кроме `severity` `info`/`none` → `prom:<alertname>:<scope>` · `<alertname> (<severity или warning>): <annotations.summary или scope>`, где scope — уникальные непустые значения меток `namespace, pod, service, queue, name, job_name, deployment, statefulset, persistentvolumeclaim` через `/` в отсортированном порядке; API не ответил → `prom:api` · `Prometheus alerts API does not answer` |

`<app>` пода: метка `app`, иначе `app.kubernetes.io/name`, иначе `k8s-app`, иначе имя пода.

Если список ресурса получить не удалось: для подов — находка `kube:pods` · `cannot list pods`; для узлов, сертификатов, бэкапов и Argo CD — проверка пропускается с предупреждением в логе (как в скрипте). Ошибка одной проверки не останавливает остальные.

**Факты для суточной сводки** (в сообщении `?`, если неизвестно): число подов в фазе `Running` (все namespace), возраст последнего бэкапа в часах, минимальное число дней до `notAfter` среди сертификатов, процент занятого диска.

## 3. Оповещения и состояние

Состояние — словарь `ключ → { since, notified, message }` (unix-секунды; `notified = 0` — ещё не сообщали) и `digestDay` (`YYYYMMDD` по UTC последней сводки).

Для каждой текущей находки: `since` берётся из прошлого состояния или `now`. Грация по префиксу ключа: `argo:` — 900 с, `http:` — 240 с, `prom:api` — 900 с, остальные — 0. Если `now − since ≥ grace`:

- не сообщали → строка в «проблема», `notified = now`;
- сообщали ≥ 6 ч назад → строка в «всё ещё», `notified = now`.

Находка из прошлого состояния, которой больше нет, и о которой сообщали (`notified ≠ 0`) → строка в «восстановлено». Пропавшая находка, о которой не сообщали (не дождалась грации), исчезает молча.

Сообщения (каждое — одна отправка; строки — `• <message>` с новой строки):

| Когда | Текст |
|---|---|
| Состояния ещё нет (первый запуск) | `👋 outegro.dev watchdog is on duty: pods, nodes, disk, certificates, backups, Argo CD and health checks every 5 minutes.` |
| Есть новые проблемы | `🔴 outegro.dev: problem` + строки |
| Есть напоминания | `🟠 outegro.dev: still failing` + строки |
| Есть восстановления | `🟢 outegro.dev: recovered` + строки |
| UTC-час ≥ 7 и сводки сегодня не было | `☀️ outegro.dev daily: <All checks pass. или Failing checks: N.>` и строки `Pods running: …`, `Last backup: … h ago`, `Certificate: … days left`, `Disk: …% used` |

Порядок отправки — как в таблице. **Улучшение по сравнению со скриптом:** `notified` и `digestDay` меняются только после успешной отправки соответствующего сообщения; если Telegram не принял сообщение, следующий проход попробует снова. Сбой отправки — ошибка в логе, проход продолжается.

Хранение: ConfigMap `STATE_CONFIGMAP` в `NAMESPACE`, ключ `state.json`, одинаковый в обеих реализациях JSON: `{"version":1,"digestDay":"YYYYMMDD","entries":{"<ключ>":{"since":…,"notified":…,"message":"…"}}}` (`digestDay` нет до первой сводки) — любая из реализаций продолжает с состояния другой. Если ConfigMap нет — первый запуск: создать. Если есть — обновить (конфликт версии ресурса → один повтор с перечитыванием). Нечитаемое состояние — считать первым запуском и предупредить в логе. Формат shell-скрипта читать не нужно: имя ConfigMap отличается.

## 4. Конфигурация (переменные окружения)

| Переменная | По умолчанию | Смысл |
|---|---|---|
| `NAMESPACE` | `outegro` | namespace кластера PostgreSQL, бэкапов и состояния |
| `WATCHED_NAMESPACES` | `outegro,agents,argocd,cert-manager,cnpg-system,kube-system` | namespace для подов |
| `STATE_CONFIGMAP` | `watchdog-state-v2` | имя ConfigMap состояния |
| `PROMETHEUS_URL` | `http://monitoring-prometheus.monitoring.svc:9090` | |
| `PROBES` | 11 проверок скрипта (см. ниже) | `имя=URL` через запятую |
| `DISK_PATH` | `/probe` | путь для `statfs` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | — | обязательны, если не `DRY_RUN` |
| `TELEGRAM_API_URL` | `https://api.telegram.org` | для тестов |
| `DRY_RUN` | `false` | сообщения в stdout, состояние не пишется |
| `RUN_TIMEOUT` | `120s` | общий дедлайн прохода (CronJob даёт 180 с) |
| `HTTP_TIMEOUT` | `10s` | одна HTTP-проверка и запрос к Prometheus |
| `LOG_LEVEL` | `info` | |

`PROBES` по умолчанию: `landing=https://outegro.dev/`, `id=https://id.outegro.dev/health`, `auth=http://auth-backend.outegro.svc:4001/health/deep`, `notifications=http://notifications-backend.outegro.svc:4002/health/deep`, `payments=http://payments-backend.outegro.svc:4003/health/deep`, `battleship-backend=http://battleship-backend.outegro.svc:4004/health/deep`, `battleship=https://battleship.outegro.dev/health`, `edu-backend=http://edu-backend.outegro.svc:4005/health/deep`, `edu=https://edu.outegro.dev/health`, `pay=https://pay.outegro.dev/health`, `admin=https://admin.outegro.dev/health`.

Неверная конфигурация (нет токена без `DRY_RUN`, плохой URL, плохая длительность) — понятная ошибка и выход с кодом 2 до любых запросов.

## 5. Нефункциональные требования

- Один статический бинарник; образ — multi-stage, финальный слой distroless `nonroot`, корень только для чтения, без shell. Размер образа — указать в README.
- Структурные JSON-логи (уровень, сообщение, поля), без секретов: токен Telegram не попадает ни в лог, ни в текст ошибки (URL с токеном маскируется).
- Все проверки идут параллельно, у каждой своя отмена по общему дедлайну; HTTP-проверки — тоже параллельно. Проход длится не дольше самой медленной проверки.
- SIGTERM/SIGINT отменяют проход: незавершённые проверки прекращаются, состояние не пишется наполовину.
- Код выхода: `0` — проход завершён (даже если есть находки или сбой отправки); `1` — не удалось прочитать или записать состояние либо создать клиент Kubernetes; `2` — ошибка конфигурации.
- Последняя строка лога прохода — итог: число находок, сколько отправлено сообщений, длительность.
- Клиент Kubernetes: in-cluster конфигурация, иначе `KUBECONFIG`/`~/.kube/config` (для локального запуска).
- RBAC тот же, что у скрипта, плюс имя нового ConfigMap.

## 6. Архитектура (одинаковая в обеих реализациях)

Порты и адаптеры: ядро без ввода-вывода, тестируется без сети и кластера.

- **Порты (интерфейсы / traits):** `ClusterSource` (поды, узлы, сертификаты, кластер PG, бэкапы, приложения Argo — в виде минимальных доменных структур, не сырых объектов API), `Prober` (HTTP-код по URL), `AlertsSource` (алерты Prometheus), `DiskStat` (процент занятого), `StateStore` (загрузить / сохранить), `Notifier` (отправить текст), `Clock` (текущее время).
- **Ядро:** чистые функции проверок `(данные, now) → находки (+ факты)` и чистая функция плана оповещений `plan(старое состояние, находки, факты, now) → (сообщения, новое состояние)`; применение результата отправки к состоянию — тоже чистая функция.
- **Адаптеры:** Kubernetes (типизированный клиент для ядра API, динамический — для CRD), HTTP, Prometheus, statfs, ConfigMap, Telegram, stdout.
- **Сборка (composition root):** `main` читает конфигурацию, создаёт адаптеры, запускает проход.

## 7. Тесты

- Табличные тесты каждой проверки: срабатывает и не срабатывает на границах (600 с, 900 с, 14 дней, 26 ч, 80 %), пропуск `Succeeded` и подов Job, выбор `<app>`, scope и фильтры Prometheus.
- План оповещений: первый запуск; грация для `argo:`, `http:`, `prom:api`; напоминание через 6 ч и не раньше; восстановление только сообщённого; молчаливое исчезновение несообщённого; сводка один раз в сутки после 07:00 UTC; сбой отправки не меняет `notified`/`digestDay`; дубликаты ключей.
- Интеграционный тест прохода целиком на подменах (фейковый кластер, HTTP-заглушки Prometheus, проверок и Telegram): находки → правильные сообщения → состояние; второй проход без изменений ничего не шлёт; `DRY_RUN` не пишет состояние и не ходит в Telegram.
- Конфигурация: значения по умолчанию, ошибки, маскирование токена.
- Покрытие ядра — не меньше 80 %; результат — в README.

## 8. Инструменты и практики

**Go** (последний стабильный): модули; `k8s.io/client-go` (typed + `dynamic` для CRD, `fake` в тестах); `log/slog` (JSON); `golang.org/x/sync/errgroup`; `github.com/caarlos0/env/v11` для конфигурации; `github.com/prometheus/client_golang/api` + `api/prometheus/v1` для алертов; `net/http` с `context` для проверок и Telegram; `golang.org/x/sys/unix` для `statfs`; `testing` + `github.com/stretchr/testify`, `httptest`; `golangci-lint` (конфиг в репо), `go vet`, `go test -race -cover`; раскладка `cmd/watchdog`, `internal/...`; Makefile; Dockerfile `golang:*-alpine` → `gcr.io/distroless/static-debian12:nonroot`, `CGO_ENABLED=0`, `-trimpath`, версия через `-ldflags`.

**Rust** (последний стабильный, edition 2024): `tokio`; `kube` + `k8s-openapi` (typed API и `DynamicObject`/`ApiResource` для CRD); `reqwest` с `rustls`; `serde`/`serde_json`; `tracing` + `tracing-subscriber` (JSON, `EnvFilter`); `clap` (derive, `env`) для конфигурации; `thiserror` для ошибок домена и адаптеров, `anyhow` только в `main`; `chrono`; `nix` (`statvfs`); `#![forbid(unsafe_code)]`; тесты `#[tokio::test]` и `wiremock`; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` (плюс `clippy::pedantic` с обоснованными исключениями); Dockerfile с `cargo-chef` → `gcr.io/distroless/cc-debian12:nonroot` (или статический musl → `static`).

Обе: README (что это, как собрать, протестировать, запустить локально с `KUBECONFIG` и `DRY_RUN=true`, размер образа, покрытие), пример манифестов для теневого запуска (`deploy/`: CronJob с `DRY_RUN=true`, ServiceAccount, RBAC — не применять), `NOTES.md` для обучения: ключевые идиомы языка в этом коде с путями к файлам и таблица соответствий NestJS (модули/DI ↔ …, `@nestjs/config` + Zod ↔ …, pino ↔ …, `HttpService`/`fetch` ↔ …, `Promise.all` ↔ …, исключения ↔ …, Jest/Vitest ↔ …, `@nestjs/schedule` ↔ CronJob).

## 9. Границы

- Код только в своей папке (`go/` или `rust/`). Репозитории платформы и gitops, их CI, production и секреты не трогать; в репозитории платформы проект не коммитится.
- Инструменты — официальные Docker-образы (`golang`, `rust`) с кешами в именованных томах Docker; ничего не ставить в систему и не оставлять сборочных каталогов на рабочем столе (`target/` — в томе Docker).
- К настоящему кластеру и Telegram не подключаться: всё проверяется на подменах.
