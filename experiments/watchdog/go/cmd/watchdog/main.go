// Command watchdog checks the outegro.dev cluster once and tells the owner
// in Telegram when something breaks, stays broken or recovers.
//
// This file is the composition root: it reads the configuration, builds the
// adapters, hands them to the runner as ports and maps the result to an
// exit code. Nothing else in the program knows which adapters are in use.
package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/caarlos0/env/v11"
	"k8s.io/client-go/dynamic"
	typedcorev1 "k8s.io/client-go/kubernetes/typed/core/v1"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/klog/v2"

	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/clock"
	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/console"
	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/disk"
	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/httpprobe"
	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/kube"
	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/promalerts"
	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/telegram"
	"github.com/outegro-dev/watchdog-lab/go/internal/config"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
	"github.com/outegro-dev/watchdog-lab/go/internal/runner"
)

// version is set at build time: -ldflags "-X main.version=1.2.3".
var version = "dev"

// Exit codes from the specification.
const (
	exitOK      = 0 // the pass finished, even with findings or failed sends
	exitFailure = 1 // state, Kubernetes client or interrupted pass
	exitConfig  = 2 // invalid configuration
)

// platform is what the program takes from the outside world besides the
// environment. main uses the real one; tests swap in fakes.
type platform struct {
	newKube func(userAgent string) (typedcorev1.CoreV1Interface, dynamic.Interface, error)
	newDisk func(path string) ports.DiskStat
	clock   ports.Clock
}

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	code := run(ctx, env.ToMap(os.Environ()), os.Stdout, os.Stderr, platform{
		newKube: newKubeClients,
		newDisk: func(path string) ports.DiskStat { return disk.NewStatfs(path) },
		clock:   clock.System{},
	})
	stop()
	os.Exit(code)
}

// run performs one pass and returns the exit code. Messages in DRY_RUN go
// to stdout; JSON logs go to stderr.
func run(ctx context.Context, environ map[string]string, stdout, stderr io.Writer, p platform) int {
	cfg, err := config.Load(environ)
	if err != nil {
		newLogger(stderr, slog.LevelInfo).ErrorContext(ctx, "invalid configuration", "error", err)
		return exitConfig
	}
	logger := newLogger(stderr, cfg.LogLevel)
	// client-go logs through klog; route it into the same JSON stream.
	klog.SetSlogLogger(logger.With("component", "client-go"))
	logger.InfoContext(ctx, "watchdog starting", "version", version, "config", cfg)

	userAgent := "outegro-watchdog/" + version

	alerts, err := promalerts.New(cfg.PrometheusURL, cfg.HTTPTimeout)
	if err != nil {
		logger.ErrorContext(ctx, "invalid configuration", "error", err)
		return exitConfig
	}

	core, dyn, err := p.newKube(userAgent)
	if err != nil {
		logger.ErrorContext(ctx, "cannot create the kubernetes client", "error", err)
		return exitFailure
	}

	var notifier ports.Notifier
	if cfg.DryRun {
		notifier = console.New(stdout)
	} else {
		notifier = telegram.New(cfg.TelegramAPIURL, cfg.TelegramBotToken.Reveal(), cfg.TelegramChatID,
			telegram.WithUserAgent(userAgent))
	}

	r := runner.New(runner.Config{
		Namespace:         cfg.Namespace,
		WatchedNamespaces: cfg.WatchedNamespaces,
		Probes:            toDomainProbes(cfg.Probes),
		// Checks get three quarters of the pass; the rest is kept for
		// sending and saving even when a source hangs.
		ChecksTimeout: cfg.RunTimeout * 3 / 4,
		DryRun:        cfg.DryRun,
	}, runner.Deps{
		Cluster:  kube.NewCluster(core, dyn),
		Prober:   httpprobe.New(cfg.HTTPTimeout, userAgent),
		Alerts:   alerts,
		Disk:     p.newDisk(cfg.DiskPath),
		Store:    kube.NewStateStore(core, cfg.Namespace, cfg.StateConfigMap),
		Notifier: notifier,
		Clock:    p.clock,
		Logger:   logger,
	})

	ctx, cancel := context.WithTimeout(ctx, cfg.RunTimeout)
	defer cancel()

	sum, err := r.Run(ctx)
	attrs := []any{
		"findings", sum.Findings,
		"sent", sum.Sent,
		"failedSends", sum.Failed,
		"firstRun", sum.FirstRun,
		"dryRun", cfg.DryRun,
		"duration", sum.Duration.Round(time.Millisecond).String(),
	}
	if err != nil {
		logger.ErrorContext(ctx, "pass failed", append(attrs, "error", err)...)
		return exitFailure
	}
	logger.InfoContext(ctx, "pass complete", attrs...)
	return exitOK
}

func newLogger(w io.Writer, level slog.Level) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level}))
}

// newKubeClients uses the in-cluster service account and falls back to
// KUBECONFIG or ~/.kube/config for local runs.
func newKubeClients(userAgent string) (core typedcorev1.CoreV1Interface, dyn dynamic.Interface, err error) {
	cfg, err := rest.InClusterConfig()
	if errors.Is(err, rest.ErrNotInCluster) {
		cfg, err = clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
			clientcmd.NewDefaultClientConfigLoadingRules(), &clientcmd.ConfigOverrides{},
		).ClientConfig()
	}
	if err != nil {
		return nil, nil, fmt.Errorf("kubernetes config: %w", err)
	}
	cfg.UserAgent = userAgent
	if core, err = typedcorev1.NewForConfig(cfg); err != nil {
		return nil, nil, fmt.Errorf("kubernetes client: %w", err)
	}
	if dyn, err = dynamic.NewForConfig(cfg); err != nil {
		return nil, nil, fmt.Errorf("kubernetes dynamic client: %w", err)
	}
	return core, dyn, nil
}

func toDomainProbes(in []config.Probe) []domain.Probe {
	out := make([]domain.Probe, 0, len(in))
	for _, p := range in {
		out = append(out, domain.Probe{Name: p.Name, URL: p.URL})
	}
	return out
}
