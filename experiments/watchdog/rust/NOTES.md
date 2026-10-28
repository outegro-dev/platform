# Заметки для изучения: Rust на примере watchdog

Как читать этот код, какие идиомы Rust в нём использованы и где, почему выбраны именно эти crate и как всё это соотносится с NestJS. Идентификаторы из кода — по-английски, пути — от папки `rust/`.

Порядок чтения: `src/domain.rs` → `src/checks/pods.rs` → `src/alerting.rs` → `src/ports.rs` → `src/run.rs` → `src/adapters/telegram.rs` → `src/main.rs` → `tests/run.rs`.

## 1. Идиомы Rust в этом коде

### 1.1 Владение и заимствование

- **Чтение по ссылке, результат по значению.** Проверки берут данные взаймы и возвращают новый вектор: `pods::evaluate(pods: &[Pod], watched: &[String], now) -> Vec<Finding>` (`src/checks/pods.rs`). `&[T]` (срез) вместо `&Vec<T>` принимает и вектор, и массив, и часть вектора. Ничего не копируется, владельцем результата становится вызывающий.
- **Ссылка в результате живёт не дольше аргумента.** `pods::app_name(pod: &Pod) -> &str` возвращает либо значение метки, либо имя пода — без аллокации; компилятор выводит, что `&str` живёт столько же, сколько `pod` (lifetime elision). Где выводить нечего, время жизни пишется явно: `find_condition<'a>(conditions: &'a [Condition], kind: &str) -> Option<&'a Condition>` (`src/domain.rs`).
- **Перемещение вместо клонирования.** Адаптер разбирает объект API по значению: `pod_from(pod: core::Pod) -> Pod` (`src/adapters/cluster.rs`). `meta.labels.unwrap_or_default()` и `c.type_` перемещают строки из уже ненужного объекта в доменную структуру, `clone()` не нужен.
- **Потребляющий метод.** `Plan::apply(self, delivered: &[MessageKind]) -> State` (`src/alerting.rs`) забирает план: применить его дважды нельзя, это ошибка компиляции, а не баг в рантайме.
- **Ссылки на входные данные внутри алгоритма.** `plan` строит `BTreeMap<&str, &Finding>` — индекс по ключам без копирования находок.
- **Где без владения не обойтись.** `JoinSet::spawn` требует `'static`-future: задача может пережить текущую функцию. Поэтому в `run::probe_all` (`src/run.rs`) каждая задача получает свой `Arc::clone(prober)` и свою копию `Probe` (`targets.iter().cloned()`).

### 1.2 `Result`, `?` и ошибки

- **Ошибки — значения.** Никаких исключений: функция, которая может не сработать, возвращает `Result<T, E>`, а `?` пробрасывает ошибку наверх, конвертируя её через `From`.
- **`thiserror` для типизированных ошибок** в библиотеке: `SourceError`, `StoreError`, `NotifyError` (`src/ports.rs`), `ConfigError` (`src/config.rs`), `RunError` (`src/run.rs`), `KubeSetupError` (`src/adapters/cluster.rs`). `#[error("...")]` генерирует `Display`, `#[source]` хранит причину, `#[from]` даёт автоматическую конвертацию для `?` (например, `io::Error → SourceError::Io`).
- **Сообщение не повторяет причину**: `#[error("request failed")] Request(#[source] BoxError)`. Полная цепочка печатается обходом `Error::source()` — `telemetry::Chain` (`src/telemetry.rs`): `request failed: connection refused`.
- **`anyhow` только в `main`** (`src/main.rs`): `cluster::client().await.context("cannot create Kubernetes client")?` добавляет контекст к любой ошибке, а лог печатает всю цепочку через тот же `Chain`. Ниже `main` каждая ошибка — конкретный enum, и вызывающий может сделать `match`.
- **Ошибка проверки — не ошибка прохода.** `Observations` (`src/checks/mod.rs`) хранит `Result` каждого источника как данные; проверка решает, что значит сбой (`kube:pods` или пропуск). Ошибкой прохода (`RunError`, код 1) считаются только сбои состояния.
- **Без `unwrap()` в рабочем коде**: включён lint `clippy::unwrap_used`, в тестах разрешён (`clippy.toml`). Отравленный мьютекс обрабатывается явно: `lock().unwrap_or_else(PoisonError::into_inner)` (`src/adapters/configmap.rs`).

### 1.3 `Option` и комбинаторы

- `?` работает и с `Option`: `let since = ready.and_then(|c| c.last_transition).or(pod.created)?;` (`src/checks/pods.rs`) — «время перехода, иначе время создания, иначе находки нет».
- `bool::then`: `(age > NOT_READY_AFTER_SECS).then(|| Finding::new(...))` — `Some(...)` только если условие истинно.
- `is_some_and`, `map_or`, `unwrap_or_default`, `filter`, `find_map`: `APP_LABELS.iter().find_map(|label| non_empty(pod.labels.get(*label))).unwrap_or(&pod.name)` — цепочка «метка app, иначе ..., иначе имя пода» одной строкой.
- `let ... else` для раннего выхода: `let Some(cluster) = cluster else { return vec![...] };` (`src/checks/postgres.rs`), `let Ok(alerts) = alerts else { ... }` (`src/checks/prometheus.rs`), `let (Some(token), Some(chat_id)) = (token, chat_id) else { return Err(...) };` (`src/config.rs`).

### 1.4 Трейты как порты, generics и `dyn`

- **Порты** — трейты в `src/ports.rs`: `ClusterSource`, `Prober`, `AlertsSource`, `DiskStat`, `StateStore`, `Notifier`, `Clock`. Адаптеры их реализуют (`impl ClusterSource for KubeCluster`), тесты — фейки (`tests/common/mod.rs`).
- **`dyn` там, где выбор делается в рантайме.** `run::Deps` хранит `Arc<dyn Notifier>` и т. д. Telegram или stdout решает конфигурация (`adapters::notifier_for` в `src/adapters/mod.rs`) — статически (generic-параметром) такой выбор не выразить без enum-обёртки. Цена `dyn` — косвенный вызов и `Box` для future, для сетевого кода незаметна.
- **Generics там, где тип известен при компиляции.** `StdoutNotifier<W: Write + Send>` (`src/adapters/stdout.rs`) пишет в `Stdout` в проде и в `Vec<u8>` в тестах — статическая диспетчеризация, ноль накладных расходов. Ещё: `bounded<T>(deadline, source: impl Future<Output = Result<T, SourceError>>)` (`src/run.rs`), `decode_all<S: DeserializeOwned + Default, T>` (`src/adapters/cluster.rs`), `Finding::new(key: impl Into<String>, ...)` (`src/domain.rs`).
- **`#[async_trait]`.** `async fn` в трейтах есть в стабильном Rust, но такой трейт не dyn-совместим: на Rust 1.99 `&dyn Port` с `async fn` даёт `error[E0038]: the trait Port is not dyn compatible`. `async_trait` переписывает метод в `fn ... -> Pin<Box<dyn Future + Send>>`, и трейт снова годится для `dyn`.

### 1.5 async/await и tokio

- **Future ленивые.** В отличие от `Promise`, future ничего не делает, пока его не опрашивают (`.await`, `join!`, `spawn`). Поэтому `cluster.pods()` можно передать в `bounded(...)` как значение, и запрос начнётся только внутри `join!`.
- **`tokio::join!`** (`run::gather`): девять источников опрашиваются одновременно, результаты приходят кортежем в фиксированном порядке — правило «первая находка с ключом побеждает» остаётся детерминированным.
- **`JoinSet`** (`run::probe_all`): динамическое число HTTP-проверок отдельными задачами; `join_next()` отдаёт их по мере готовности, порядок восстанавливается по индексу. Паника в задаче превращается в `JoinError`, проверка считается «no response».
- **Дедлайн** — `tokio::time::timeout_at(deadline, future)`: один `Instant` на проход, каждый источник отменяется по нему.
- **Отмена = drop.** `tokio::select!` в `src/main.rs` ждёт проход или SIGTERM/SIGINT; проигравший future уничтожается, а с ним — незавершённые запросы и задачи `JoinSet`. Состояние пишется одним запросом в самом конце, поэтому «записать наполовину» нельзя.
- **`spawn_blocking`** для системного вызова `statvfs` (`src/adapters/disk.rs`): блокирующий код не занимает поток рантайма.
- **`flavor = "current_thread"`** (`src/main.rs`): проход почти всё время ждёт сеть, одного потока достаточно; конкурентность от этого не страдает.

### 1.6 `Send` и `Sync`

- Трейты портов объявлены как `trait ClusterSource: Send + Sync` — объект за `Arc` используют несколько задач, а `async_trait` по умолчанию требует `Send`-future.
- `ConfigMapStore` помнит `resourceVersion` между `load` и `save`, хотя методы берут `&self`: поле `Mutex<Option<String>>` даёт изменяемость через общую ссылку и делает тип `Sync`. Здесь `std::sync::Mutex`, а не `tokio::sync::Mutex`: блокировка никогда не держится через `.await`.
- `type BoxError = Box<dyn Error + Send + Sync + 'static>` (`src/ports.rs`) — ошибка, которую можно вернуть из задачи в другой поток.
- Компилятор проверяет это сам: попытка положить в `JoinSet` future с не-`Send` данными (например, `Rc`) не скомпилируется.

### 1.7 serde derive

- `#[derive(Serialize, Deserialize)]` + `#[serde(rename_all = "camelCase")]`: `digest_day` в коде, `digestDay` в JSON (`src/state.rs`).
- Формат отделён от модели: `DocumentRef<'a>` сериализует состояние по ссылкам (без копий), `Document` десериализует; версия проверяется отдельной маленькой структурой `Versioned` до разбора тела.
- Частичные структуры для чужих форматов: из CRD читаются только нужные поля статуса (`CertificateStatus`, `BackupStatus` в `src/adapters/cluster.rs`, `#[serde(rename = "type")]`), из ответа Prometheus — `labels`, `annotations`, `state`. Неизвестные поля игнорируются, `#[serde(default)]` закрывает отсутствующие.
- `chrono` с feature `serde` разбирает RFC 3339 в `DateTime<Utc>` прямо при десериализации.

### 1.8 Newtype и типы, которые исключают ошибки

- `config::Secret(String)` (`src/config.rs`): `Debug` печатает `Secret(***)`, `Display` нет вовсе, поэтому токен нельзя случайно вставить в `format!` или лог. Сырое значение — только через явный `expose()`, вызывается в одном месте (URL Telegram). Ошибки `reqwest` очищаются от URL (`without_url`) и несут замаскированный адрес (`src/adapters/telegram.rs`).
- `config::Delivery` — enum `DryRun | Telegram(TelegramConfig)` вместо `dry_run: bool` + `Option<token>`: состояние «отправлять в Telegram без токена» непредставимо.
- `alerting::MessageKind`, `run::StateWrite` — перечисления вместо строк и флагов; `#[must_use]` на `Plan` предупреждает, если план построили и забыли применить.

### 1.9 Итераторы вместо циклов

- Конвейер `filter → filter → filter_map → collect` в `pods::evaluate`; `flat_map` с `move`-замыканием для «узел × условие» в `nodes::evaluate`.
- Уникальные отсортированные значения — через `BTreeSet` (`prometheus::scope`), аналог `jq 'unique | join("/")'`.
- Дедупликация без копирования ключей: стабильная сортировка + `dedup_by` (`checks::dedup`).
- Сборка текста свёрткой: `lines.fold(header.to_owned(), |mut text, line| { ... })` (`alerting::bulleted`).
- Цикл `for` оставлен там, где он яснее: последовательная отправка сообщений с `.await` и побочными эффектами в `run_once`.

### 1.10 Сопоставление с образцом

- `match` с охранными условиями: `alerting::grace_secs` (`"prom:api" => 900, k if k.starts_with("argo:") => 900, ...`).
- Связывание с условием: `match find_condition(...) { Some(ready) if ready.is_true() => {}, ready => return ... }` (`src/checks/certificates.rs`).
- Литералы внутри `Result`: `match &result.status { Ok(200) => return None, Ok(code) => ..., Err(_) => ... }` (`src/checks/http.rs`).
- `matches!(err, KubeError::Api(status) if status.is_conflict() || ...)` (`src/adapters/configmap.rs`).
- Деструктуризация структуры: `let Self { mut undelivered, problem_keys, .. } = self;` (`Plan::apply`).

### 1.11 Модули, видимость, линты

- Юнит-тесты лежат рядом с кодом в `#[cfg(test)] mod tests` и видят приватные функции; интеграционные тесты в `tests/` видят только публичный API библиотеки, как внешний пользователь.
- `pub(crate)` — видно во всём crate, но не снаружи (`domain::non_empty`).
- `#![forbid(unsafe_code)]` в `src/lib.rs` и `src/main.rs` плюс `unsafe_code = "forbid"` в `[lints.rust]`; небезопасный системный вызов спрятан внутри `nix`.
- `clippy::pedantic` включён целиком; исключения перечислены с причинами в `Cargo.toml`, точечные `#[allow]` — с комментарием (`useless_conversion` в `src/adapters/disk.rs`: на macOS счётчики блоков 32-битные).

## 2. Почему эти crate

| Crate | Для чего | Почему он |
|---|---|---|
| `tokio` | async-рантайм, таймеры, сигналы, задачи | стандарт де-факто; `kube`, `reqwest`, `wiremock` построены на нём |
| `kube` + `k8s-openapi` | клиент Kubernetes | основной клиент экосистемы (CNCF); типизированный API для `Pod`/`Node`, `DynamicObject` + `ApiResource` для CRD — без генерации типов CRD ради трёх полей статуса |
| `reqwest` (`rustls-no-provider`) | HTTP-проверки, Prometheus, Telegram | самый распространённый HTTP-клиент; rustls вместо OpenSSL — нет системных TLS-библиотек в образе, корни доверия берутся из ОС (`rustls-platform-verifier`) |
| `rustls` (feature `ring`) | крипто-провайдер TLS | `kube` уже использует `ring`; явная установка одного провайдера (`adapters::http::install_crypto_provider`) избавляет от второго бэкенда (`aws-lc`) и C-сборки |
| `serde`, `serde_json` | JSON состояния, CRD, Prometheus, Telegram | стандарт сериализации в Rust |
| `tracing`, `tracing-subscriber` | структурные логи JSON, `EnvFilter` | стандарт для async-кода; поля событий типизированы, уровень настраивается директивами |
| `clap` (derive, env) | флаги и переменные окружения | одно описание даёт разбор, `--help`, `--version` и чтение env |
| `humantime` | разбор длительностей `120s`, `1m30s` | формат из спецификации, маленькая проверенная библиотека |
| `thiserror` / `anyhow` | ошибки | типизированные enum в библиотеке / контекст и цепочка в `main` — общепринятое разделение |
| `async-trait` | async-методы в dyn-трейтах | нативные `async fn` в трейтах пока не dyn-совместимы |
| `chrono` | время, `DateTime<Utc>` | требование спецификации; `k8s-openapi` 0.28 перешёл на `jiff`, поэтому на границе адаптера есть конвертация `to_chrono` |
| `nix` | `statvfs` | безопасная обёртка над libc, в нашем коде нет `unsafe` |
| `url` | разбор и проверка URL | тот же тип, что у `reqwest` |
| dev: `wiremock` | HTTP-заглушки | заглушки проверок, Prometheus, Telegram и даже Kubernetes API-сервера для тестов адаптеров |
| dev: `rstest` | табличные тесты | `#[case]` — каждая строка таблицы отдельным тестом с именем |
| сборка: `cargo-chef`, distroless, `cargo-llvm-cov` | кеш зависимостей в Docker, минимальный образ, покрытие | общепринятые инструменты для Rust-сервисов |

## 3. Соответствия NestJS

| NestJS | Здесь | Где |
|---|---|---|
| модули и DI-провайдеры (`@Module`, `@Injectable`, `useClass`/`useFactory`) | трейты-порты + внедрение через конструктор в composition root | `src/ports.rs`, `run::Deps`, `src/main.rs` |
| интерфейс сервиса | трейт | `src/ports.rs` |
| синглтон-провайдер | `Arc<dyn Trait>`, один экземпляр на процесс | `run::Deps` |
| `@nestjs/config` + Zod-схема | `clap` (env) + `TryFrom<Cli> for Config` | `src/config.rs` |
| `ConfigService.get('X')` | поле типизированной структуры `config.http_timeout` | `src/config.rs` |
| pino / Nest `Logger` | `tracing` + JSON-форматтер | `src/telemetry.rs` |
| `HttpService` / `fetch` | `reqwest::Client` с таймаутом на запрос | `src/adapters/http.rs` |
| DTO + class-transformer | структуры с `#[derive(Deserialize)]` | `src/adapters/prometheus.rs` |
| `Promise.all` | `tokio::join!` (фиксированный набор), `JoinSet` (динамический) | `run::gather`, `run::probe_all` |
| `AbortSignal.timeout` / `Promise.race` | `tokio::time::timeout_at`, `tokio::select!` | `src/run.rs`, `src/main.rs` |
| исключения и exception filters | `Result` + enum ошибок; «фильтр» — `match` в `main`, превращающий ошибку в код выхода | `src/ports.rs`, `src/main.rs` |
| `enableShutdownHooks` / `OnApplicationShutdown` | `tokio::signal::unix` + `select!` | `src/main.rs` |
| Jest/Vitest + `Test.createTestingModule` с `useValue` | `cargo test` + in-memory фейки портов | `tests/common/mod.rs`, `tests/run.rs` |
| nock / msw | `wiremock` | `tests/run.rs`, тесты адаптеров |
| `it.each` | `rstest` `#[case]` | `src/checks/*.rs` |
| `@nestjs/schedule` (`@Cron`) | Kubernetes CronJob: процесс живёт один проход | `deploy/cronjob.yaml` |

### Рядом: NestJS и Rust

**1. DI: выбор реализации по конфигурации.**

```ts
// NestJS
@Module({
  providers: [
    { provide: NOTIFIER, inject: [ConfigService],
      useFactory: (c: ConfigService) =>
        c.get('DRY_RUN') ? new StdoutNotifier() : new TelegramNotifier(c.get('TELEGRAM_BOT_TOKEN')) },
    WatchdogService, // constructor(@Inject(NOTIFIER) private notifier: Notifier)
  ],
})
export class WatchdogModule {}
```

```rust
// src/adapters/mod.rs + src/main.rs
pub fn notifier_for(delivery: &Delivery, client: reqwest::Client) -> Arc<dyn Notifier> {
    match delivery {
        Delivery::DryRun => Arc::new(stdout::StdoutNotifier::stdout()),
        Delivery::Telegram(config) => Arc::new(telegram::TelegramNotifier::new(client, config.clone())),
    }
}
let deps = Deps { notifier: adapters::notifier_for(&config.delivery, http), /* ... */ };
```

Контейнера нет: «модуль» — это функция `main`, которая явно собирает граф. Ошибку связывания (забыли провайдер) ловит компилятор: структуру `Deps` нельзя создать без всех полей.

**2. Конфигурация: схема и валидация.**

```ts
// NestJS + Zod
const Env = z.object({
  DRY_RUN: z.coerce.boolean().default(false),
  RUN_TIMEOUT: z.string().default('120s').transform(ms),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
}).refine(e => e.DRY_RUN || e.TELEGRAM_BOT_TOKEN, 'token required unless DRY_RUN');
```

```rust
// src/config.rs
#[derive(Parser)]
pub struct Cli {
    #[arg(long, env = "DRY_RUN", default_value = "false",
          value_parser = BoolishValueParser::new(), action = clap::ArgAction::Set)]
    pub dry_run: bool,
    #[arg(long, env = "RUN_TIMEOUT", default_value = "120s")]
    pub run_timeout: String,
    #[arg(long, env = "TELEGRAM_BOT_TOKEN", hide_env_values = true)]
    pub telegram_bot_token: Option<Secret>,
}
impl TryFrom<Cli> for Config { /* MissingTelegram, Duration { var, .. }, ... */ }
```

`clap` собирает сырые значения (как `process.env` + дефолты), `TryFrom` — схема: типы, межполевые правила, понятные ошибки с именем переменной. Результат — `Config`, где невалидное состояние непредставимо (`Delivery`).

**3. `Promise.all` с таймаутом и отмена.**

```ts
// NestJS
const signal = AbortSignal.timeout(runTimeoutMs);
const [pods, nodes, alerts] = await Promise.all([
  k8s.listPods({ signal }).catch(e => e),
  k8s.listNodes({ signal }).catch(e => e),
  prom.alerts({ signal }).catch(e => e),
]);
```

```rust
// src/run.rs
let (pods, nodes, /* ... */ alerts) = tokio::join!(
    bounded(deadline, cluster.pods()),
    bounded(deadline, cluster.nodes()),
    /* ... */
    bounded(deadline, deps.alerts.alerts()),
);
async fn bounded<T>(deadline: Instant, source: impl Future<Output = Result<T, SourceError>>)
    -> Result<T, SourceError> {
    timeout_at(deadline, source).await.unwrap_or(Err(SourceError::Deadline))
}
```

`.catch(e => e)` не нужен: ошибка — уже значение `Result`, `join!` не «падает» от одной ошибки. Отмена не требует передавать `signal` в каждую функцию: по таймауту future просто уничтожается.

**4. Тест с подменой зависимостей.**

```ts
// Jest
const module = await Test.createTestingModule({
  providers: [WatchdogService,
    { provide: STATE_STORE, useValue: new InMemoryStore() },
    { provide: CLUSTER, useValue: fakeCluster }],
}).compile();
nock('https://api.telegram.org').post(/sendMessage/).reply(200, { ok: true });
await module.get(WatchdogService).runOnce();
```

```rust
// tests/run.rs
let world = World::new(cluster, FakeStore::empty(), utc(8, 0)).await; // fakes + wiremock
world.serve(queue_alert(), 200).await;                               // Prometheus, probes, Telegram
let summary = world.pass().await.expect("pass");                       // run_once(&deps, &settings)
assert_eq!(summary.delivered, [MessageKind::Greeting, MessageKind::Problem, MessageKind::Digest]);
```

Фейки реализуют те же трейты, что и адаптеры, поэтому тест гоняет настоящий `run_once`; HTTP-адаптеры настоящие и ходят в `wiremock`.
