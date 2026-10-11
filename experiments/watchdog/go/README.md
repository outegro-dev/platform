# Watchdog на Go

Реализация watchdog outegro.dev на Go по спецификации [`../SPEC.md`](../SPEC.md). Это замена shell-скрипта из gitops (`apps/production/watchdog.yaml`): раз в 5 минут CronJob делает один проход — проверяет поды, узлы, диск, сертификаты, PostgreSQL и бэкапы, Argo CD, HTTP-эндпоинты и алерты Prometheus, сравнивает находки с прошлым состоянием в ConfigMap и пишет владельцу в Telegram: новая проблема, напоминание раз в 6 часов, восстановление, приветствие при первом запуске и суточная сводка после 07:00 UTC.

Статус: эксперимент. В production не выкатывается; для сравнения со скриптом есть теневой режим `DRY_RUN=true` (пример манифестов — в [`deploy/`](deploy/)). Учебный разбор кода и сравнение с NestJS — в [`NOTES.md`](NOTES.md).

## Устройство

Порты и адаптеры: ядро не делает ввода-вывода и тестируется без сети и кластера.

```
cmd/watchdog/          main: конфигурация → адаптеры → проход → код выхода (composition root)
internal/
  config/              переменные окружения (caarlos0/env), проверка, маскирование токена
  domain/              находки, факты сводки, доменные структуры ресурсов, состояние (JSON v1)
  ports/               интерфейсы: ClusterSource, Prober, AlertsSource, DiskStat, StateStore, Notifier, Clock
  checks/              чистые проверки: (данные, now) → находки
  alerting/            чистые Plan (что отправить) и Apply (что запомнить после отправки)
  runner/              один проход: errgroup, дедлайны, отмена, доставка, сохранение
  adapters/
    kube/              client-go: typed (поды, узлы, ConfigMap состояния) и dynamic (CRD)
    httpprobe/         net/http, без следования редиректам
    promalerts/        prometheus/client_golang api/v1
    disk/              statfs (golang.org/x/sys/unix)
    telegram/          Bot API sendMessage, токен маскируется в ошибках
    console/           DRY_RUN: сообщения в stdout
    clock/             системные часы (UTC)
deploy/                пример теневого CronJob, ServiceAccount и RBAC (не применять)
```

## Сборка и тесты

Go на машине не нужен: все цели `make` по умолчанию идут в официальных Docker-образах, кеши — в именованных томах `outegro-go-mod`, `outegro-go-build`, `outegro-golangci-cache`. С локальным Go: `make test DOCKER=0`.

| Команда | Что делает |
|---|---|
| `make test` | `go vet ./...` и `go test -race -cover ./...` (образ `golang:1.27.2-trixie`: для `-race` нужен cgo) |
| `make lint` | `golangci-lint run ./...` с [`.golangci.yml`](.golangci.yml) (образ `golangci/golangci-lint:v2.14.0`) |
| `make cover` | профиль покрытия `internal/...` в `coverage.out` и итоговая строка |
| `make build` | статический бинарник `bin/watchdog` (`CGO_ENABLED=0`, `-trimpath`, версия через `-ldflags`) |
| `make docker` | образ `outegro/watchdog-go:dev` |
| `make check` | lint, test и docker подряд |

Без `make` (например, в Git Bash на Windows) — те же команды напрямую:

```sh
export MSYS_NO_PATHCONV=1   # только Git Bash: не переписывать пути
VOLS='-v outegro-go-mod:/go/pkg/mod -v outegro-go-build:/root/.cache/go-build'
docker run --rm -v "$PWD:/src" -w /src $VOLS golang:1.27.2-trixie sh -c 'go vet ./... && go test -race -cover ./...'
docker run --rm -v "$PWD:/src" -w /src $VOLS -v outegro-golangci-cache:/root/.cache/golangci-lint golangci/golangci-lint:v2.14.0 golangci-lint run ./...
docker build -t outegro/watchdog-go:dev --build-arg VERSION=0.1.0-dev .
```

Тесты не ходят ни в кластер, ни в Telegram: кластер — `k8s.io/client-go/kubernetes/fake` и `dynamic/fake`, Prometheus, проверяемые сайты и Bot API — `httptest`-серверы.

## Локальный запуск

Проход читает кластер только на чтение и в `DRY_RUN` ничего не пишет: сообщения печатаются в stdout, ConfigMap состояния не создаётся, Telegram не вызывается, токен не нужен. Нужен kubeconfig с правами как у `deploy/rbac.yaml`. Внутрикластерные адреса (`*.svc`) снаружи не резолвятся — такие проверки дадут `http:*` и `prom:api`; их можно переопределить через `PROBES` и `PROMETHEUS_URL` (например, на `kubectl port-forward`).

С локальным Go:

```sh
KUBECONFIG=~/.kube/outegro DRY_RUN=true DISK_PATH=/ \
PROMETHEUS_URL=http://127.0.0.1:9090 \
go run ./cmd/watchdog
```

Из образа (kubeconfig монтируется только на чтение; `--network host`, если API-сервер или port-forward слушают на localhost):

```sh
docker run --rm --read-only --network host \
  -v "$HOME/.kube/outegro:/kubeconfig:ro" -e KUBECONFIG=/kubeconfig \
  -e DRY_RUN=true -e DISK_PATH=/ \
  outegro/watchdog-go:dev
```

Без доступа к кластеру образ можно проверить так: `docker run --rm --network none -e DRY_RUN=true outegro/watchdog-go:dev` — JSON-лог конфигурации (токен замаскирован) и выход с кодом 1 «cannot create the kubernetes client».

## Конфигурация и коды выхода

Переменные окружения — как в спецификации (§4): `NAMESPACE`, `WATCHED_NAMESPACES`, `STATE_CONFIGMAP` (`watchdog-state-v2`), `PROMETHEUS_URL`, `PROBES` (`имя=URL,…`, по умолчанию 11 проверок скрипта), `DISK_PATH`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (обязательны без `DRY_RUN`), `TELEGRAM_API_URL`, `DRY_RUN`, `RUN_TIMEOUT` (120s), `HTTP_TIMEOUT` (10s), `LOG_LEVEL` (`debug`, `info`, `warn`, `error`). Все ошибки конфигурации выводятся одним сообщением с именами переменных.

| Код | Когда |
|---|---|
| 0 | проход завершён, даже если есть находки или Telegram не принял сообщение |
| 1 | не удалось прочитать или записать состояние, создать клиент Kubernetes, или проход прерван SIGTERM/SIGINT |
| 2 | ошибка конфигурации; никаких запросов до этого не делается |

Логи — JSON (`log/slog`) в stderr, последняя строка прохода — итог: `findings`, `sent`, `failedSends`, `firstRun`, `dryRun`, `duration`. Сообщения `DRY_RUN` — в stdout.

## Образ

Multi-stage: `golang:1.27.2-alpine3.24` → `gcr.io/distroless/static-debian12:nonroot` (обе базы закреплены по digest), статический бинарник без cgo, без shell, пользователь 65532, совместим с `readOnlyRootFilesystem`.

| | Размер |
|---|---|
| Сжатый (скачивание из реестра) | **10,0 MB** |
| Распакованный | ~33 MB: бинарник 27,5 MB + distroless 5,8 MB |
| `docker image ls` (containerd хранит и сжатые слои, и распакованные) | 43 MB |

Основная часть бинарника — client-go: пакет `kubernetes/scheme`, который нужен типизированному клиенту, регистрирует все группы API Kubernetes.

## Покрытие

`go test -race -cover ./...` (Go 1.27.2):

| Пакет | Покрытие |
|---|---|
| `internal/checks` | 100 % |
| `internal/alerting` | 100 % |
| `internal/runner` | 99,4 % |
| `internal/config` | 96,6 % |
| `internal/domain` | 94,1 % |
| `internal/adapters/kube` | 97,4 % |
| `internal/adapters/telegram` | 90,0 % |
| `internal/adapters/{httpprobe,promalerts,disk,console,clock}` | 100 % |
| `cmd/watchdog` | 64,7 % (не покрыты `main()` и создание настоящего клиента Kubernetes) |
| Все `internal/...` вместе (`make cover`, `-coverpkg=./internal/...`) | **98,2 %** |

## Теневой запуск

[`deploy/`](deploy/) — пример, ничего не применяется: ServiceAccount `watchdog-go`, ClusterRole с теми же правами, что у скрипта, Role на ConfigMap `watchdog-state-v2` и CronJob `watchdog-go-shadow` с `DRY_RUN=true`, тем же расписанием, `securityContext`, ресурсами и томом `watchdog-disk-probe`, что у shell-версии. Секрет Telegram в теневой под не передаётся. Сравнение: `kubectl -n outegro logs job/<watchdog-go-shadow-…>` против сообщений скрипта в Telegram за ту же минуту. В `DRY_RUN` состояние не пишется, поэтому каждый теневой проход выглядит как первый: приветствие, все проблемы как новые, сводка после 07:00. Находки с грацией (`argo:`, `http:`, `prom:api`) в напечатанных сообщениях не появляются никогда — для них `since` каждый раз равно `now`; полный список ключей каждого прохода, включая такие, есть в строке лога `findings collected`.
