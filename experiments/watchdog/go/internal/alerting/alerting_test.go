package alerting_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/outegro-dev/watchdog-lab/go/internal/alerting"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

// t0 is 05:00 UTC, before the digest hour, so most tests see no digest.
var t0 = time.Date(2026, 10, 10, 5, 0, 0, 0, time.UTC)

func f(key, msg string) domain.Finding { return domain.Finding{Key: key, Message: msg} }

func state(entries map[string]domain.Entry) *domain.State {
	return &domain.State{Version: 1, DigestDay: "20261010", Entries: entries}
}

func kinds(o alerting.Outcome) []alerting.Kind {
	out := make([]alerting.Kind, 0, len(o.Messages))
	for _, m := range o.Messages {
		out = append(out, m.Kind)
	}
	return out
}

func texts(o alerting.Outcome) []string {
	out := make([]string, 0, len(o.Messages))
	for _, m := range o.Messages {
		out = append(out, m.Text)
	}
	return out
}

func allDelivered(o alerting.Outcome) []bool {
	d := make([]bool, len(o.Messages))
	for i := range d {
		d[i] = true
	}
	return d
}

func TestFirstRun(t *testing.T) {
	t.Parallel()

	o := alerting.Plan(nil, []domain.Finding{
		f("disk", "server disk 91% used"),
		f("argo:platform", "Argo CD platform: OutOfSync / Healthy"),
	}, domain.Facts{}, t0)

	assert.Equal(t, []string{
		"👋 outegro.dev watchdog is on duty: pods, nodes, disk, certificates, backups, Argo CD and health checks every 5 minutes.",
		"🔴 outegro.dev: problem\n• server disk 91% used",
	}, texts(o))
	assert.Equal(t, 2, o.Failing)

	next := alerting.Apply(o, allDelivered(o))
	assert.Equal(t, domain.State{
		Version: 1,
		Entries: map[string]domain.Entry{
			"argo:platform": {Since: t0.Unix(), Notified: 0, Message: "Argo CD platform: OutOfSync / Healthy"},
			"disk":          {Since: t0.Unix(), Notified: t0.Unix(), Message: "server disk 91% used"},
		},
	}, next)
}

func TestFirstRunWithoutFindings(t *testing.T) {
	t.Parallel()
	o := alerting.Plan(nil, nil, domain.Facts{}, t0)
	assert.Equal(t, []alerting.Kind{alerting.Greeting}, kinds(o))
	next := alerting.Apply(o, allDelivered(o))
	assert.Equal(t, domain.NewState(), next)
}

func TestGrace(t *testing.T) {
	t.Parallel()

	tests := []struct {
		key     string
		elapsed time.Duration
		alerted bool
	}{
		{key: "argo:platform", elapsed: 899 * time.Second},
		{key: "argo:platform", elapsed: 900 * time.Second, alerted: true},
		{key: "http:id", elapsed: 239 * time.Second},
		{key: "http:id", elapsed: 240 * time.Second, alerted: true},
		{key: "prom:api", elapsed: 899 * time.Second},
		{key: "prom:api", elapsed: 900 * time.Second, alerted: true},
		{key: "prom:apiDown:x", elapsed: 0, alerted: true}, // only prom:api itself has grace
		{key: "pod:outegro/auth", elapsed: 0, alerted: true},
		{key: "disk", elapsed: 0, alerted: true},
	}
	for _, tt := range tests {
		t.Run(tt.key+"/"+tt.elapsed.String(), func(t *testing.T) {
			t.Parallel()
			now := t0.Add(tt.elapsed)
			prev := state(map[string]domain.Entry{tt.key: {Since: t0.Unix(), Message: "m"}})
			if tt.elapsed == 0 {
				prev = state(nil) // a brand-new finding
			}
			o := alerting.Plan(prev, []domain.Finding{f(tt.key, "m")}, domain.Facts{}, now)
			if tt.alerted {
				assert.Equal(t, []string{"🔴 outegro.dev: problem\n• m"}, texts(o))
			} else {
				assert.Empty(t, o.Messages)
			}
			assert.Equal(t, t0.Unix(), alerting.Apply(o, allDelivered(o)).Entries[tt.key].Since, "since is kept")
		})
	}
}

func TestGraceDurations(t *testing.T) {
	t.Parallel()
	assert.Equal(t, 15*time.Minute, alerting.Grace("argo:x"))
	assert.Equal(t, 4*time.Minute, alerting.Grace("http:x"))
	assert.Equal(t, 15*time.Minute, alerting.Grace("prom:api"))
	assert.Equal(t, time.Duration(0), alerting.Grace("prom:KubeJobFailed:outegro"))
	assert.Equal(t, time.Duration(0), alerting.Grace("cert:x"))
}

func TestReminder(t *testing.T) {
	t.Parallel()

	notified := t0.Add(-time.Hour)
	prev := state(map[string]domain.Entry{"disk": {Since: t0.Add(-2 * time.Hour).Unix(), Notified: notified.Unix(), Message: "old"}})

	early := alerting.Plan(prev, []domain.Finding{f("disk", "server disk 92% used")}, domain.Facts{}, notified.Add(6*time.Hour-time.Second))
	assert.Empty(t, early.Messages, "no reminder before 6 h")
	assert.Equal(t, notified.Unix(), alerting.Apply(early, nil).Entries["disk"].Notified)
	assert.Equal(t, "server disk 92% used", alerting.Apply(early, nil).Entries["disk"].Message, "message follows the latest finding")

	due := notified.Add(6 * time.Hour)
	o := alerting.Plan(prev, []domain.Finding{f("disk", "server disk 92% used")}, domain.Facts{}, due)
	assert.Equal(t, []string{"🟠 outegro.dev: still failing\n• server disk 92% used"}, texts(o))
	next := alerting.Apply(o, allDelivered(o))
	assert.Equal(t, due.Unix(), next.Entries["disk"].Notified)
	assert.Equal(t, prev.Entries["disk"].Since, next.Entries["disk"].Since)
}

func TestRecovery(t *testing.T) {
	t.Parallel()

	prev := state(map[string]domain.Entry{
		"disk":          {Since: 1, Notified: 2, Message: "server disk 91% used"},
		"cert:tls":      {Since: 1, Notified: 3, Message: "certificate tls expires in 3 days"},
		"argo:platform": {Since: t0.Unix() - 60, Notified: 0, Message: "Argo CD platform: OutOfSync / Healthy"},
	})
	o := alerting.Plan(prev, nil, domain.Facts{}, t0)

	// Sorted by key; the never-reported Argo CD entry disappears silently.
	assert.Equal(t, []string{"🟢 outegro.dev: recovered\n• certificate tls expires in 3 days\n• server disk 91% used"}, texts(o))
	assert.Empty(t, alerting.Apply(o, allDelivered(o)).Entries)
}

func TestFailedRecoveryIsRetried(t *testing.T) {
	t.Parallel()

	prev := state(map[string]domain.Entry{"disk": {Since: 1, Notified: 2, Message: "server disk 91% used"}})
	o := alerting.Plan(prev, nil, domain.Facts{}, t0)
	require.Equal(t, []alerting.Kind{alerting.Recovered}, kinds(o))

	next := alerting.Apply(o, []bool{false})
	assert.Equal(t, prev.Entries, next.Entries, "kept so the next pass reports the recovery again")

	again := alerting.Plan(&next, nil, domain.Facts{}, t0.Add(5*time.Minute))
	assert.Equal(t, []alerting.Kind{alerting.Recovered}, kinds(again))
}

func TestFailedSendKeepsNotified(t *testing.T) {
	t.Parallel()

	prev := state(map[string]domain.Entry{"cert:tls": {Since: 1, Notified: 2, Message: "c"}})
	now := time.Unix(2, 0).Add(7 * time.Hour)
	o := alerting.Plan(prev, []domain.Finding{f("disk", "d"), f("cert:tls", "c")}, domain.Facts{}, now)
	require.Equal(t, []alerting.Kind{alerting.Problem, alerting.Reminder, alerting.Digest}, kinds(o))

	next := alerting.Apply(o, []bool{false, false, false})
	assert.Equal(t, int64(0), next.Entries["disk"].Notified, "problem not delivered")
	assert.Equal(t, int64(2), next.Entries["cert:tls"].Notified, "reminder not delivered")
	assert.Equal(t, "20261010", next.DigestDay, "digest day unchanged")

	retry := alerting.Plan(&next, []domain.Finding{f("disk", "d"), f("cert:tls", "c")}, domain.Facts{}, now.Add(5*time.Minute))
	assert.Equal(t, []alerting.Kind{alerting.Problem, alerting.Reminder, alerting.Digest}, kinds(retry), "everything is retried")

	partial := alerting.Apply(o, []bool{true}) // shorter slice: the rest count as not delivered
	assert.Equal(t, now.Unix(), partial.Entries["disk"].Notified)
	assert.Equal(t, int64(2), partial.Entries["cert:tls"].Notified)
}

func TestDigest(t *testing.T) {
	t.Parallel()

	facts := domain.Facts{
		PodsRunning:     domain.Ptr(42),
		BackupAgeHours:  domain.Ptr(5),
		CertDaysLeft:    domain.Ptr(61),
		DiskUsedPercent: domain.Ptr(37),
	}
	at7 := time.Date(2026, 10, 11, 7, 0, 0, 0, time.UTC)

	t.Run("before 07:00 UTC", func(t *testing.T) {
		t.Parallel()
		o := alerting.Plan(state(nil), nil, facts, at7.Add(-time.Second))
		assert.Empty(t, o.Messages)
	})
	t.Run("at 07:00 UTC, all good", func(t *testing.T) {
		t.Parallel()
		o := alerting.Plan(state(nil), nil, facts, at7)
		assert.Equal(t, []string{"☀️ outegro.dev daily: All checks pass.\nPods running: 42\nLast backup: 5 h ago\nCertificate: 61 days left\nDisk: 37% used"}, texts(o))
		assert.Equal(t, "20261011", alerting.Apply(o, allDelivered(o)).DigestDay)
	})
	t.Run("once per day", func(t *testing.T) {
		t.Parallel()
		prev := &domain.State{Version: 1, DigestDay: "20261011"}
		assert.Empty(t, alerting.Plan(prev, nil, facts, at7.Add(10*time.Hour)).Messages)
	})
	t.Run("next day again", func(t *testing.T) {
		t.Parallel()
		prev := &domain.State{Version: 1, DigestDay: "20261011"}
		o := alerting.Plan(prev, nil, facts, at7.Add(24*time.Hour))
		assert.Equal(t, []alerting.Kind{alerting.Digest}, kinds(o))
	})
	t.Run("failing checks and unknown facts", func(t *testing.T) {
		t.Parallel()
		prev := state(map[string]domain.Entry{"argo:a": {Since: at7.Unix(), Message: "a"}})
		o := alerting.Plan(prev, []domain.Finding{f("argo:a", "a"), f("http:b", "b")}, domain.Facts{}, at7)
		assert.Equal(t, []string{"☀️ outegro.dev daily: Failing checks: 2.\nPods running: ?\nLast backup: ? h ago\nCertificate: ? days left\nDisk: ?% used"}, texts(o),
			"findings still in grace count as failing")
	})
	t.Run("uses the UTC hour", func(t *testing.T) {
		t.Parallel()
		moscow := time.FixedZone("MSK", 3*60*60)
		o := alerting.Plan(state(nil), nil, facts, time.Date(2026, 10, 11, 9, 0, 0, 0, moscow)) // 06:00 UTC
		assert.Empty(t, o.Messages)
	})
}

func TestMessageOrder(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC)
	o := alerting.Plan(nil, []domain.Finding{f("disk", "d")}, domain.Facts{}, now)
	assert.Equal(t, []alerting.Kind{alerting.Greeting, alerting.Problem, alerting.Digest}, kinds(o))

	prev := &domain.State{Version: 1, Entries: map[string]domain.Entry{
		"cert:x":  {Since: 1, Notified: 1, Message: "x"},
		"gone":    {Since: 1, Notified: 1, Message: "gone"},
		"node:vp": {Since: now.Unix(), Message: "n"},
	}}
	o = alerting.Plan(prev, []domain.Finding{f("cert:x", "x"), f("node:vp", "n"), f("disk", "d")}, domain.Facts{}, now)
	assert.Equal(t, []alerting.Kind{alerting.Problem, alerting.Reminder, alerting.Recovered, alerting.Digest}, kinds(o))
	assert.Equal(t, "🔴 outegro.dev: problem\n• d\n• n", o.Messages[0].Text, "lines sorted by key")
}

func TestDuplicateKeysKeepFirst(t *testing.T) {
	t.Parallel()

	o := alerting.Plan(state(nil), []domain.Finding{
		f("pod:outegro/auth", "outegro/auth-1: CrashLoopBackOff"),
		f("pod:outegro/auth", "outegro/auth-2: CrashLoopBackOff"),
	}, domain.Facts{}, t0)
	assert.Equal(t, []string{"🔴 outegro.dev: problem\n• outegro/auth-1: CrashLoopBackOff"}, texts(o))
	assert.Equal(t, 1, o.Failing)
}

func TestSecondPassSendsNothing(t *testing.T) {
	t.Parallel()

	findings := []domain.Finding{f("disk", "d"), f("http:id", "i")}
	first := alerting.Plan(nil, findings, domain.Facts{}, t0)
	st := alerting.Apply(first, allDelivered(first))

	second := alerting.Plan(&st, findings, domain.Facts{}, t0.Add(time.Minute))
	assert.Empty(t, second.Messages)
	assert.Equal(t, st, alerting.Apply(second, nil))
}

func TestPlanDoesNotModifyPrev(t *testing.T) {
	t.Parallel()

	prev := state(map[string]domain.Entry{
		"disk": {Since: 1, Notified: 2, Message: "old"},
		"gone": {Since: 1, Notified: 2, Message: "gone"},
	})
	snapshot := prev.Clone()
	o := alerting.Plan(prev, []domain.Finding{f("disk", "new"), f("cert:x", "x")}, domain.Facts{}, t0.Add(24*time.Hour))
	_ = alerting.Apply(o, allDelivered(o))
	assert.Equal(t, snapshot, *prev)
}

func TestApplyIsRepeatable(t *testing.T) {
	t.Parallel()

	o := alerting.Plan(nil, []domain.Finding{f("disk", "d")}, domain.Facts{}, t0)
	a := alerting.Apply(o, allDelivered(o))
	b := alerting.Apply(o, nil)
	assert.Equal(t, t0.Unix(), a.Entries["disk"].Notified)
	assert.Equal(t, int64(0), b.Entries["disk"].Notified, "Apply does not mutate the outcome")
}
