// Package config reads the watchdog configuration from environment
// variables and validates it before anything talks to the network.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"reflect"
	"strings"
	"time"

	"github.com/caarlos0/env/v11"
	"k8s.io/apimachinery/pkg/util/validation"
)

// Config is the full configuration. Struct tags tell caarlos0/env which
// variable fills a field and what the default is.
type Config struct {
	Namespace         string        `env:"NAMESPACE" envDefault:"outegro"`
	WatchedNamespaces []string      `env:"WATCHED_NAMESPACES" envDefault:"outegro,agents,argocd,cert-manager,cnpg-system,kube-system"`
	StateConfigMap    string        `env:"STATE_CONFIGMAP" envDefault:"watchdog-state-v2"`
	PrometheusURL     string        `env:"PROMETHEUS_URL" envDefault:"http://monitoring-prometheus.monitoring.svc:9090"`
	Probes            []Probe       `env:"PROBES" envDefault:"landing=https://outegro.dev/,id=https://id.outegro.dev/health,auth=http://auth-backend.outegro.svc:4001/health/deep,notifications=http://notifications-backend.outegro.svc:4002/health/deep,payments=http://payments-backend.outegro.svc:4003/health/deep,battleship-backend=http://battleship-backend.outegro.svc:4004/health/deep,battleship=https://battleship.outegro.dev/health,edu-backend=http://edu-backend.outegro.svc:4005/health/deep,edu=https://edu.outegro.dev/health,pay=https://pay.outegro.dev/health,admin=https://admin.outegro.dev/health"`
	DiskPath          string        `env:"DISK_PATH" envDefault:"/probe"`
	TelegramBotToken  Secret        `env:"TELEGRAM_BOT_TOKEN"`
	TelegramChatID    string        `env:"TELEGRAM_CHAT_ID"`
	TelegramAPIURL    string        `env:"TELEGRAM_API_URL" envDefault:"https://api.telegram.org"`
	DryRun            bool          `env:"DRY_RUN" envDefault:"false"`
	RunTimeout        time.Duration `env:"RUN_TIMEOUT" envDefault:"120s"`
	HTTPTimeout       time.Duration `env:"HTTP_TIMEOUT" envDefault:"10s"`
	LogLevel          slog.Level    `env:"LOG_LEVEL" envDefault:"info"`
}

// Probe is one entry of PROBES: "name=URL".
type Probe struct {
	Name string
	URL  string
}

// UnmarshalText parses "name=URL". caarlos0/env calls it for every
// comma-separated element of PROBES.
func (p *Probe) UnmarshalText(text []byte) error {
	name, target, ok := strings.Cut(strings.TrimSpace(string(text)), "=")
	name, target = strings.TrimSpace(name), strings.TrimSpace(target)
	if !ok || name == "" || target == "" {
		return fmt.Errorf("probe %q: want name=URL", string(text))
	}
	if err := checkHTTPURL(target); err != nil {
		return fmt.Errorf("probe %q: %w", name, err)
	}
	*p = Probe{Name: name, URL: target}
	return nil
}

// Secret is a string that never prints its value: fmt, slog and JSON all
// see "***". Use Reveal where the real value is required.
type Secret string

const redacted = "***"

// Reveal returns the secret value.
func (s Secret) Reveal() string { return string(s) }

// String implements fmt.Stringer.
func (s Secret) String() string {
	if s == "" {
		return ""
	}
	return redacted
}

// GoString implements fmt.GoStringer, used by %#v.
func (s Secret) GoString() string { return `config.Secret("` + s.String() + `")` }

// LogValue implements slog.LogValuer.
func (s Secret) LogValue() slog.Value { return slog.StringValue(s.String()) }

// MarshalText implements encoding.TextMarshaler (JSON and YAML use it).
func (s Secret) MarshalText() ([]byte, error) { return []byte(s.String()), nil }

// UnmarshalText implements encoding.TextUnmarshaler; caarlos0/env uses it.
func (s *Secret) UnmarshalText(text []byte) error {
	*s = Secret(text)
	return nil
}

// Load parses and validates the configuration from environ (as returned
// by env.ToMap(os.Environ())). All problems are reported together.
func Load(environ map[string]string) (Config, error) {
	cfg, err := env.ParseAsWithOptions[Config](env.Options{Environment: environ})
	if err != nil {
		return Config{}, fmt.Errorf("config: %w", namedEnvErrors(err))
	}
	cfg.WatchedNamespaces = cleanList(cfg.WatchedNamespaces)
	if err := cfg.validate(); err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	return cfg, nil
}

func (c *Config) validate() error {
	var errs []error
	add := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }

	for _, msg := range validation.IsDNS1123Label(c.Namespace) {
		add("NAMESPACE %q: %s", c.Namespace, msg)
	}
	if len(c.WatchedNamespaces) == 0 {
		add("WATCHED_NAMESPACES: at least one namespace is required")
	}
	for _, ns := range c.WatchedNamespaces {
		for _, msg := range validation.IsDNS1123Label(ns) {
			add("WATCHED_NAMESPACES %q: %s", ns, msg)
		}
	}
	for _, msg := range validation.IsDNS1123Subdomain(c.StateConfigMap) {
		add("STATE_CONFIGMAP %q: %s", c.StateConfigMap, msg)
	}
	if err := checkHTTPURL(c.PrometheusURL); err != nil {
		add("PROMETHEUS_URL: %w", err)
	}
	if err := checkHTTPURL(c.TelegramAPIURL); err != nil {
		add("TELEGRAM_API_URL: %w", err)
	}
	seen := make(map[string]bool, len(c.Probes))
	for _, p := range c.Probes {
		if seen[p.Name] {
			add("PROBES: duplicate name %q", p.Name)
		}
		seen[p.Name] = true
	}
	if c.DiskPath == "" {
		add("DISK_PATH: must not be empty")
	}
	if !c.DryRun {
		// Never echo the token itself, only whether it is there.
		if strings.TrimSpace(c.TelegramBotToken.Reveal()) == "" {
			add("TELEGRAM_BOT_TOKEN is required unless DRY_RUN=true")
		}
		if strings.TrimSpace(c.TelegramChatID) == "" {
			add("TELEGRAM_CHAT_ID is required unless DRY_RUN=true")
		}
	}
	if c.RunTimeout <= 0 {
		add("RUN_TIMEOUT: must be positive, got %s", c.RunTimeout)
	}
	if c.HTTPTimeout <= 0 {
		add("HTTP_TIMEOUT: must be positive, got %s", c.HTTPTimeout)
	}
	if c.RunTimeout > 0 && c.HTTPTimeout > c.RunTimeout {
		add("HTTP_TIMEOUT (%s) must not exceed RUN_TIMEOUT (%s)", c.HTTPTimeout, c.RunTimeout)
	}
	return errors.Join(errs...)
}

// LogValue implements slog.LogValuer: the configuration can be logged as
// a whole, with the token masked.
func (c Config) LogValue() slog.Value {
	probes := make([]string, 0, len(c.Probes))
	for _, p := range c.Probes {
		probes = append(probes, p.Name)
	}
	return slog.GroupValue(
		slog.String("namespace", c.Namespace),
		slog.Any("watchedNamespaces", c.WatchedNamespaces),
		slog.String("stateConfigMap", c.StateConfigMap),
		slog.String("prometheusUrl", c.PrometheusURL),
		slog.Any("probes", probes),
		slog.String("diskPath", c.DiskPath),
		slog.Any("telegramBotToken", c.TelegramBotToken),
		slog.String("telegramApiUrl", c.TelegramAPIURL),
		slog.Bool("dryRun", c.DryRun),
		slog.String("runTimeout", c.RunTimeout.String()),
		slog.String("httpTimeout", c.HTTPTimeout.String()),
		slog.String("logLevel", c.LogLevel.String()),
	)
}

// checkHTTPURL accepts absolute http and https URLs with a host.
func checkHTTPURL(raw string) error {
	u, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("invalid URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("URL %q: scheme must be http or https", raw)
	}
	if u.Host == "" {
		return fmt.Errorf("URL %q: host is missing", raw)
	}
	return nil
}

// cleanList trims the elements and drops empty ones ("a, b,," -> [a b]).
func cleanList(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if s = strings.TrimSpace(s); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// namedEnvErrors rewrites caarlos0/env parse errors so they name the
// environment variable ("RUN_TIMEOUT: ...") instead of the Go field.
func namedEnvErrors(err error) error {
	var agg env.AggregateError
	if !errors.As(err, &agg) {
		return err
	}
	cfgType := reflect.TypeFor[Config]()
	out := make([]error, 0, len(agg.Errors))
	for _, e := range agg.Errors {
		var pe env.ParseError
		if errors.As(e, &pe) {
			if f, ok := cfgType.FieldByName(pe.Name); ok {
				out = append(out, fmt.Errorf("%s: %w", f.Tag.Get("env"), pe.Err))
				continue
			}
		}
		out = append(out, e)
	}
	return errors.Join(out...)
}
