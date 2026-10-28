# Заметки: Go на примере watchdog

Учебный разбор. Спецификация — [`../SPEC.md`](../SPEC.md), как собрать и запустить — [`README.md`](README.md). Пути ниже — относительно `go/`.

## С чего читать

1. `cmd/watchdog/main.go` — сборка программы: конфигурация, адаптеры, проход, код выхода.
2. `internal/runner/runner.go` — один проход: параллельные проверки, план, доставка, сохранение.
3. `internal/checks/*.go` — правила проверок, чистые функции.
4. `internal/alerting/alerting.go` — машина состояний оповещений: `Plan` и `Apply`.
5. `internal/ports/ports.go` — интерфейсы между ядром и внешним миром.
6. `internal/adapters/*` — реализации портов: Kubernetes, HTTP, Prometheus, statfs, Telegram, stdout.
7. Тесты рядом с кодом (`*_test.go`); интеграционный тест всего прохода — `cmd/watchdog/main_test.go`.

## Идиомы Go в этом коде

### Интерфейсы реализуются неявно

В Go нет `implements`: тип подходит под интерфейс, если у него есть нужные методы. Порты объявлены в `internal/ports/ports.go`, а адаптеры о них могут даже не знать — `telegram.Client` подходит под `ports.Notifier` просто потому, что у него есть `Send(ctx, text) error`. Фейки в `internal/runner/runner_test.go` (`fakeCluster`, `memStore`, `recorder`) подходят под те же интерфейсы так же.

Чтобы ошибка «адаптер перестал подходить под порт» ловилась при компиляции пакета, а не в `main`, в каждом адаптере есть строка-проверка:

```go
var _ ports.Notifier = (*Client)(nil) // internal/adapters/telegram/telegram.go
```

Правило «принимай интерфейсы, возвращай структуры»: конструкторы возвращают конкретные типы (`kube.NewCluster` → `*Cluster`), а потребитель (`runner.Deps`) хранит интерфейсы. Интерфейсы маленькие: `ports.Prober` — один метод. Kubernetes-адаптер просит не весь clientset (`kubernetes.Interface`, десятки групп API), а только `typedcorev1.CoreV1Interface` (`internal/adapters/kube/cluster.go`) — зависимость ровно от того, что используется, и тест передаёт `fake.NewClientset().CoreV1()`.

### Внедрение зависимостей — обычные конструкторы

DI-контейнера нет. `main` создаёт адаптеры и передаёт их в `runner.New(cfg, runner.Deps{...})` (`cmd/watchdog/main.go`, функция `run`). Это и есть composition root: только он знает, какие реализации используются; `DRY_RUN` — это просто `console.New(stdout)` вместо `telegram.New(...)`.

`main()` сам по себе тестировать неудобно (`os.Exit`, глобальное окружение), поэтому вся логика — в `run(ctx, environ, stdout, stderr, platform) int`, а внешний мир (клиент Kubernetes, диск, часы) приходит через структуру `platform`. Тест подставляет фейки и проверяет код выхода и вывод (`cmd/watchdog/main_test.go`). `os.Exit` вызывается один раз в `main()` после `stop()`, потому что `os.Exit` не выполняет `defer`.

### context: отмена и дедлайны

`context.Context` — первый параметр каждой функции, которая ходит в сеть, и он передаётся дальше вниз:

- `signal.NotifyContext(..., os.Interrupt, syscall.SIGTERM)` в `main.go` превращает SIGTERM в отмену контекста;
- `context.WithTimeout(ctx, cfg.RunTimeout)` — общий дедлайн прохода;
- в `runner.collect` проверки получают свой дедлайн — 3/4 прохода (`ChecksTimeout`), чтобы зависший источник стал «упавшей проверкой» и осталось время отправить и сохранить;
- каждый HTTP-запрос дополнительно ограничен своим таймаутом (`httpprobe.Prober.Probe`, `promalerts.Source.Alerts`, `telegram.Client.Send`): `ctx, cancel := context.WithTimeout(ctx, p.timeout); defer cancel()`;
- `context.Cause(ctx)` отличает SIGTERM (`context.Canceled`) от дедлайна (`context.DeadlineExceeded`);
- сохранение состояния — `context.WithoutCancel(ctx)` плюс собственный таймаут (`runner.Run`): если сообщения уже ушли, записать это важнее, чем послушно отменить запись, иначе следующий проход их повторит.

Линтер `contextcheck` следит, чтобы контекст не терялся по дороге.

### errgroup, горутины и WaitGroup

`runner.collect` запускает девять проверок через `errgroup.WithContext`. Горутина возвращает ошибку только когда отменён весь проход — тогда errgroup отменяет общий контекст, остальные проверки останавливаются, а `g.Wait()` возвращает первую ошибку. Сбой отдельного источника — не ошибка группы: он превращается в находку (`kube:pods`, `prom:api`, `pg:cluster`) или в предупреждение в логе.

Каналов и мьютексов в ядре нет: каждая горутина пишет только в своё поле структуры `collected`, а `g.Wait()` даёт гарантию happens-before — после него главная горутина видит все записи. Порядок находок фиксирован (`collected.findings()` склеивает поля в порядке проверок), поэтому «первая из дубликатов» не зависит от того, какая горутина закончила раньше.

HTTP-проверки внутри — `sync.WaitGroup.Go` (Go 1.25+), потому что им нечего возвращать: результат каждой пишется в свой элемент слайса `results[i]`. С Go 1.22 переменная цикла своя на каждой итерации, поэтому замыкание `func() { ... p ... i ... }` внутри `for i, p := range` безопасно.

Каналы есть в тестах: барьеры в `TestChecksRunConcurrently` и `TestProbesRunConcurrently` доказывают параллельность без `time.Sleep` — каждый вызов ждёт, пока стартуют все остальные; при последовательном запуске тест упёрся бы в дедлайн.

`go test -race` (детектор гонок) прогоняется в `make test`.

### Ошибки — это значения

Исключений нет: функция возвращает `error`, вызывающий проверяет `if err != nil`.

- Обёртка с контекстом: `fmt.Errorf("list pods: %w", err)` (`internal/adapters/kube/cluster.go`). `%w` сохраняет исходную ошибку внутри.
- Sentinel-ошибки: `ports.ErrNotFound`, `ports.ErrCorruptState`, `domain.ErrStateVersion`, `runner.ErrInterrupted`. Проверка — `errors.Is(err, ports.ErrCorruptState)` (`runner.Run`), сквозь любое число обёрток.
- Два `%w` в одной ошибке (Go 1.20+): `fmt.Errorf("configmap %s/%s: %w: %w", ns, name, ports.ErrCorruptState, err)` в `internal/adapters/kube/store.go` — вызывающий найдёт и «состояние нечитаемо», и исходную причину.
- Свой тип ошибки и `errors.As`: `telegram.APIError` с кодом HTTP; тест достаёт его через `require.ErrorAs`. В `telegram.Client.redact` `errors.As(err, &ue)` находит `*url.Error`, в тексте которого `net/http` печатает URL с токеном, и заменяет URL на замаскированный, сохраняя причину — `errors.Is(err, context.DeadlineExceeded)` продолжает работать.
- `errors.Join` собирает все ошибки конфигурации в одну (`config.validate`), чтобы человек увидел все проблемы сразу.
- Ошибки client-go проверяются функциями `apierrors.IsNotFound/IsConflict/IsAlreadyExists`, они тоже понимают обёртки.

Линтер `errorlint` запрещает `err == ErrX` и `%v` вместо `%w`.

### Табличные тесты

Стандартная форма теста в Go — таблица случаев и цикл с `t.Run`:

```go
tests := []struct{ name string; pod domain.Pod; want []domain.Finding }{
	{name: "not ready exactly 600 s", pod: pod(notReadyFor(600 * time.Second))},
	{name: "not ready 601 s", pod: pod(notReadyFor(601 * time.Second)), want: ...},
}
for _, tt := range tests {
	t.Run(tt.name, func(t *testing.T) { t.Parallel(); assert.Equal(t, tt.want, checks.Pods(...)) })
}
```

Так проверены все границы спецификации: 600 с, 900 с, 14 дней, 26 ч, 80 % (`internal/checks/*_test.go`), грация 239/240 с и 899/900 с, напоминание ровно через 6 ч (`internal/alerting/alerting_test.go`). Внешние тесты (`package checks_test`) видят только экспортированное API, как настоящий пользователь пакета; внутренний `internal/checks/internal_test.go` (`package checks`) проверяет приватный `floorDiv`. `t.Context()` (Go 1.24) — контекст, который отменяется в конце теста; `t.Helper()` — чтобы ошибка указывала на строку теста, а не хелпера.

### Фейки вместо моков

Моков с ожиданиями вызовов (`gomock`, `mockery`) здесь нет — это осознанно:

- порты маленькие, ручной фейк — несколько строк (`internal/runner/runner_test.go`), и тест проверяет результат (что отправлено, что сохранено), а не последовательность вызовов;
- для Kubernetes есть официальные фейки client-go: `fake.NewClientset(objects...)` и `dynamicfake.NewSimpleDynamicClientWithCustomListKinds`. Сбои (`Forbidden`, `Conflict`) подмешиваются реакторами: `core.PrependReactor("update", "configmaps", ...)` (`internal/adapters/kube/store_test.go`);
- HTTP-зависимости — настоящие серверы `httptest.NewServer` на loopback: Prometheus, проверяемые сайты, Telegram Bot API. Адаптеры работают по-настоящему, через сеть внутри процесса.

### Struct tags

Метаданные полей в обратных кавычках читаются через reflection:

- `env:"RUN_TIMEOUT" envDefault:"120s"` — caarlos0/env заполняет конфигурацию из окружения (`internal/config/config.go`);
- `json:"digestDay,omitempty"` — формат состояния (`internal/domain/state.go`);
- `json:"notAfter,omitempty"` в маленьких структурах CRD (`internal/adapters/kube/objects.go`) — `runtime.DefaultUnstructuredConverter` раскладывает `map[string]any` динамического клиента по полям, лишние поля игнорируются.

### Нулевые значения

Любая переменная в Go инициализирована нулём своего типа, и код этим пользуется: `time.Time{}` означает «не сообщалось» (`domain.Certificate.NotAfter`, проверка `IsZero()`), `var sum Summary` готов к работе, `sync.Mutex` не нужно создавать, `append` в `nil`-слайс работает, чтение из `nil`-map возвращает ноль. Для «значение или неизвестно» в фактах сводки — указатель: `*int`, `nil` печатается как `?` (`domain.Facts`, `alerting.orUnknown`).

### Дженерики

- `domain.Ptr[T any](v T) *T` — указатель на значение одной строкой;
- `kube.listAll[T]` — один цикл постраничного чтения (`limit` + `continue`) для подов, узлов и CRD; `kube.listCustom[T]` и `decodeItems[T]` — чтение CRD в типизированную структуру;
- из библиотек: `env.ParseAsWithOptions[Config]`, `reflect.TypeFor[Config]()`.

### Прочее

- Итераторы (Go 1.23): `slices.Sorted(maps.Keys(old.Entries))` в `alerting.Plan`; `strings.SplitSeq` в тестах; `for i := range n` (Go 1.22).
- Value- и pointer-receivers: методы `config.Secret` (`String`, `LogValue`, `MarshalText`) на значении, чтобы маскирование работало и для копий; `UnmarshalText` — на указателе, потому что меняет значение.
- `slog.LogValuer`: `Config.LogValue()` и `Secret.LogValue()` — объект сам решает, как он выглядит в логе; токен везде `***`. Логи client-go (klog) перенаправлены в тот же JSON-поток: `klog.SetSlogLogger`.
- Functional options: `telegram.New(url, token, chat, telegram.WithTimeout(...), telegram.WithUserAgent(...))`.
- Build constraints: `internal/adapters/disk/statfs_posix.go` (`//go:build linux || darwin`) и `statfs_other.go` (`errors.ErrUnsupported`) — код компилируется и на Windows. Имя файла не может кончаться на `_linux_darwin.go`: суффикс `_darwin` Go сам считает ограничением.
- `internal/` — пакеты, которые нельзя импортировать извне модуля.
- Версия вшивается при сборке: `-ldflags "-X main.version=..."` (`Makefile`, `Dockerfile`).
- `defer func() { _ = resp.Body.Close() }()` и вычитывание тела (`io.Copy(io.Discard, ...)`) — соединение возвращается в пул; линтер `bodyclose` следит за этим.

## Почему эти библиотеки

| Библиотека | Зачем | Почему она |
|---|---|---|
| `k8s.io/client-go` v0.37.1 | Kubernetes API | официальный клиент; typed — для подов, узлов и ConfigMap, `dynamic` — для CRD cert-manager, CNPG и Argo CD без импорта их Go-модулей; `fake` — тесты без кластера |
| `golang.org/x/sync/errgroup` v0.24.0 | параллельные проверки | стандарт де-факто: WaitGroup + первая ошибка + отмена контекста |
| `github.com/caarlos0/env/v11` v11.4.1 | конфигурация | struct tags, значения по умолчанию, `TextUnmarshaler`, разбор из переданной map (тесты без `os.Setenv`); без зависимостей |
| `github.com/prometheus/client_golang` v1.25.0 (`api`, `api/prometheus/v1`) | алерты Prometheus | официальный клиент, типы `v1.Alert` |
| `golang.org/x/sys/unix` v0.49.0 | `statfs` | системный вызов без cgo; пакет `syscall` заморожен |
| `log/slog` (stdlib) | JSON-логи | в стандартной библиотеке с Go 1.21; `LogValuer` для маскирования |
| `net/http` (stdlib) | проверки, Telegram | достаточно; контекст на каждый запрос, `CheckRedirect` чтобы не ходить по редиректам |
| `github.com/stretchr/testify` v1.12.1 | ассерты | самая распространённая; `require` останавливает тест, `assert` — нет |
| `golangci-lint` v2.14.0 | линтеры | один запуск десятков анализаторов, конфиг в репозитории (`.golangci.yml`) |

Telegram-клиента из сторонних библиотек нет: нужен один вызов `sendMessage`, и полный контроль над ошибками важен из-за токена в URL.

## Соответствие NestJS

| NestJS / Node.js | Здесь (Go) |
|---|---|
| Модули и DI-провайдеры (`@Module`, `@Injectable`, `providers`) | пакеты `internal/...` и внедрение через конструкторы в `main` (`runner.New(cfg, runner.Deps{...})`) |
| Интерфейс + токен провайдера (`{ provide: NOTIFIER, useClass: ... }`) | порт в `internal/ports`, реализация выбирается в `main` (`console` или `telegram`) |
| `@nestjs/config` + Zod-схема | `caarlos0/env` (struct tags) + `config.validate()`; ошибки — `errors.Join` |
| pino / Nest `Logger` | `log/slog` с `JSONHandler`; редактирование секретов — `slog.LogValuer` (в pino — `redact`) |
| `HttpService` / `fetch` + `AbortController` | `net/http` + `http.NewRequestWithContext(ctx, ...)` |
| `Promise.all` / `Promise.allSettled` | `errgroup.Group` (ошибка отменяет остальных) / горутины, которые сами обрабатывают свою ошибку |
| `AbortSignal.timeout(ms)` | `context.WithTimeout(ctx, d)` |
| Исключения, `try/catch`, exception filters | значения `error`, `if err != nil`, обёртки `%w`, `errors.Is/As`; «фильтр» — `run()` в `main.go`, который превращает ошибку в код выхода |
| Классы ошибок (`class NotFoundError extends Error`) | sentinel-ошибки (`var ErrNotFound = errors.New(...)`) и типы ошибок (`type APIError struct`) |
| Jest/Vitest + `Test.createTestingModule` + `overrideProvider` | `go test` + ручные фейки, переданные в конструктор; `httptest` вместо `nock`/`msw` |
| `jest.useFakeTimers()` | порт `Clock` и `clock.Fixed` |
| `@nestjs/schedule` (`@Cron('*/5 * * * *')`) | Kubernetes CronJob (`deploy/cronjob.yaml`): процесс делает один проход и завершается |
| `process.on('SIGTERM')` + `enableShutdownHooks()` | `signal.NotifyContext` → отмена контекста |
| `process.exit(code)` | `os.Exit(code)` один раз в `main()` |
| `package.json` + lock-файл | `go.mod` + `go.sum` |
| ESLint + Prettier | golangci-lint + gofmt/goimports |
| `npm run build` → `dist/` + `node_modules` в образе | один статический бинарник в distroless (~10 MB сжатый образ) |

## Рядом: NestJS и Go

### 1. Сборка зависимостей

```ts
// NestJS: контейнер собирает граф по декораторам
@Module({
  providers: [
    RunnerService,
    { provide: NOTIFIER, useFactory: (cfg: ConfigService) =>
        cfg.get('DRY_RUN') ? new ConsoleNotifier() : new TelegramNotifier(cfg), inject: [ConfigService] },
  ],
})
export class WatchdogModule {}
```

```go
// Go: граф собирается руками в main (cmd/watchdog/main.go)
var notifier ports.Notifier
if cfg.DryRun {
	notifier = console.New(stdout)
} else {
	notifier = telegram.New(cfg.TelegramAPIURL, cfg.TelegramBotToken.Reveal(), cfg.TelegramChatID)
}
r := runner.New(runnerCfg, runner.Deps{Notifier: notifier, Store: kube.NewStateStore(core, ns, name) /* ... */})
```

Всё видно в одном месте, ошибки связывания — ошибки компиляции, никакой магии на старте.

### 2. Конфигурация

```ts
// NestJS + Zod
const schema = z.object({
  RUN_TIMEOUT: z.string().default('120s').transform(parseDuration),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  DRY_RUN: z.coerce.boolean().default(false),
}).refine(c => c.DRY_RUN || c.TELEGRAM_BOT_TOKEN, 'TELEGRAM_BOT_TOKEN is required unless DRY_RUN=true');
```

```go
// Go: internal/config/config.go
type Config struct {
	RunTimeout       time.Duration `env:"RUN_TIMEOUT" envDefault:"120s"`
	TelegramBotToken Secret        `env:"TELEGRAM_BOT_TOKEN"`
	DryRun           bool          `env:"DRY_RUN" envDefault:"false"`
}

cfg, err := env.ParseAsWithOptions[Config](env.Options{Environment: environ})
// ... затем cfg.validate(): правила между полями, все ошибки через errors.Join
```

Типы (`time.Duration`, `slog.Level`, `[]Probe`) разбираются сами — через `encoding.TextUnmarshaler`.

### 3. Параллельные проверки

```ts
// NestJS: allSettled, чтобы одна упавшая проверка не роняла остальные
const results = await Promise.allSettled([
  this.checkPods(signal), this.checkNodes(signal), this.checkHttp(signal),
]);
```

```go
// Go: internal/runner/runner.go, collect
g, gctx := errgroup.WithContext(checksCtx)
start := func(name string, check func(context.Context) error) {
	g.Go(func() error {
		err := check(gctx)
		if err == nil {
			return nil
		}
		if stop := interrupted(); stop != nil {
			return stop // отменили весь проход: errgroup отменит остальных
		}
		r.log.WarnContext(gctx, "check source failed", "check", name, "error", err)
		return nil // сбой источника — находка или предупреждение, не ошибка группы
	})
}
start("pods", func(ctx context.Context) error { return r.checkPods(ctx, now, &c) })
// ...
err := g.Wait()
```

Разница с `Promise.all`: в Node.js отмена — отдельный `AbortController`, который нужно передать в каждый вызов; в Go контекст и есть механизм отмены, и `errgroup.WithContext` отменяет его сам при первой ошибке.

### 4. Ошибки вместо исключений

```ts
// NestJS
try {
  state = await this.store.load();
} catch (e) {
  if (e instanceof CorruptStateError) { this.logger.warn('...'); state = null; }
  else throw e; // поймает фильтр исключений
}
```

```go
// Go: internal/runner/runner.go
stored, found, err := r.deps.Store.Load(ctx)
if errors.Is(err, ports.ErrCorruptState) {
	r.log.WarnContext(ctx, "stored state is unreadable, treating this pass as the first run", "error", err)
	found, err = false, nil
}
if err != nil {
	return done(fmt.Errorf("load state: %w", err)) // main превратит это в код выхода 1
}
```

Путь ошибки виден в сигнатуре (`(domain.State, bool, error)`), пропустить её молча не даёт линтер `errcheck`.

## Решения там, где спецификация молчит

- Формат состояния: `{"version":1,"digestDay":"YYYYMMDD","entries":{"<key>":{"since":…,"notified":…,"message":"…"}}}`; ключи map сортируются при кодировании, вывод стабилен.
- Не доставленное «восстановлено» не стирает записи: они остаются в состоянии, и следующий проход сообщит о восстановлении снова (продолжение правила «если Telegram не принял — повторить»). Приветствие не повторяется: после прохода состояние уже существует.
- Строки сообщений отсортированы по ключу (как `sort` в скрипте); дубликаты ключей — первый в фиксированном порядке проверок.
- Кластер PG, который не удалось прочитать по другой причине, чем «не найден», сообщается как `pg:cluster` «missing» (как в скрипте), причина — в логе. Отсутствующее условие кластера находкой не считается (как в скрипте).
- Готовый сертификат без `notAfter` считается истекающим от 1970-01-01 (как значение по умолчанию `"1970-01-01T00:00:00Z"` в jq скрипта).
- Пустые значения меток, `severity`, `summary` считаются отсутствующими; `prom:api` — точное совпадение ключа, не префикс (как `case` в скрипте).
- HTTP-проверка не следует редиректам (как `curl` без `-L`); нет ответа — «no response», как в спецификации (скрипт печатал `000`).
- Дедлайны: проверки — 3/4 `RUN_TIMEOUT`; отправка одного сообщения — 15 с (как `curl -m 15` в скрипте); сохранение — 10 с без отмены по сигналу. SIGTERM во время проверок — выход 1, ничего не отправлено и не записано; во время отправки — то, что ушло, записывается, выход 1.
- Telegram: JSON-тело и `link_preview_options: {is_disabled: true}` — актуальная форма Bot API вместо устаревшего `disable_web_page_preview`. Повторов внутри прохода нет: повторяет следующий проход.
- Логи — stderr, сообщения `DRY_RUN` — stdout. Каждый проход пишет строку `findings collected` со всеми ключами: в `DRY_RUN` находки с грацией иначе не видны.
- Поды читаются во всех namespace одним списком (нужно для «Pods running» по всем namespace), фильтр наблюдаемых — в проверке; списки читаются страницами по 500. Как и скрипт, смотрятся только `containerStatuses` (не init-контейнеры).
- Конфигурация дополнительно проверяет имена namespace и ConfigMap (DNS-1123), дубликаты имён в `PROBES`, `HTTP_TIMEOUT ≤ RUN_TIMEOUT`. Пустая переменная равна отсутствующей (поведение caarlos0/env) — значит, берётся значение по умолчанию.
- RBAC примера: на ConfigMap только `get` и `update`, без `patch` — код не делает patch. User-Agent запросов — `outegro-watchdog/<version>`.
- Модуль `github.com/outegro-dev/watchdog-lab/go`, директива `go 1.27.2` (её читает `setup-go` в CI).
