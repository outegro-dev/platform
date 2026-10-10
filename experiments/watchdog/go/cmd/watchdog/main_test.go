package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	typedcorev1 "k8s.io/client-go/kubernetes/typed/core/v1"
	k8stesting "k8s.io/client-go/testing"

	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/clock"
	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/kube"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

// This is the full-pass integration test: the real adapters run against
// client-go fakes and httptest servers standing in for the probed
// services, Prometheus and the Telegram Bot API. Nothing leaves the
// process.

const token = "987654:AAF-integration-secret"

var start = time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC)

type fakeDisk int

func (d fakeDisk) UsedPercent() (int, error) { return int(d), nil }

// telegramStub records sendMessage calls.
type telegramStub struct {
	srv    *httptest.Server
	mu     sync.Mutex
	texts  []string
	paths  []string
	status int
}

func newTelegram(t *testing.T) *telegramStub {
	t.Helper()
	tg := &telegramStub{status: http.StatusOK}
	tg.srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			ChatID string `json:"chat_id"`
			Text   string `json:"text"`
		}
		_ = json.NewDecoder(r.Body).Decode(&body)
		tg.mu.Lock()
		defer tg.mu.Unlock()
		tg.paths = append(tg.paths, r.URL.Path)
		if tg.status != http.StatusOK {
			w.WriteHeader(tg.status)
			_, _ = w.Write([]byte(`{"ok":false,"description":"Internal Server Error"}`))
			return
		}
		tg.texts = append(tg.texts, body.Text)
		_, _ = w.Write([]byte(`{"ok":true,"result":{}}`))
	}))
	t.Cleanup(tg.srv.Close)
	return tg
}

// take returns and clears the delivered texts.
func (tg *telegramStub) take() []string {
	tg.mu.Lock()
	defer tg.mu.Unlock()
	out := tg.texts
	tg.texts = nil
	return out
}

func (tg *telegramStub) hits() int {
	tg.mu.Lock()
	defer tg.mu.Unlock()
	return len(tg.paths)
}

type harness struct {
	core      *fake.Clientset
	dyn       *dynamicfake.FakeDynamicClient
	telegram  *telegramStub
	prom      *httptest.Server
	probes    *httptest.Server
	now       time.Time
	kubeCalls int
	kubeErr   error
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	h := &harness{now: start, telegram: newTelegram(t)}

	h.core = fake.NewClientset(
		crashingPod(),
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: "coredns-1", Labels: map[string]string{"k8s-app": "kube-dns"}, CreationTimestamp: metav1.NewTime(start.Add(-72 * time.Hour))},
			Status:     corev1.PodStatus{Phase: corev1.PodRunning, Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionTrue}}},
		},
		&corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Namespace: "outegro", Name: "migrate-abc", OwnerReferences: []metav1.OwnerReference{{Kind: "Job", Name: "migrate"}}},
			Status:     corev1.PodStatus{Phase: corev1.PodSucceeded},
		},
		&corev1.Node{
			ObjectMeta: metav1.ObjectMeta{Name: "vps"},
			Status:     corev1.NodeStatus{Conditions: []corev1.NodeCondition{{Type: corev1.NodeReady, Status: corev1.ConditionTrue}, {Type: corev1.NodeDiskPressure, Status: corev1.ConditionFalse}}},
		},
	)

	ready := func(t string) map[string]any { return map[string]any{"type": t, "status": "True"} }
	h.dyn = dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{
		kube.CertificatesGVR: "CertificateList",
		kube.ClustersGVR:     "ClusterList",
		kube.BackupsGVR:      "BackupList",
		kube.ApplicationsGVR: "ApplicationList",
	},
		crd("cert-manager.io/v1", "Certificate", "outegro", "outegro-dev-tls", map[string]any{
			"notAfter":   start.Add(30 * 24 * time.Hour).Format(time.RFC3339),
			"conditions": []any{ready("Ready")},
		}),
		crd("postgresql.cnpg.io/v1", "Cluster", "outegro", "pg", map[string]any{
			"conditions": []any{ready("Ready"), ready("ContinuousArchiving"), ready("LastBackupSucceeded")},
		}),
		crd("postgresql.cnpg.io/v1", "Backup", "outegro", "pg-nightly", map[string]any{
			"phase": "completed", "stoppedAt": start.Add(-3 * time.Hour).Format(time.RFC3339),
		}),
		crd("argoproj.io/v1alpha1", "Application", "argocd", "platform", map[string]any{
			"sync": map[string]any{"status": "OutOfSync"}, "health": map[string]any{"status": "Healthy"},
		}),
		crd("argoproj.io/v1alpha1", "Application", "argocd", "monitoring", map[string]any{
			"sync": map[string]any{"status": "Synced"}, "health": map[string]any{"status": "Healthy"},
		}),
	)

	h.prom = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success","data":{"alerts":[
			{"labels":{"alertname":"KubeJobFailed","severity":"critical","namespace":"outegro","job_name":"migrate"},
			 "annotations":{"summary":"Job outegro/migrate failed"},"state":"firing","activeAt":"2026-10-10T07:00:00Z","value":"1"},
			{"labels":{"alertname":"Watchdog","severity":"none"},"annotations":{},"state":"firing","activeAt":"2026-10-01T00:00:00Z","value":"1"}
		]}}`))
	}))
	t.Cleanup(h.prom.Close)

	h.probes = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/ok" {
			w.WriteHeader(http.StatusServiceUnavailable)
		}
	}))
	t.Cleanup(h.probes.Close)
	return h
}

func crashingPod() *corev1.Pod {
	return &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "outegro", Name: "auth-backend-5f6d-x", Labels: map[string]string{"app": "auth-backend"}, CreationTimestamp: metav1.NewTime(start.Add(-time.Hour))},
		Status: corev1.PodStatus{
			Phase:             corev1.PodRunning,
			Conditions:        []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse, LastTransitionTime: metav1.NewTime(start.Add(-2 * time.Minute))}},
			ContainerStatuses: []corev1.ContainerStatus{{Name: "app", State: corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}}}},
		},
	}
}

func crd(apiVersion, kind, namespace, name string, status map[string]any) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiVersion, "kind": kind,
		"metadata": map[string]any{"namespace": namespace, "name": name},
		"status":   status,
	}}
}

func (h *harness) env(extra map[string]string) map[string]string {
	e := map[string]string{
		"TELEGRAM_BOT_TOKEN": token,
		"TELEGRAM_CHAT_ID":   "42",
		"TELEGRAM_API_URL":   h.telegram.srv.URL,
		"PROMETHEUS_URL":     h.prom.URL,
		"PROBES":             "landing=" + h.probes.URL + "/ok,id=" + h.probes.URL + "/ok",
		"RUN_TIMEOUT":        "20s",
		"HTTP_TIMEOUT":       "2s",
		"LOG_LEVEL":          "debug",
	}
	for k, v := range extra {
		e[k] = v
	}
	return e
}

func (h *harness) platform() platform {
	return platform{
		newKube: func(string) (typedcorev1.CoreV1Interface, dynamic.Interface, error) {
			h.kubeCalls++
			if h.kubeErr != nil {
				return nil, nil, h.kubeErr
			}
			return h.core.CoreV1(), h.dyn, nil
		},
		newDisk: func(string) ports.DiskStat { return fakeDisk(42) },
		clock:   clock.Fixed(h.now),
	}
}

type result struct {
	code   int
	stdout string
	stderr string
}

func (h *harness) run(t *testing.T, env map[string]string) result {
	t.Helper()
	return h.runCtx(t.Context(), env)
}

func (h *harness) runCtx(ctx context.Context, env map[string]string) result {
	var stdout, stderr bytes.Buffer
	code := run(ctx, env, &stdout, &stderr, h.platform())
	return result{code: code, stdout: stdout.String(), stderr: stderr.String()}
}

func (h *harness) storedState(t *testing.T) domain.State {
	t.Helper()
	cm, err := h.core.CoreV1().ConfigMaps("outegro").Get(t.Context(), "watchdog-state-v2", metav1.GetOptions{})
	require.NoError(t, err)
	st, err := domain.DecodeState([]byte(cm.Data[kube.StateKey]))
	require.NoError(t, err)
	return st
}

// lastLog parses the final JSON log line.
func lastLog(t *testing.T, stderr string) map[string]any {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(stderr), "\n")
	var entry map[string]any
	require.NoError(t, json.Unmarshal([]byte(lines[len(lines)-1]), &entry), "every log line is JSON")
	return entry
}

func assertJSONLogs(t *testing.T, stderr string) {
	t.Helper()
	for line := range strings.SplitSeq(strings.TrimSpace(stderr), "\n") {
		var entry map[string]any
		require.NoError(t, json.Unmarshal([]byte(line), &entry), "not JSON: %s", line)
		assert.Contains(t, entry, "level")
		assert.Contains(t, entry, "msg")
	}
	assert.NotContains(t, stderr, token, "the token never reaches the logs")
}

const (
	greeting = "👋 outegro.dev watchdog is on duty: pods, nodes, disk, certificates, backups, Argo CD and health checks every 5 minutes."
)

func TestFullPassLifecycle(t *testing.T) {
	h := newHarness(t)

	// Pass 1, 08:00: first run.
	res := h.run(t, h.env(nil))
	require.Equal(t, exitOK, res.code, res.stderr)
	assertJSONLogs(t, res.stderr)
	assert.Empty(t, res.stdout)
	assert.Equal(t, []string{
		greeting,
		"🔴 outegro.dev: problem" +
			"\n• outegro/auth-backend-5f6d-x: CrashLoopBackOff" +
			"\n• KubeJobFailed (critical): Job outegro/migrate failed",
		"☀️ outegro.dev daily: Failing checks: 3." +
			"\nPods running: 2\nLast backup: 3 h ago\nCertificate: 30 days left\nDisk: 42% used",
	}, h.telegram.take())
	assert.Equal(t, "/bot"+token+"/sendMessage", h.telegram.paths[0])

	st := h.storedState(t)
	assert.Equal(t, "20261010", st.DigestDay)
	assert.Equal(t, domain.Entry{Since: start.Unix(), Notified: start.Unix(), Message: "outegro/auth-backend-5f6d-x: CrashLoopBackOff"}, st.Entries["pod:outegro/auth-backend"])
	assert.Equal(t, domain.Entry{Since: start.Unix(), Notified: 0, Message: "Argo CD platform: OutOfSync / Healthy"}, st.Entries["argo:platform"], "in grace")
	assert.Contains(t, st.Entries, "prom:KubeJobFailed:migrate/outegro")
	assert.Len(t, st.Entries, 3)

	summary := lastLog(t, res.stderr)
	assert.Equal(t, "pass complete", summary["msg"])
	assert.InDelta(t, 3, summary["findings"], 0)
	assert.InDelta(t, 3, summary["sent"], 0)
	assert.Contains(t, summary, "duration")

	// Pass 2, 08:05: nothing changed, nothing is sent.
	h.now = start.Add(5 * time.Minute)
	res = h.run(t, h.env(nil))
	require.Equal(t, exitOK, res.code, res.stderr)
	assert.Empty(t, h.telegram.take())
	assert.Equal(t, st, h.storedState(t), "state is stable")
	assert.InDelta(t, 0, lastLog(t, res.stderr)["sent"], 0)

	// Pass 3, 08:15: the pod is fixed, Argo CD is still out of sync after
	// its 15 minute grace.
	fixed := crashingPod()
	fixed.Status.ContainerStatuses[0].State = corev1.ContainerState{Running: &corev1.ContainerStateRunning{}}
	fixed.Status.Conditions[0].Status = corev1.ConditionTrue
	_, err := h.core.CoreV1().Pods("outegro").UpdateStatus(t.Context(), fixed, metav1.UpdateOptions{})
	require.NoError(t, err)

	h.now = start.Add(15 * time.Minute)
	res = h.run(t, h.env(nil))
	require.Equal(t, exitOK, res.code, res.stderr)
	assert.Equal(t, []string{
		"🔴 outegro.dev: problem\n• Argo CD platform: OutOfSync / Healthy",
		"🟢 outegro.dev: recovered\n• outegro/auth-backend-5f6d-x: CrashLoopBackOff",
	}, h.telegram.take())
	st = h.storedState(t)
	assert.NotContains(t, st.Entries, "pod:outegro/auth-backend")
	assert.Equal(t, h.now.Unix(), st.Entries["argo:platform"].Notified)
}

func TestDryRun(t *testing.T) {
	h := newHarness(t)

	env := h.env(map[string]string{"DRY_RUN": "true"})
	delete(env, "TELEGRAM_BOT_TOKEN")
	delete(env, "TELEGRAM_CHAT_ID")

	res := h.run(t, env)
	require.Equal(t, exitOK, res.code, res.stderr)
	assert.Zero(t, h.telegram.hits(), "dry run never calls Telegram")
	assert.Contains(t, res.stdout, "----- dry run: telegram message -----\n"+greeting+"\n")
	assert.Contains(t, res.stdout, "🔴 outegro.dev: problem\n• outegro/auth-backend-5f6d-x: CrashLoopBackOff")
	assert.Contains(t, res.stdout, "☀️ outegro.dev daily: Failing checks: 3.")

	_, err := h.core.CoreV1().ConfigMaps("outegro").Get(t.Context(), "watchdog-state-v2", metav1.GetOptions{})
	assert.True(t, apierrors.IsNotFound(err), "dry run does not write the state")
	assert.Contains(t, res.stderr, "dry run: state not saved")
	assert.Contains(t, res.stderr, `"msg":"findings collected","count":3,"keys":["argo:platform","pod:outegro/auth-backend","prom:KubeJobFailed:migrate/outegro"]`,
		"findings in grace are visible in the log even though dry run never reports them")
	assert.Equal(t, true, lastLog(t, res.stderr)["dryRun"])
}

func TestConfigErrorExitsTwoBeforeAnyRequest(t *testing.T) {
	h := newHarness(t)
	env := h.env(nil)
	delete(env, "TELEGRAM_BOT_TOKEN")

	res := h.run(t, env)
	assert.Equal(t, exitConfig, res.code)
	assert.Zero(t, h.kubeCalls, "no Kubernetes client is created")
	assert.Zero(t, h.telegram.hits())
	assert.Contains(t, res.stderr, "TELEGRAM_BOT_TOKEN is required")
	assert.Equal(t, "invalid configuration", lastLog(t, res.stderr)["msg"])
}

func TestBadDurationExitsTwo(t *testing.T) {
	h := newHarness(t)
	res := h.run(t, h.env(map[string]string{"RUN_TIMEOUT": "soon"}))
	assert.Equal(t, exitConfig, res.code)
	assert.Zero(t, h.kubeCalls)
}

func TestKubernetesClientErrorExitsOne(t *testing.T) {
	h := newHarness(t)
	h.kubeErr = errors.New("no kubeconfig")
	res := h.run(t, h.env(nil))
	assert.Equal(t, exitFailure, res.code)
	assert.Contains(t, res.stderr, "cannot create the kubernetes client")
	assert.Zero(t, h.telegram.hits())
}

func TestStateReadErrorExitsOne(t *testing.T) {
	h := newHarness(t)
	h.core.PrependReactor("get", "configmaps", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(schema.GroupResource{Resource: "configmaps"}, "watchdog-state-v2", errors.New("RBAC"))
	})
	res := h.run(t, h.env(nil))
	assert.Equal(t, exitFailure, res.code)
	assert.Zero(t, h.telegram.hits(), "nothing is sent when the state cannot be read")
	entry := lastLog(t, res.stderr)
	assert.Equal(t, "pass failed", entry["msg"])
	assert.Contains(t, entry["error"], "load state")
}

func TestTelegramFailureStillExitsZero(t *testing.T) {
	h := newHarness(t)
	h.telegram.status = http.StatusInternalServerError

	res := h.run(t, h.env(nil))
	require.Equal(t, exitOK, res.code, res.stderr)
	assertJSONLogs(t, res.stderr)
	assert.Contains(t, res.stderr, "message not delivered")
	entry := lastLog(t, res.stderr)
	assert.InDelta(t, 3, entry["failedSends"], 0)
	assert.InDelta(t, 0, entry["sent"], 0)

	st := h.storedState(t)
	assert.Equal(t, int64(0), st.Entries["pod:outegro/auth-backend"].Notified, "retried next pass")
	assert.Empty(t, st.DigestDay)

	// Telegram is back: the next pass delivers what was missed. The
	// greeting is not repeated: the state exists now.
	h.telegram.status = http.StatusOK
	h.now = start.Add(5 * time.Minute)
	res = h.run(t, h.env(nil))
	require.Equal(t, exitOK, res.code)
	sent := h.telegram.take()
	require.Len(t, sent, 2)
	assert.True(t, strings.HasPrefix(sent[0], "🔴 outegro.dev: problem"))
	assert.True(t, strings.HasPrefix(sent[1], "☀️ outegro.dev daily"))
}

func TestUnreachableTelegramMasksTheToken(t *testing.T) {
	h := newHarness(t)
	dead := httptest.NewServer(http.NotFoundHandler())
	dead.Close()

	res := h.run(t, h.env(map[string]string{"TELEGRAM_API_URL": dead.URL}))
	require.Equal(t, exitOK, res.code)
	assertJSONLogs(t, res.stderr)
	assert.Contains(t, res.stderr, "/bot***/sendMessage")
}

func TestInterruptedPassExitsOneAndWritesNothing(t *testing.T) {
	h := newHarness(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel() // SIGTERM before the pass starts its checks

	res := h.runCtx(ctx, h.env(nil))
	assert.Equal(t, exitFailure, res.code)
	assert.Zero(t, h.telegram.hits())
	_, err := h.core.CoreV1().ConfigMaps("outegro").Get(t.Context(), "watchdog-state-v2", metav1.GetOptions{})
	assert.True(t, apierrors.IsNotFound(err))
	assert.Contains(t, fmt.Sprint(lastLog(t, res.stderr)["error"]), "pass interrupted")
}

func TestToDomainProbes(t *testing.T) {
	assert.Empty(t, toDomainProbes(nil))
}
