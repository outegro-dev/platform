# watchdog (Rust)

Реализация watchdog outegro.dev на Rust по спецификации [`../SPEC.md`](../SPEC.md): замена shell-скрипта из gitops (`apps/production/watchdog.yaml`) с тем же поведением для владельца — те же проверки и те же сообщения в Telegram. Kubernetes CronJob запускает бинарник раз в 5 минут; он делает один проход и завершается.

Статус: эксперимент. В production не выкатывается; для сравнения со скриптом есть теневой режим (`DRY_RUN=true`) и пример манифестов в [`deploy/`](deploy/). Учебные заметки (идиомы Rust, сравнение с NestJS) — в [`NOTES.md`](NOTES.md).

## Что делает один проход

1. Параллельно собирает данные: поды, узлы, сертификаты cert-manager, кластер и бэкапы CNPG, приложения Argo CD (Kubernetes API), занятость диска (`statvfs`), HTTP-проверки из `PROBES`, алерты Prometheus. У каждого источника общий дедлайн `RUN_TIMEOUT`.
2. Чистые функции проверок превращают данные в находки (`ключ · сообщение`) и факты для суточной сводки.
3. Чистая функция плана сравнивает находки с прошлым состоянием и решает, что отправить: приветствие, «проблема», «всё ещё», «восстановлено», суточная сводка.
4. Сообщения уходят в Telegram (в `DRY_RUN` — JSON-строками в stdout). `notified` и `digestDay` меняются только для доставленных сообщений.
5. Новое состояние сохраняется в ConfigMap `watchdog-state-v2` (`state.json`, `"version": 1`) одним запросом: `create` при первом запуске, дальше `update` с `resourceVersion` (при конфликте — перечитать и повторить один раз); если состояние не изменилось, запись пропускается. В `DRY_RUN` не пишется никогда.

## Устройство

Порты и адаптеры: ядро без ввода-вывода, тестируется без сети и кластера.

```text
src/
  main.rs            composition root: конфигурация → адаптеры → проход → код выхода (anyhow только здесь)
  lib.rs
  config.rs          clap (derive + env) → валидация в Config; Secret с маскирующим Debug
  domain.rs          Finding, Facts, Pod, Node, Certificate, ... — минимальные доменные структуры
  state.rs           State/Entry и формат state.json (version 1)
  ports.rs           трейты ClusterSource, Prober, AlertsSource, DiskStat, StateStore, Notifier, Clock; ошибки
  checks/            чистые проверки: pods, nodes, disk, certificates, postgres, argo, http, prometheus
  alerting.rs        plan(...) → Plan; Plan::apply(доставленные) → State
  run.rs             один проход: tokio::join! + JoinSet, timeout_at, отправка, сохранение
  telemetry.rs       JSON-логи tracing, вывод цепочки ошибок
  adapters/          cluster (kube, typed + DynamicObject), configmap, http, prometheus, telegram, stdout, disk, clock
tests/
  common/mod.rs      in-memory фейки портов
  run.rs             проход целиком: фейковый кластер и хранилище, wiremock для проверок, Prometheus и Telegram
  cli.rs             бинарник целиком: коды выхода, маскирование токена, DRY_RUN против фейкового API-сервера, SIGTERM
deploy/              пример теневого CronJob + ServiceAccount + RBAC (не применять)
```

## Сборка и проверки

Rust на хосте не нужен: всё запускается в официальном образе `rust:1.99.0-slim-bookworm`. Для `rustfmt`, `clippy` и покрытия собирается образ инструментов из [`toolchain.Dockerfile`](toolchain.Dockerfile) (официальный образ + компоненты). Кеш реестра и каталог `target/` живут в именованных томах Docker, в репозитории ничего не появляется.

```sh
# один раз: образ инструментов (rustfmt, clippy, llvm-tools, cargo-llvm-cov)
docker build -f toolchain.Dockerfile -t outegro/watchdog-rs-toolchain:1.99.0 .

# любая команда cargo в контейнере (из этой папки)
docker run --rm -v "$PWD:/src" -w /src \
  -v outegro-cargo-registry:/usr/local/cargo/registry \
  -v outegro-cargo-git:/usr/local/cargo/git \
  -v outegro-rust-target:/target -e CARGO_TARGET_DIR=/target \
  outegro/watchdog-rs-toolchain:1.99.0 cargo test
```

В Git Bash на Windows перед командой нужен `MSYS_NO_PATHCONV=1`, а путь монтируется в виде `C:/Users/working/Desktop/outegro-watchdog-lab/rust:/src`.

С `make` то же короче: `make check` (fmt-check, clippy, тесты) нативно или `make docker-check` в контейнере; ещё `docker-test`, `docker-lint`, `docker-cover`, `docker-build`, `make docker` (образ), `make toolchain`.

| Проверка | Команда | Результат |
|---|---|---|
| Формат | `cargo fmt --check` | чисто |
| Линтер | `cargo clippy --all-targets -- -D warnings` (+ `clippy::pedantic` в `Cargo.toml [lints]`) | чисто |
| Тесты | `cargo test` | 224 теста, все проходят (~2 с) |
| Покрытие | `cargo llvm-cov --summary-only` | строки 99,0 %, ядро 99–100 % (таблица ниже) |
| Образ | `docker build -t outegro/watchdog-rs:dev .` | 13,8 МБ (сжатый), 52 МБ на диске |

## Запуск локально

Клиент Kubernetes берёт in-cluster конфигурацию, иначе `KUBECONFIG` / `~/.kube/config`. С `DRY_RUN=true` сообщения печатаются в stdout, состояние только читается, Telegram не нужен:

```sh
docker run --rm \
  -v "$HOME/.kube/config:/kube/config:ro" -e KUBECONFIG=/kube/config \
  -e DRY_RUN=true -e DISK_PATH=/ \
  -e PROMETHEUS_URL=http://host.docker.internal:9090 \
  outegro/watchdog-rs:dev
```

или с установленным Rust: `DRY_RUN=true DISK_PATH=/ cargo run`. На Linux kubeconfig обычно доступен только владельцу (`0600`), а образ работает от пользователя `nonroot` — добавьте `--user "$(id -u)"`. Адреса `*.svc` из `PROBES` и `PROMETHEUS_URL` вне кластера не резолвятся: Prometheus можно пробросить (`kubectl -n monitoring port-forward svc/monitoring-prometheus 9090`), а `PROBES` сократить до публичных адресов. Все параметры есть и флагами: `watchdog --help`.

Выход в `DRY_RUN` — JSON-строки: логи и сообщения вперемешку, сообщения отмечены `dryRun`:

```json
{"dryRun":true,"message":"🔴 outegro.dev: problem\n• outegro/api-1: CrashLoopBackOff"}
{"timestamp":"2026-10-10T08:00:01.2Z","level":"INFO","message":"pass complete","findings":3,"messages":2,"sent":2,"state":"Skipped","dry_run":true,"duration_ms":412,"target":"watchdog::run"}
```

Сообщения отдельно: `... | jq -r 'select(.dryRun) | .message'`. Последняя строка прохода — итог: число находок, отправленных сообщений, длительность.

## Конфигурация

Переменные и значения по умолчанию — как в [SPEC §4](../SPEC.md#4-конфигурация-переменные-окружения): `NAMESPACE`, `WATCHED_NAMESPACES`, `STATE_CONFIGMAP`, `PROMETHEUS_URL`, `PROBES`, `DISK_PATH`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_API_URL`, `DRY_RUN`, `RUN_TIMEOUT`, `HTTP_TIMEOUT`, `LOG_LEVEL`. Длительности — в формате `humantime` (`120s`, `2m`, `1m30s`); `DRY_RUN` принимает `true/false/1/0/yes/no`; `LOG_LEVEL` — уровень или директивы `EnvFilter` (`info,watchdog=debug`). Ошибка конфигурации — JSON-строка с именем переменной и код 2 до любых запросов; токен не печатается ни в логах, ни в ошибках, ни в `--help`.

## Коды выхода

| Код | Когда |
|---|---|
| 0 | проход завершён (даже с находками или сбоем отправки) |
| 1 | не удалось прочитать или записать состояние, создать клиент Kubernetes или HTTP |
| 2 | ошибка конфигурации (в том числе неверный флаг) |
| 130 / 143 | проход отменён SIGINT / SIGTERM (128 + номер сигнала); состояние не записано |

## Тесты и покрытие

| Модуль | Тестов | Что проверяется |
|---|---|---|
| `checks::*` | 106 | табличные (`rstest`) тесты каждой проверки на границах: 600 с, 900 с, 14 дней, 26 ч, 80 %; пропуск `Succeeded` и подов Job; выбор `<app>`; scope и фильтры Prometheus; порядок и дубликаты |
| `alerting` | 26 | первый запуск; грация `argo:`/`http:`/`prom:api`; напоминание через 6 ч и не раньше; восстановление только сообщённого; молчаливое исчезновение; сводка раз в сутки после 07:00 UTC; сбой отправки не меняет `notified`/`digestDay`; частичная доставка; дубликаты ключей |
| `config` | 30 | значения по умолчанию, имена переменных, ошибки, маскирование токена |
| `state`, `domain`, `telemetry` | 11 | формат `state.json`, версия, цепочка ошибок |
| `adapters::*` | 35 | kube-адаптеры против wiremock в роли API-сервера (маппинг, 404, 403, конфликт `resourceVersion` с одним повтором, гонка create); HTTP, Prometheus, Telegram (форма, ошибки без токена), stdout, statvfs |
| `tests/run.rs` | 9 | проход целиком: находки → сообщения → состояние; второй проход без изменений ничего не шлёт и не пишет; восстановление; `DRY_RUN` не пишет и не ходит в Telegram; повтор после сбоя Telegram; параллельные HTTP-проверки и их грация; дедлайн; сбой хранилища; паника задачи проверки |
| `tests/cli.rs` | 7 | бинарник: коды 0/1/2/143, `--help` без токена, полный `DRY_RUN`-проход против фейкового Kubernetes API, SIGTERM посреди прохода |

Покрытие (`cargo llvm-cov`, все тесты, включая запуски бинарника), строки:

| Файлы | Покрытие |
|---|---|
| `checks/*` | 99,5–100 % |
| `alerting.rs` | 100 % |
| `state.rs`, `domain.rs`, `config.rs` | 99,6–100 % |
| `run.rs` | 94,6 % |
| `adapters/*` | 94–100 % |
| `main.rs` | 100 % |
| **Всего** | **99,0 %** (регионы 98,2 %) |

## Образ

Multi-stage [`Dockerfile`](Dockerfile): `cargo-chef` кеширует сборку зависимостей отдельным слоем, финальный слой — `gcr.io/distroless/cc-debian12:nonroot` (без shell, пользователь nonroot), release-профиль с LTO и `strip`. Размер `outegro/watchdog-rs:dev`: **13,8 МБ** сжатого содержимого (столько скачивает узел), 52 МБ в распакованном виде; из них бинарник — 10,4 МБ, остальное — слои distroless (glibc, CA-сертификаты, tzdata). В CronJob корень только для чтения, бинарник ничего не пишет на диск.

`cc`, а не `static`: бинарник собран под glibc (нужны `libc` и `libgcc_s`). Статический musl-вариант возможен, но требует musl-таргета и даёт выигрыш в единицы мегабайт; спецификация разрешает оба.

## Теневой запуск

[`deploy/`](deploy/) — пример (не применять): `ServiceAccount` `watchdog-rs`, `ClusterRole` с теми же правами чтения, что у скрипта, `Role` на ConfigMap `watchdog-state-v2`, `CronJob` `watchdog-rs-shadow` с `DRY_RUN=true` и теми же расписанием, `securityContext`, ресурсами и томами, что у shell-версии. Сравнение: `kubectl -n outegro logs job/<имя> | jq -r 'select(.dryRun) | .message'` против сообщений скрипта в Telegram.

## Решения там, где спецификация молчит

- Сообщение «восстановлено», не принятое Telegram, не теряется: записи остаются в состоянии, следующий проход сообщит снова. Если проблема вернётся раньше, она продолжается со старыми `since`/`notified` — владельцу о восстановлении не сообщали.
- Приветствие отправляется при первом запуске один раз; если Telegram его не принял, состояние всё равно создаётся (иначе каждая неудача повторяла бы «первый запуск»).
- Неизменённое состояние не записывается (меньше обновлений ConfigMap и etcd).
- `prom:api` — точное совпадение ключа (как `case` в скрипте), чтобы алерт с именем `api` не получил грацию 15 минут.
- Пустая строка в метках и аннотациях считается отсутствующим значением (`<app>`, `severity`, `summary`, `message`).
- Готовый сертификат без `notAfter` не даёт находки (скрипт выдал бы «expires in -20000 days»).
- Кластер PG, который не удалось прочитать по любой причине, считается отсутствующим (как в скрипте); причина пишется в лог.
- Ответ Prometheus с `status != "success"` или не-JSON считается «API не ответил».
- HTTP-проверки не следуют редиректам (как `curl` без `-L`); `301` — находка.
- Дедлайн `RUN_TIMEOUT` ограничивает сбор данных; отправка (15 с на сообщение, как `curl -m 15`) и запись состояния (таймаут чтения kube-клиента 30 с) идут после него.
- Повторяющиеся имена в `PROBES` — ошибка конфигурации (имя становится ключом находки).
- `DRY_RUN`-сообщения — JSON-строки в stdout, чтобы вывод оставался «одно событие — одна строка» рядом с JSON-логами.
