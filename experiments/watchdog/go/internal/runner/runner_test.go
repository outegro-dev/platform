package runner_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/outegro-dev/watchdog-lab/go/internal/alerting"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
	"github.com/outegro-dev/watchdog-lab/go/internal/runner"
)

// The fakes below are hand-written: a few lines each, no mocking library.
// They satisfy the port interfaces implicitly, just like the real adapters.

type fakeCluster struct {
	pods     []domain.Pod
	podsErr  error
	nodes    []domain.Node
	nodesErr error
	certs    []domain.Certificate
	pg       *domain.PGCluster
	pgErr    error
	backups  []domain.Backup
	apps     []domain.ArgoApp
	// block, when set, is called by every method before answering.
	block func(ctx context.Context) error
}

func (c *fakeCluster) wait(ctx context.Context) error {
	if c.block == nil {
		return nil
	}
	return c.block(ctx)
}

func (c *fakeCluster) Pods(ctx context.Context) ([]domain.Pod, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	return c.pods, c.podsErr
}

func (c *fakeCluster) Nodes(ctx context.Context) ([]domain.Node, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	return c.nodes, c.nodesErr
}

func (c *fakeCluster) Certificates(ctx context.Context) ([]domain.Certificate, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	return c.certs, nil
}

func (c *fakeCluster) PostgresCluster(ctx context.Context, _, _ string) (domain.PGCluster, error) {
	if err := c.wait(ctx); err != nil {
		return domain.PGCluster{}, err
	}
	if c.pgErr != nil {
		return domain.PGCluster{}, c.pgErr
	}
	if c.pg == nil {
		return domain.PGCluster{}, fmt.Errorf("cluster: %w", ports.ErrNotFound)
	}
	return *c.pg, nil
}

func (c *fakeCluster) Backups(ctx context.Context, _ string) ([]domain.Backup, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	return c.backups, nil
}

func (c *fakeCluster) ArgoApps(ctx context.Context, _ string) ([]domain.ArgoApp, error) {
	if err := c.wait(ctx); err != nil {
		return nil, err
	}
	return c.apps, nil
}

type fakeProber map[string]int // URL -> code; missing URL = no response

func (p fakeProber) Probe(_ context.Context, url string) (int, error) {
	if code, ok := p[url]; ok {
		return code, nil
	}
	return 0, errors.New("connection refused")
}

type fakeAlerts struct {
	alerts []domain.Alert
	err    error
}

func (a fakeAlerts) Alerts(context.Context) ([]domain.Alert, error) { return a.alerts, a.err }

type fakeDisk struct {
	pct int
	err error
}

func (d fakeDisk) UsedPercent() (int, error) { return d.pct, d.err }

type memStore struct {
	mu      sync.Mutex
	state   *domain.State
	loadErr error
	saveErr error
	saves   int
}

func (s *memStore) Load(context.Context) (domain.State, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loadErr != nil {
		return domain.State{}, false, s.loadErr
	}
	if s.state == nil {
		return domain.State{}, false, nil
	}
	return s.state.Clone(), true, nil
}

func (s *memStore) Save(_ context.Context, st domain.State) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.saves++
	if s.saveErr != nil {
		return s.saveErr
	}
	c := st.Clone()
	s.state = &c
	return nil
}

type recorder struct {
	mu   sync.Mutex
	sent []string
	fail bool
}

func (r *recorder) Send(_ context.Context, text string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.fail {
		return errors.New("telegram is down")
	}
	r.sent = append(r.sent, text)
	return nil
}

type fixedClock time.Time

func (c fixedClock) Now() time.Time { return time.Time(c) }

// noon is after the digest hour; tests that do not care about the digest
// set DigestDay to this day.
var noon = time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)

type env struct {
	cluster  *fakeCluster
	prober   fakeProber
	alerts   fakeAlerts
	disk     fakeDisk
	store    *memStore
	notifier *recorder
	logs     *bytes.Buffer
	cfg      runner.Config
	now      time.Time
}

// healthyEnv returns a cluster where every check passes and a stored state
// that has already sent today's digest.
func healthyEnv() *env {
	return &env{
		cluster: &fakeCluster{
			pods: []domain.Pod{{
				Namespace: "outegro", Name: "auth-0", Phase: "Running", CreatedAt: noon.Add(-time.Hour),
				Conditions: []domain.Condition{{Type: "Ready", Status: "True"}},
			}},
			nodes: []domain.Node{{Name: "vps", Conditions: []domain.Condition{{Type: "Ready", Status: "True"}}}},
			certs: []domain.Certificate{{Name: "tls", Conditions: []domain.Condition{{Type: "Ready", Status: "True"}}, NotAfter: noon.Add(60 * 24 * time.Hour)}},
			pg: &domain.PGCluster{Name: "pg", Conditions: []domain.Condition{
				{Type: "Ready", Status: "True"}, {Type: "ContinuousArchiving", Status: "True"}, {Type: "LastBackupSucceeded", Status: "True"},
			}},
			backups: []domain.Backup{{Name: "b", Phase: "completed", StoppedAt: noon.Add(-3 * time.Hour)}},
			apps:    []domain.ArgoApp{{Name: "platform", SyncStatus: "Synced", HealthStatus: "Healthy"}},
		},
		prober:   fakeProber{"https://id.example/health": 200},
		disk:     fakeDisk{pct: 40},
		store:    &memStore{state: &domain.State{Version: 1, DigestDay: "20261010", Entries: map[string]domain.Entry{}}},
		notifier: &recorder{},
		logs:     &bytes.Buffer{},
		cfg: runner.Config{
			Namespace:         "outegro",
			WatchedNamespaces: []string{"outegro"},
			Probes:            []domain.Probe{{Name: "id", URL: "https://id.example/health"}},
			ChecksTimeout:     5 * time.Second,
		},
		now: noon,
	}
}

func (e *env) runner() *runner.Runner {
	return runner.New(e.cfg, runner.Deps{
		Cluster:  e.cluster,
		Prober:   e.prober,
		Alerts:   e.alerts,
		Disk:     e.disk,
		Store:    e.store,
		Notifier: e.notifier,
		Clock:    fixedClock(e.now),
		Logger:   slog.New(slog.NewJSONHandler(e.logs, &slog.HandlerOptions{Level: slog.LevelDebug})),
	})
}

func (e *env) run(t *testing.T) runner.Summary {
	t.Helper()
	sum, err := e.runner().Run(t.Context())
	require.NoError(t, err)
	return sum
}

func TestHealthyPassSendsNothing(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	sum := e.run(t)

	assert.Empty(t, e.notifier.sent)
	assert.Equal(t, runner.Summary{Duration: sum.Duration}, sum)
	assert.Equal(t, 1, e.store.saves)
	assert.Empty(t, e.store.state.Entries)
}

func TestFindingsFromEverySource(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.cluster.pods[0].Containers = []domain.ContainerStatus{{Name: "app", WaitingReason: "CrashLoopBackOff"}}
	e.cluster.nodes[0].Conditions = append(e.cluster.nodes[0].Conditions, domain.Condition{Type: "DiskPressure", Status: "True", Reason: "KubeletHasDiskPressure"})
	e.disk.pct = 85
	e.cluster.certs[0].NotAfter = noon.Add(3 * 24 * time.Hour)
	e.cluster.pg.Conditions[1].Status = "False"
	e.cluster.backups[0].StoppedAt = noon.Add(-30 * time.Hour)
	e.alerts.alerts = []domain.Alert{{State: "firing", Labels: map[string]string{"alertname": "KubeJobFailed", "severity": "warning", "namespace": "outegro", "job_name": "migrate"}}}

	sum := e.run(t)

	require.Len(t, e.notifier.sent, 1)
	assert.Equal(t, "🔴 outegro.dev: problem"+
		"\n• certificate tls expires in 3 days"+
		"\n• server disk 85% used"+
		"\n• node vps: DiskPressure=True (KubeletHasDiskPressure)"+
		"\n• PostgreSQL ContinuousArchiving:  "+
		"\n• last completed backup is 30 h old"+
		"\n• outegro/auth-0: CrashLoopBackOff"+
		"\n• KubeJobFailed (warning): migrate/outegro", e.notifier.sent[0])
	assert.Equal(t, 7, sum.Findings)
	assert.Equal(t, 1, sum.Sent)
}

func TestFailedSourcesFollowTheRules(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.cluster.podsErr = errors.New("forbidden")
	e.cluster.nodesErr = errors.New("timeout")
	e.cluster.pgErr = errors.New("connection reset")
	e.alerts.err = errors.New("connection refused")
	e.disk.err = errors.New("no such file")
	e.prober = fakeProber{} // id does not answer

	sum := e.run(t)

	st := e.store.state
	assert.Contains(t, st.Entries, "kube:pods", "a failed pod list is a finding")
	assert.Contains(t, st.Entries, "pg:cluster", "an unreadable cluster is reported as missing")
	assert.Contains(t, st.Entries, "prom:api", "Prometheus not answering is a finding")
	assert.Contains(t, st.Entries, "http:id")
	assert.Equal(t, "https://id.example/health answered no response", st.Entries["http:id"].Message)
	assert.NotContains(t, st.Entries, "node:vps:Ready", "failed node list is skipped")
	assert.Equal(t, 4, sum.Findings)

	logs := e.logs.String()
	for _, check := range []string{"pods", "nodes", "postgres", "prometheus", "disk"} {
		assert.Contains(t, logs, `"check":"`+check+`"`)
	}
	// prom:api and http:id are in grace, kube:pods and pg:cluster are not.
	require.Len(t, e.notifier.sent, 1)
	assert.Equal(t, "🔴 outegro.dev: problem\n• cannot list pods\n• PostgreSQL cluster pg is missing", e.notifier.sent[0])
}

func TestMissingPostgresCluster(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.cluster.pg = nil
	e.run(t)
	assert.Equal(t, []string{"🔴 outegro.dev: problem\n• PostgreSQL cluster pg is missing"}, e.notifier.sent)
	assert.NotContains(t, e.logs.String(), `"check":"postgres"`, "not found is not a source failure")
}

func TestDigestFacts(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.store.state.DigestDay = "20261009"
	e.run(t)
	assert.Equal(t, []string{"☀️ outegro.dev daily: All checks pass.\nPods running: 1\nLast backup: 3 h ago\nCertificate: 60 days left\nDisk: 40% used"}, e.notifier.sent)
	assert.Equal(t, "20261010", e.store.state.DigestDay)
}

func TestDigestFactsUnknownWhenSourcesFail(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.store.state.DigestDay = ""
	e.cluster.podsErr = errors.New("x")
	e.cluster.certs = nil
	e.cluster.backups = nil
	e.disk.err = errors.New("x")
	e.run(t)
	require.Len(t, e.notifier.sent, 2)
	assert.Equal(t, "☀️ outegro.dev daily: Failing checks: 2.\nPods running: ?\nLast backup: ? h ago\nCertificate: ? days left\nDisk: ?% used", e.notifier.sent[1])
}

func TestFirstRunAndCorruptState(t *testing.T) {
	t.Parallel()

	for _, tc := range []struct {
		name  string
		store *memStore
	}{
		{name: "no state", store: &memStore{}},
		{name: "corrupt state", store: &memStore{loadErr: fmt.Errorf("configmap: %w", ports.ErrCorruptState)}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			e := healthyEnv()
			e.now = noon.Add(-6 * time.Hour) // 06:00, no digest
			e.store = tc.store
			sum, err := e.runner().Run(t.Context())
			if tc.store.loadErr != nil {
				// The fake keeps failing Load, but Save still works.
				assert.Contains(t, e.logs.String(), "stored state is unreadable")
			}
			require.NoError(t, err)
			assert.True(t, sum.FirstRun)
			assert.Equal(t, []string{alerting.GreetingText}, e.notifier.sent)
			assert.Equal(t, 1, tc.store.saves)
		})
	}
}

func TestStateErrorsFailThePass(t *testing.T) {
	t.Parallel()

	t.Run("load", func(t *testing.T) {
		t.Parallel()
		e := healthyEnv()
		e.store.loadErr = errors.New("forbidden")
		_, err := e.runner().Run(t.Context())
		require.ErrorContains(t, err, "load state: forbidden")
		assert.Empty(t, e.notifier.sent)
		assert.Zero(t, e.store.saves)
	})
	t.Run("save", func(t *testing.T) {
		t.Parallel()
		e := healthyEnv()
		e.store.saveErr = errors.New("conflict")
		_, err := e.runner().Run(t.Context())
		require.ErrorContains(t, err, "save state: conflict")
	})
}

func TestDryRunDoesNotSave(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.cfg.DryRun = true
	e.disk.pct = 95
	e.run(t)
	assert.Len(t, e.notifier.sent, 1)
	assert.Zero(t, e.store.saves)
	assert.Contains(t, e.logs.String(), "dry run: state not saved")
}

func TestFailedSendIsRetriedNextPass(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.disk.pct = 95
	e.notifier.fail = true

	sum := e.run(t)
	assert.Equal(t, 1, sum.Failed)
	assert.Equal(t, int64(0), e.store.state.Entries["disk"].Notified)
	assert.Contains(t, e.logs.String(), "message not delivered")

	e.notifier.fail = false
	e.now = e.now.Add(5 * time.Minute)
	sum = e.run(t)
	assert.Equal(t, 1, sum.Sent)
	assert.Equal(t, []string{"🔴 outegro.dev: problem\n• server disk 95% used"}, e.notifier.sent)
	assert.Equal(t, e.now.Unix(), e.store.state.Entries["disk"].Notified)
}

func TestChecksRunConcurrently(t *testing.T) {
	t.Parallel()
	e := healthyEnv()

	// Every cluster call waits until all six have started. Run sequentially,
	// the first call would wait forever (until the checks deadline).
	const clusterCalls = 6
	var started sync.WaitGroup
	started.Add(clusterCalls)
	allStarted := make(chan struct{})
	go func() { started.Wait(); close(allStarted) }()
	e.cluster.block = func(ctx context.Context) error {
		started.Done()
		select {
		case <-allStarted:
			return nil
		case <-ctx.Done():
			return ctx.Err()
		}
	}

	sum := e.run(t)
	assert.Zero(t, sum.Findings, "all calls answered, so nothing failed")
	assert.NotContains(t, e.logs.String(), "check source failed")
}

func TestHungSourceBecomesAFailedCheck(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.cfg.ChecksTimeout = 50 * time.Millisecond
	e.cluster.block = func(ctx context.Context) error {
		<-ctx.Done()
		return ctx.Err()
	}

	start := time.Now()
	sum := e.run(t)
	assert.Less(t, time.Since(start), 5*time.Second)
	assert.Contains(t, e.store.state.Entries, "kube:pods")
	assert.Contains(t, e.store.state.Entries, "pg:cluster")
	assert.Equal(t, 1, sum.Sent)
}

func TestCancellationStopsThePass(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	ctx, cancel := context.WithCancel(t.Context())
	e.cluster.block = func(ctx context.Context) error {
		cancel() // SIGTERM arrives while the checks run
		<-ctx.Done()
		return ctx.Err()
	}

	_, err := e.runner().Run(ctx)
	require.ErrorIs(t, err, runner.ErrInterrupted)
	require.ErrorIs(t, err, context.Canceled)
	assert.Empty(t, e.notifier.sent)
	assert.Zero(t, e.store.saves, "state is not written")
}

func TestCancellationWhileSendingStillSaves(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.disk.pct = 95
	e.store.state.DigestDay = ""
	ctx, cancel := context.WithCancel(t.Context())
	n := &cancelAfterFirst{cancel: cancel}

	r := runner.New(e.cfg, runner.Deps{
		Cluster: e.cluster, Prober: e.prober, Alerts: e.alerts, Disk: e.disk,
		Store: e.store, Notifier: n, Clock: fixedClock(e.now),
	})
	sum, err := r.Run(ctx)
	require.ErrorIs(t, err, runner.ErrInterrupted)
	assert.Equal(t, 1, sum.Sent)
	assert.Equal(t, 1, sum.Failed)
	assert.Equal(t, 1, e.store.saves, "what was delivered is recorded")
	assert.Equal(t, noon.Unix(), e.store.state.Entries["disk"].Notified)
	assert.Empty(t, e.store.state.DigestDay, "the digest was not delivered")
}

// cancelAfterFirst delivers the first message, then simulates SIGTERM.
type cancelAfterFirst struct {
	cancel context.CancelFunc
	calls  int
}

func (n *cancelAfterFirst) Send(ctx context.Context, _ string) error {
	n.calls++
	if n.calls == 1 {
		n.cancel()
		return nil
	}
	return ctx.Err()
}

func TestZeroValuesOfOptionalSettings(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.cfg.ChecksTimeout = 0 // no separate checks deadline; Logger is nil too
	r := runner.New(e.cfg, runner.Deps{
		Cluster: e.cluster, Prober: e.prober, Alerts: e.alerts, Disk: e.disk,
		Store: e.store, Notifier: e.notifier, Clock: fixedClock(e.now),
	})
	_, err := r.Run(t.Context())
	require.NoError(t, err)
}

func TestProbesRunConcurrently(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	const n = 5
	var started sync.WaitGroup
	started.Add(n)
	release := make(chan struct{})
	go func() { started.Wait(); close(release) }()

	e.cfg.Probes = nil
	for i := range n {
		e.cfg.Probes = append(e.cfg.Probes, domain.Probe{Name: fmt.Sprint("p", i), URL: fmt.Sprint("https://p", i)})
	}
	r := runner.New(e.cfg, runner.Deps{
		Cluster: e.cluster, Prober: barrierProber{started: &started, release: release}, Alerts: e.alerts,
		Disk: e.disk, Store: e.store, Notifier: e.notifier, Clock: fixedClock(e.now),
	})
	sum, err := r.Run(t.Context())
	require.NoError(t, err)
	assert.Zero(t, sum.Findings)
}

type barrierProber struct {
	started *sync.WaitGroup
	release chan struct{}
}

func (b barrierProber) Probe(ctx context.Context, _ string) (int, error) {
	b.started.Done()
	select {
	case <-b.release:
		return 200, nil
	case <-ctx.Done():
		return 0, ctx.Err()
	}
}

func TestProbeErrorsAreLoggedAtDebug(t *testing.T) {
	t.Parallel()
	e := healthyEnv()
	e.prober = fakeProber{}
	e.run(t)
	// Probe errors are debug noise; the finding itself is what matters.
	for line := range strings.SplitSeq(strings.TrimSpace(e.logs.String()), "\n") {
		if strings.Contains(line, "probe failed") {
			assert.Contains(t, line, `"level":"DEBUG"`)
		}
	}
}
