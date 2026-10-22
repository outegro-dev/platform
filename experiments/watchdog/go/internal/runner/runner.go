// Package runner performs one watchdog pass: load the state, collect
// findings from every source in parallel, plan the alerts, deliver them and
// save the new state.
package runner

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"slices"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/outegro-dev/watchdog-lab/go/internal/alerting"
	"github.com/outegro-dev/watchdog-lab/go/internal/checks"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

const (
	// pgClusterName is the CloudNativePG cluster of the platform.
	pgClusterName = "pg"
	// argoNamespace is where Argo CD keeps its Application objects.
	argoNamespace = "argocd"
	// saveTimeout bounds the state write. The write is detached from
	// cancellation: once messages went out, recording that is what keeps
	// the next pass from repeating them.
	saveTimeout = 10 * time.Second
)

// ErrInterrupted reports a pass stopped by a signal or by the run deadline.
var ErrInterrupted = errors.New("pass interrupted")

// Config is what the runner needs from the configuration.
type Config struct {
	// Namespace holds the PostgreSQL cluster and its backups.
	Namespace string
	// WatchedNamespaces are the namespaces whose pods are checked.
	WatchedNamespaces []string
	// Probes are the HTTP endpoints that must answer 200.
	Probes []domain.Probe
	// ChecksTimeout bounds the collection phase, so a source that hangs
	// becomes a failed check and still leaves time to notify and save.
	// Zero means no deadline beyond the one on the context passed to Run.
	ChecksTimeout time.Duration
	// DryRun skips saving the state.
	DryRun bool
}

// Deps are the ports the runner talks to. All fields are required except
// Logger.
type Deps struct {
	Cluster  ports.ClusterSource
	Prober   ports.Prober
	Alerts   ports.AlertsSource
	Disk     ports.DiskStat
	Store    ports.StateStore
	Notifier ports.Notifier
	Clock    ports.Clock
	Logger   *slog.Logger
}

// Summary describes a finished (or failed) pass for the final log line.
type Summary struct {
	Findings int
	Sent     int
	Failed   int
	FirstRun bool
	Duration time.Duration
}

// Runner performs passes. It holds no state between them.
type Runner struct {
	cfg  Config
	deps Deps
	log  *slog.Logger
}

// New returns a Runner. A nil logger discards logs.
func New(cfg Config, deps Deps) *Runner {
	log := deps.Logger
	if log == nil {
		log = slog.New(slog.DiscardHandler)
	}
	return &Runner{cfg: cfg, deps: deps, log: log}
}

// Run performs one pass. It returns an error when the state cannot be
// loaded or saved, or when ctx is cancelled; failed checks and failed
// sends are logged and do not fail the pass.
func (r *Runner) Run(ctx context.Context) (Summary, error) {
	start := time.Now()
	var sum Summary
	done := func(err error) (Summary, error) {
		sum.Duration = time.Since(start)
		return sum, err
	}

	now := r.deps.Clock.Now()

	stored, found, err := r.deps.Store.Load(ctx)
	if errors.Is(err, ports.ErrCorruptState) {
		r.log.WarnContext(ctx, "stored state is unreadable, treating this pass as the first run", "error", err)
		found, err = false, nil
	}
	if err != nil {
		return done(fmt.Errorf("load state: %w", err))
	}
	var prev *domain.State
	if found {
		prev = &stored
	}
	sum.FirstRun = prev == nil

	res, err := r.collect(ctx, now)
	if err != nil {
		return done(err)
	}

	findings := domain.Dedupe(res.findings())
	r.logFindings(ctx, findings)

	outcome := alerting.Plan(prev, findings, res.facts, now)
	sum.Findings = outcome.Failing
	delivered := r.deliver(ctx, outcome.Messages)
	for _, ok := range delivered {
		if ok {
			sum.Sent++
		} else {
			sum.Failed++
		}
	}
	next := alerting.Apply(outcome, delivered)

	if r.cfg.DryRun {
		r.log.InfoContext(ctx, "dry run: state not saved")
	} else {
		saveCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), saveTimeout)
		defer cancel()
		if err := r.deps.Store.Save(saveCtx, next); err != nil {
			return done(fmt.Errorf("save state: %w", err))
		}
	}

	if ctx.Err() != nil {
		return done(fmt.Errorf("%w while sending: %w", ErrInterrupted, context.Cause(ctx)))
	}
	return done(nil)
}

// collected holds the output of every check. Each check goroutine writes
// only its own fields; errgroup.Wait makes those writes visible to the
// caller, so no mutex is needed.
type collected struct {
	pods, oom, nodes, disk, certs, pg, backups, argo, http, prom []domain.Finding
	facts                                                        domain.Facts
}

// findings returns all findings in a fixed check order, so "the first of
// duplicate keys" does not depend on which goroutine finished first.
func (c *collected) findings() []domain.Finding {
	return slices.Concat(c.pods, c.oom, c.nodes, c.disk, c.certs, c.pg, c.backups, c.argo, c.http, c.prom)
}

// collect runs every check concurrently. A failed source never stops the
// other checks; only cancellation of ctx (signal or run deadline) does.
func (r *Runner) collect(ctx context.Context, now time.Time) (*collected, error) {
	checksCtx := ctx
	if r.cfg.ChecksTimeout > 0 {
		var cancel context.CancelFunc
		checksCtx, cancel = context.WithTimeout(ctx, r.cfg.ChecksTimeout)
		defer cancel()
	}
	g, gctx := errgroup.WithContext(checksCtx)

	interrupted := func() error {
		if ctx.Err() == nil {
			return nil
		}
		return fmt.Errorf("%w: %w", ErrInterrupted, context.Cause(ctx))
	}

	var c collected
	start := func(name string, check func(context.Context) error) {
		g.Go(func() error {
			err := check(gctx)
			if err == nil {
				return nil
			}
			if stop := interrupted(); stop != nil {
				return stop // cancels gctx, so the other checks stop too
			}
			r.log.WarnContext(gctx, "check source failed", "check", name, "error", err)
			return nil
		})
	}

	start("pods", func(ctx context.Context) error { return r.checkPods(ctx, now, &c) })
	start("nodes", func(ctx context.Context) error { return r.checkNodes(ctx, &c) })
	start("disk", func(context.Context) error { return r.checkDisk(&c) })
	start("certificates", func(ctx context.Context) error { return r.checkCertificates(ctx, now, &c) })
	start("postgres", func(ctx context.Context) error { return r.checkPostgres(ctx, &c) })
	start("backups", func(ctx context.Context) error { return r.checkBackups(ctx, now, &c) })
	start("argocd", func(ctx context.Context) error { return r.checkArgo(ctx, &c) })
	start("http", func(ctx context.Context) error { return r.checkHTTP(ctx, &c) })
	start("prometheus", func(ctx context.Context) error { return r.checkPrometheus(ctx, &c) })

	if err := g.Wait(); err != nil {
		return nil, err
	}
	if err := interrupted(); err != nil {
		return nil, err
	}
	return &c, nil
}

func (r *Runner) checkPods(ctx context.Context, now time.Time, c *collected) error {
	pods, err := r.deps.Cluster.Pods(ctx)
	if err != nil {
		c.pods = checks.PodsUnavailable()
		return fmt.Errorf("list pods: %w", err)
	}
	c.pods = checks.Pods(pods, r.cfg.WatchedNamespaces, now)
	c.oom = checks.OOMKills(pods, r.cfg.WatchedNamespaces, now)
	c.facts.PodsRunning = domain.Ptr(checks.RunningPods(pods))
	return nil
}

func (r *Runner) checkNodes(ctx context.Context, c *collected) error {
	nodes, err := r.deps.Cluster.Nodes(ctx)
	if err != nil {
		return fmt.Errorf("list nodes: %w", err)
	}
	c.nodes = checks.Nodes(nodes)
	return nil
}

func (r *Runner) checkDisk(c *collected) error {
	pct, err := r.deps.Disk.UsedPercent()
	if err != nil {
		return fmt.Errorf("disk usage: %w", err)
	}
	c.disk = checks.Disk(pct)
	c.facts.DiskUsedPercent = domain.Ptr(pct)
	return nil
}

func (r *Runner) checkCertificates(ctx context.Context, now time.Time, c *collected) error {
	certs, err := r.deps.Cluster.Certificates(ctx)
	if err != nil {
		return fmt.Errorf("list certificates: %w", err)
	}
	c.certs = checks.Certificates(certs, now)
	if days, ok := checks.CertDaysLeft(certs, now); ok {
		c.facts.CertDaysLeft = domain.Ptr(days)
	}
	return nil
}

func (r *Runner) checkPostgres(ctx context.Context, c *collected) error {
	cluster, err := r.deps.Cluster.PostgresCluster(ctx, r.cfg.Namespace, pgClusterName)
	switch {
	case errors.Is(err, ports.ErrNotFound):
		c.pg = checks.PostgresCluster(nil)
		return nil
	case err != nil:
		// Like the shell script: a cluster that cannot be read is reported
		// as missing rather than silently skipped.
		c.pg = checks.PostgresCluster(nil)
		return fmt.Errorf("get postgres cluster: %w", err)
	default:
		c.pg = checks.PostgresCluster(&cluster)
		return nil
	}
}

func (r *Runner) checkBackups(ctx context.Context, now time.Time, c *collected) error {
	backups, err := r.deps.Cluster.Backups(ctx, r.cfg.Namespace)
	if err != nil {
		return fmt.Errorf("list backups: %w", err)
	}
	findings, age, ok := checks.Backups(backups, now)
	c.backups = findings
	if ok {
		c.facts.BackupAgeHours = domain.Ptr(age)
	}
	return nil
}

func (r *Runner) checkArgo(ctx context.Context, c *collected) error {
	apps, err := r.deps.Cluster.ArgoApps(ctx, argoNamespace)
	if err != nil {
		return fmt.Errorf("list argo cd applications: %w", err)
	}
	c.argo = checks.ArgoApps(apps)
	return nil
}

// checkHTTP probes every endpoint concurrently. A probe that fails counts
// as "no response"; it is a finding, not a check error.
func (r *Runner) checkHTTP(ctx context.Context, c *collected) error {
	results := make([]domain.ProbeResult, len(r.cfg.Probes))
	var wg sync.WaitGroup
	for i, p := range r.cfg.Probes {
		wg.Go(func() {
			code, err := r.deps.Prober.Probe(ctx, p.URL)
			if err != nil {
				r.log.DebugContext(ctx, "probe failed", "probe", p.Name, "error", err)
				code = 0
			}
			results[i] = domain.ProbeResult{Probe: p, Code: code}
		})
	}
	wg.Wait()
	c.http = checks.Probes(results)
	return nil
}

func (r *Runner) checkPrometheus(ctx context.Context, c *collected) error {
	alerts, err := r.deps.Alerts.Alerts(ctx)
	if err != nil {
		c.prom = checks.PrometheusUnavailable()
		return fmt.Errorf("prometheus alerts: %w", err)
	}
	c.prom = checks.PrometheusAlerts(alerts)
	return nil
}

// logFindings writes one line with every finding key, including findings
// still in grace. In DRY_RUN nothing is remembered, so this line is how a
// shadow run shows what the alerting would eventually report.
func (r *Runner) logFindings(ctx context.Context, findings []domain.Finding) {
	keys := make([]string, 0, len(findings))
	for _, f := range findings {
		keys = append(keys, f.Key)
		r.log.DebugContext(ctx, "finding", "key", f.Key, "message", f.Message)
	}
	slices.Sort(keys)
	r.log.InfoContext(ctx, "findings collected", "count", len(keys), "keys", keys)
}

// deliver sends the messages one by one, in plan order, and reports which
// were accepted. A failed send is logged and does not stop the others.
func (r *Runner) deliver(ctx context.Context, msgs []alerting.Message) []bool {
	delivered := make([]bool, len(msgs))
	for i, m := range msgs {
		if err := r.deps.Notifier.Send(ctx, m.Text); err != nil {
			r.log.ErrorContext(ctx, "message not delivered", "kind", m.Kind, "error", err)
			continue
		}
		delivered[i] = true
		r.log.InfoContext(ctx, "message delivered", "kind", m.Kind)
	}
	return delivered
}
