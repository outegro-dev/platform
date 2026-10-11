package checks_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/outegro-dev/watchdog-lab/go/internal/checks"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

func TestNodes(t *testing.T) {
	t.Parallel()

	healthy := []domain.Condition{
		{Type: "MemoryPressure", Status: "False"},
		{Type: "DiskPressure", Status: "False"},
		{Type: "PIDPressure", Status: "False"},
		{Type: "Ready", Status: "True", Reason: "KubeletReady"},
	}
	tests := []struct {
		name       string
		conditions []domain.Condition
		want       []domain.Finding
	}{
		{name: "healthy", conditions: healthy},
		{
			name:       "not ready",
			conditions: []domain.Condition{{Type: "Ready", Status: "False", Reason: "KubeletNotReady"}},
			want:       []domain.Finding{{Key: "node:vps:Ready", Message: "node vps: Ready=False (KubeletNotReady)"}},
		},
		{
			name:       "ready unknown",
			conditions: []domain.Condition{{Type: "Ready", Status: "Unknown", Reason: "NodeStatusUnknown"}},
			want:       []domain.Finding{{Key: "node:vps:Ready", Message: "node vps: Ready=Unknown (NodeStatusUnknown)"}},
		},
		{
			name: "disk pressure",
			conditions: []domain.Condition{
				{Type: "DiskPressure", Status: "True", Reason: "KubeletHasDiskPressure"},
				{Type: "Ready", Status: "True"},
			},
			want: []domain.Finding{{Key: "node:vps:DiskPressure", Message: "node vps: DiskPressure=True (KubeletHasDiskPressure)"}},
		},
		{
			name:       "missing reason prints empty parentheses",
			conditions: []domain.Condition{{Type: "MemoryPressure", Status: "True"}},
			want:       []domain.Finding{{Key: "node:vps:MemoryPressure", Message: "node vps: MemoryPressure=True ()"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, checks.Nodes([]domain.Node{{Name: "vps", Conditions: tt.conditions}}))
		})
	}
}

func TestDisk(t *testing.T) {
	t.Parallel()

	tests := []struct {
		pct  int
		want []domain.Finding
	}{
		{pct: 0},
		{pct: 79},
		{pct: 80, want: []domain.Finding{{Key: "disk", Message: "server disk 80% used"}}},
		{pct: 100, want: []domain.Finding{{Key: "disk", Message: "server disk 100% used"}}},
	}
	for _, tt := range tests {
		assert.Equal(t, tt.want, checks.Disk(tt.pct), "pct=%d", tt.pct)
	}
}

func cert(mutate ...func(*domain.Certificate)) domain.Certificate {
	c := domain.Certificate{
		Namespace:  "outegro",
		Name:       "outegro-dev-tls",
		Conditions: []domain.Condition{{Type: "Ready", Status: "True", Message: "Certificate is up to date"}},
		NotAfter:   now.Add(60 * 24 * time.Hour),
	}
	for _, m := range mutate {
		m(&c)
	}
	return c
}

func expiresIn(d time.Duration) func(*domain.Certificate) {
	return func(c *domain.Certificate) { c.NotAfter = now.Add(d) }
}

func TestCertificates(t *testing.T) {
	t.Parallel()

	const day = 24 * time.Hour
	tests := []struct {
		name string
		cert domain.Certificate
		want []domain.Finding
	}{
		{name: "valid for 60 days", cert: cert()},
		{name: "exactly 14 days left", cert: cert(expiresIn(14 * day))},
		{
			name: "one second less than 14 days",
			cert: cert(expiresIn(14*day - time.Second)),
			want: []domain.Finding{{Key: "cert:outegro-dev-tls", Message: "certificate outegro-dev-tls expires in 13 days"}},
		},
		{
			name: "expired an hour ago",
			cert: cert(expiresIn(-time.Hour)),
			want: []domain.Finding{{Key: "cert:outegro-dev-tls", Message: "certificate outegro-dev-tls expires in -1 days"}},
		},
		{
			name: "not ready with message",
			cert: cert(func(c *domain.Certificate) {
				c.Conditions = []domain.Condition{{Type: "Ready", Status: "False", Message: "Issuing certificate as Secret does not exist"}}
			}),
			want: []domain.Finding{{Key: "cert:outegro-dev-tls", Message: "certificate outegro-dev-tls not ready: Issuing certificate as Secret does not exist"}},
		},
		{
			name: "not ready without message",
			cert: cert(func(c *domain.Certificate) { c.Conditions = []domain.Condition{{Type: "Ready", Status: "Unknown"}} }),
			want: []domain.Finding{{Key: "cert:outegro-dev-tls", Message: "certificate outegro-dev-tls not ready: unknown"}},
		},
		{
			name: "no conditions yet",
			cert: cert(func(c *domain.Certificate) { c.Conditions = nil; c.NotAfter = time.Time{} }),
			want: []domain.Finding{{Key: "cert:outegro-dev-tls", Message: "certificate outegro-dev-tls not ready: unknown"}},
		},
		{
			name: "not ready wins over expiry",
			cert: cert(expiresIn(day), func(c *domain.Certificate) { c.Conditions[0].Status = "False" }),
			want: []domain.Finding{{Key: "cert:outegro-dev-tls", Message: "certificate outegro-dev-tls not ready: Certificate is up to date"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, checks.Certificates([]domain.Certificate{tt.cert}, now))
		})
	}
}

func TestCertificatesReadyWithoutNotAfterCountsFromEpoch(t *testing.T) {
	t.Parallel()
	got := checks.Certificates([]domain.Certificate{cert(func(c *domain.Certificate) { c.NotAfter = time.Time{} })}, now)
	assert.Len(t, got, 1)
	assert.Contains(t, got[0].Message, "expires in -")
}

func TestCertDaysLeft(t *testing.T) {
	t.Parallel()

	days, ok := checks.CertDaysLeft(nil, now)
	assert.False(t, ok)
	assert.Zero(t, days)

	certs := []domain.Certificate{
		cert(expiresIn(40 * 24 * time.Hour)),
		cert(expiresIn(20*24*time.Hour + time.Hour)),
		cert(func(c *domain.Certificate) { c.NotAfter = time.Time{} }), // not issued: ignored
	}
	days, ok = checks.CertDaysLeft(certs, now)
	assert.True(t, ok)
	assert.Equal(t, 20, days)
}

func TestPostgresCluster(t *testing.T) {
	t.Parallel()

	ready := []domain.Condition{
		{Type: "Ready", Status: "True"},
		{Type: "ContinuousArchiving", Status: "True"},
		{Type: "LastBackupSucceeded", Status: "True"},
	}
	tests := []struct {
		name    string
		cluster *domain.PGCluster
		want    []domain.Finding
	}{
		{name: "missing", want: []domain.Finding{{Key: "pg:cluster", Message: "PostgreSQL cluster pg is missing"}}},
		{name: "healthy", cluster: &domain.PGCluster{Name: "pg", Conditions: ready}},
		{
			name: "archiving fails",
			cluster: &domain.PGCluster{Name: "pg", Conditions: []domain.Condition{
				{Type: "Ready", Status: "True"},
				{Type: "ContinuousArchiving", Status: "False", Reason: "ContinuousArchivingFailing", Message: "unexpected failure invoking barman-cloud-wal-archive"},
			}},
			want: []domain.Finding{{Key: "pg:ContinuousArchiving", Message: "PostgreSQL ContinuousArchiving: ContinuousArchivingFailing unexpected failure invoking barman-cloud-wal-archive"}},
		},
		{
			name: "two conditions fail",
			cluster: &domain.PGCluster{Name: "pg", Conditions: []domain.Condition{
				{Type: "Ready", Status: "False", Reason: "ClusterIsNotReady", Message: "Cluster Is Not Ready"},
				{Type: "LastBackupSucceeded", Status: "False", Reason: "LastBackupFailed"},
			}},
			want: []domain.Finding{
				{Key: "pg:Ready", Message: "PostgreSQL Ready: ClusterIsNotReady Cluster Is Not Ready"},
				{Key: "pg:LastBackupSucceeded", Message: "PostgreSQL LastBackupSucceeded: LastBackupFailed "},
			},
		},
		{
			name:    "other conditions are ignored",
			cluster: &domain.PGCluster{Name: "pg", Conditions: []domain.Condition{{Type: "PhaseChange", Status: "False"}}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, checks.PostgresCluster(tt.cluster))
		})
	}
}

func TestBackups(t *testing.T) {
	t.Parallel()

	completed := func(d time.Duration) domain.Backup {
		return domain.Backup{Name: "b", Phase: "completed", StoppedAt: ago(d)}
	}
	tests := []struct {
		name    string
		backups []domain.Backup
		want    []domain.Finding
		age     int
		hasAge  bool
	}{
		{
			name: "none at all",
			want: []domain.Finding{{Key: "pg:backup-age", Message: "no completed backup found"}},
		},
		{
			name: "only failed and running",
			backups: []domain.Backup{
				{Name: "f", Phase: "failed", StoppedAt: ago(time.Hour)},
				{Name: "r", Phase: "running"},
				{Name: "c", Phase: "completed"}, // no stoppedAt
			},
			want: []domain.Finding{{Key: "pg:backup-age", Message: "no completed backup found"}},
		},
		{name: "fresh", backups: []domain.Backup{completed(2 * time.Hour)}, age: 2, hasAge: true},
		{name: "25 h 59 min", backups: []domain.Backup{completed(26*time.Hour - time.Minute)}, age: 25, hasAge: true},
		{
			name:    "exactly 26 h",
			backups: []domain.Backup{completed(26 * time.Hour)},
			want:    []domain.Finding{{Key: "pg:backup-age", Message: "last completed backup is 26 h old"}},
			age:     26, hasAge: true,
		},
		{
			name:    "newest one counts",
			backups: []domain.Backup{completed(50 * time.Hour), completed(3 * time.Hour), completed(30 * time.Hour)},
			age:     3, hasAge: true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, age, ok := checks.Backups(tt.backups, now)
			assert.Equal(t, tt.want, got)
			assert.Equal(t, tt.age, age)
			assert.Equal(t, tt.hasAge, ok)
		})
	}
}

func TestArgoApps(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		app  domain.ArgoApp
		want []domain.Finding
	}{
		{name: "synced and healthy", app: domain.ArgoApp{Name: "platform", SyncStatus: "Synced", HealthStatus: "Healthy"}},
		{
			name: "out of sync",
			app:  domain.ArgoApp{Name: "platform", SyncStatus: "OutOfSync", HealthStatus: "Healthy"},
			want: []domain.Finding{{Key: "argo:platform", Message: "Argo CD platform: OutOfSync / Healthy"}},
		},
		{
			name: "degraded",
			app:  domain.ArgoApp{Name: "platform", SyncStatus: "Synced", HealthStatus: "Degraded"},
			want: []domain.Finding{{Key: "argo:platform", Message: "Argo CD platform: Synced / Degraded"}},
		},
		{
			name: "no status yet",
			app:  domain.ArgoApp{Name: "new-app"},
			want: []domain.Finding{{Key: "argo:new-app", Message: "Argo CD new-app: ? / ?"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, checks.ArgoApps([]domain.ArgoApp{tt.app}))
		})
	}
}

func TestProbes(t *testing.T) {
	t.Parallel()

	probe := domain.Probe{Name: "id", URL: "https://id.outegro.dev/health"}
	tests := []struct {
		name string
		code int
		want []domain.Finding
	}{
		{name: "200", code: 200},
		{name: "503", code: 503, want: []domain.Finding{{Key: "http:id", Message: "https://id.outegro.dev/health answered 503"}}},
		{name: "redirect", code: 301, want: []domain.Finding{{Key: "http:id", Message: "https://id.outegro.dev/health answered 301"}}},
		{name: "no response", code: 0, want: []domain.Finding{{Key: "http:id", Message: "https://id.outegro.dev/health answered no response"}}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, checks.Probes([]domain.ProbeResult{{Probe: probe, Code: tt.code}}))
		})
	}
}
