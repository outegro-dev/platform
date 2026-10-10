package config_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log/slog"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/outegro-dev/watchdog-lab/go/internal/config"
)

const token = "123456:AAH-very-secret-token"

func base() map[string]string {
	return map[string]string{
		"TELEGRAM_BOT_TOKEN": token,
		"TELEGRAM_CHAT_ID":   "-1001234567890",
	}
}

func with(extra map[string]string) map[string]string {
	m := base()
	for k, v := range extra {
		m[k] = v
	}
	return m
}

func TestDefaults(t *testing.T) {
	t.Parallel()

	cfg, err := config.Load(base())
	require.NoError(t, err)

	assert.Equal(t, config.Config{
		Namespace:         "outegro",
		WatchedNamespaces: []string{"outegro", "agents", "argocd", "cert-manager", "cnpg-system", "kube-system"},
		StateConfigMap:    "watchdog-state-v2",
		PrometheusURL:     "http://monitoring-prometheus.monitoring.svc:9090",
		Probes: []config.Probe{
			{Name: "landing", URL: "https://outegro.dev/"},
			{Name: "id", URL: "https://id.outegro.dev/health"},
			{Name: "auth", URL: "http://auth-backend.outegro.svc:4001/health/deep"},
			{Name: "notifications", URL: "http://notifications-backend.outegro.svc:4002/health/deep"},
			{Name: "payments", URL: "http://payments-backend.outegro.svc:4003/health/deep"},
			{Name: "battleship-backend", URL: "http://battleship-backend.outegro.svc:4004/health/deep"},
			{Name: "battleship", URL: "https://battleship.outegro.dev/health"},
			{Name: "edu-backend", URL: "http://edu-backend.outegro.svc:4005/health/deep"},
			{Name: "edu", URL: "https://edu.outegro.dev/health"},
			{Name: "pay", URL: "https://pay.outegro.dev/health"},
			{Name: "admin", URL: "https://admin.outegro.dev/health"},
		},
		DiskPath:         "/probe",
		TelegramBotToken: token,
		TelegramChatID:   "-1001234567890",
		TelegramAPIURL:   "https://api.telegram.org",
		DryRun:           false,
		RunTimeout:       120 * time.Second,
		HTTPTimeout:      10 * time.Second,
		LogLevel:         slog.LevelInfo,
	}, cfg)
}

func TestOverrides(t *testing.T) {
	t.Parallel()

	cfg, err := config.Load(map[string]string{
		"NAMESPACE":          "staging",
		"WATCHED_NAMESPACES": " staging , monitoring,,",
		"STATE_CONFIGMAP":    "wd-state",
		"PROMETHEUS_URL":     "http://localhost:9090",
		"PROBES":             "web = http://localhost:3000/ , api=http://localhost:4000/health?full=1",
		"DISK_PATH":          "/",
		"TELEGRAM_API_URL":   "http://127.0.0.1:8081",
		"DRY_RUN":            "true",
		"RUN_TIMEOUT":        "30s",
		"HTTP_TIMEOUT":       "2s",
		"LOG_LEVEL":          "debug",
	})
	require.NoError(t, err)

	assert.Equal(t, "staging", cfg.Namespace)
	assert.Equal(t, []string{"staging", "monitoring"}, cfg.WatchedNamespaces)
	assert.Equal(t, "wd-state", cfg.StateConfigMap)
	assert.Equal(t, []config.Probe{
		{Name: "web", URL: "http://localhost:3000/"},
		{Name: "api", URL: "http://localhost:4000/health?full=1"},
	}, cfg.Probes)
	assert.True(t, cfg.DryRun)
	assert.Equal(t, 30*time.Second, cfg.RunTimeout)
	assert.Equal(t, 2*time.Second, cfg.HTTPTimeout)
	assert.Equal(t, slog.LevelDebug, cfg.LogLevel)
	assert.Empty(t, cfg.TelegramBotToken, "the token is optional in dry run")
}

func TestErrors(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		env  map[string]string
		want string
	}{
		{name: "missing token", env: map[string]string{"TELEGRAM_CHAT_ID": "1"}, want: "TELEGRAM_BOT_TOKEN is required unless DRY_RUN=true"},
		{name: "missing chat", env: map[string]string{"TELEGRAM_BOT_TOKEN": token}, want: "TELEGRAM_CHAT_ID is required unless DRY_RUN=true"},
		{name: "blank token", env: map[string]string{"TELEGRAM_BOT_TOKEN": "  ", "TELEGRAM_CHAT_ID": "1"}, want: "TELEGRAM_BOT_TOKEN is required"},
		{name: "bad duration", env: with(map[string]string{"RUN_TIMEOUT": "two minutes"}), want: "RUN_TIMEOUT"},
		{name: "zero duration", env: with(map[string]string{"HTTP_TIMEOUT": "0s"}), want: "HTTP_TIMEOUT: must be positive"},
		{name: "negative duration", env: with(map[string]string{"RUN_TIMEOUT": "-1s"}), want: "RUN_TIMEOUT: must be positive"},
		{name: "http timeout above run timeout", env: with(map[string]string{"RUN_TIMEOUT": "5s", "HTTP_TIMEOUT": "10s"}), want: "must not exceed RUN_TIMEOUT"},
		{name: "bad bool", env: with(map[string]string{"DRY_RUN": "maybe"}), want: "DRY_RUN"},
		{name: "bad log level", env: with(map[string]string{"LOG_LEVEL": "loud"}), want: "LOG_LEVEL"},
		{name: "prometheus without scheme", env: with(map[string]string{"PROMETHEUS_URL": "monitoring:9090"}), want: "PROMETHEUS_URL"},
		{name: "prometheus ftp", env: with(map[string]string{"PROMETHEUS_URL": "ftp://monitoring"}), want: "scheme must be http or https"},
		{name: "telegram url without host", env: with(map[string]string{"TELEGRAM_API_URL": "https://"}), want: "host is missing"},
		{name: "unparsable url", env: with(map[string]string{"PROMETHEUS_URL": "http://[::1"}), want: "invalid URL"},
		{name: "probe without name", env: with(map[string]string{"PROBES": "=https://outegro.dev/"}), want: "want name=URL"},
		{name: "probe without url", env: with(map[string]string{"PROBES": "landing"}), want: "want name=URL"},
		{name: "probe with bad url", env: with(map[string]string{"PROBES": "landing=outegro.dev"}), want: `probe "landing"`},
		{name: "duplicate probe", env: with(map[string]string{"PROBES": "a=http://x/,a=http://y/"}), want: `duplicate name "a"`},
		{name: "bad namespace", env: with(map[string]string{"NAMESPACE": "Outegro_Prod"}), want: "NAMESPACE"},
		{name: "bad watched namespace", env: with(map[string]string{"WATCHED_NAMESPACES": "outegro,Bad!"}), want: "WATCHED_NAMESPACES"},
		{name: "only commas", env: with(map[string]string{"WATCHED_NAMESPACES": ", ,"}), want: "at least one namespace"},
		{name: "bad configmap name", env: with(map[string]string{"STATE_CONFIGMAP": "State CM"}), want: "STATE_CONFIGMAP"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			_, err := config.Load(tt.env)
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.want)
			assert.NotContains(t, err.Error(), token, "errors never carry the token")
		})
	}
}

func TestAllProblemsAreReportedTogether(t *testing.T) {
	t.Parallel()
	_, err := config.Load(map[string]string{"NAMESPACE": "BAD", "PROMETHEUS_URL": "nope"})
	require.Error(t, err)
	for _, want := range []string{"NAMESPACE", "PROMETHEUS_URL", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID"} {
		assert.Contains(t, err.Error(), want)
	}
}

func TestTokenIsMasked(t *testing.T) {
	t.Parallel()

	cfg, err := config.Load(base())
	require.NoError(t, err)

	for _, format := range []string{"%v", "%+v", "%#v", "%s"} {
		out := fmt.Sprintf(format, cfg)
		assert.NotContains(t, out, token, format)
	}
	assert.Equal(t, "***", cfg.TelegramBotToken.String())
	assert.Equal(t, `config.Secret("***")`, fmt.Sprintf("%#v", cfg.TelegramBotToken))
	assert.Equal(t, token, cfg.TelegramBotToken.Reveal())

	var buf bytes.Buffer
	slog.New(slog.NewJSONHandler(&buf, nil)).Info("starting", "config", cfg, "token", cfg.TelegramBotToken)
	assert.NotContains(t, buf.String(), token)
	assert.Contains(t, buf.String(), `"telegramBotToken":"***"`)
	assert.Contains(t, buf.String(), `"token":"***"`)

	data, err := json.Marshal(cfg)
	require.NoError(t, err)
	assert.NotContains(t, string(data), token)

	assert.Empty(t, config.Secret("").String(), "an empty secret prints as empty")
}
