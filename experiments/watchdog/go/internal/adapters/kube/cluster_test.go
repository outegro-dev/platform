package kube_test

import (
	"errors"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/kube"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

var ts = time.Date(2026, 10, 10, 11, 0, 0, 0, time.UTC)

func newDynamic(objs ...runtime.Object) *dynamicfake.FakeDynamicClient {
	return dynamicfake.NewSimpleDynamicClientWithCustomListKinds(runtime.NewScheme(), map[schema.GroupVersionResource]string{
		kube.CertificatesGVR: "CertificateList",
		kube.ClustersGVR:     "ClusterList",
		kube.BackupsGVR:      "BackupList",
		kube.ApplicationsGVR: "ApplicationList",
	}, objs...)
}

func object(apiVersion, kind, namespace, name string, status map[string]any) *unstructured.Unstructured {
	return &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": apiVersion,
		"kind":       kind,
		"metadata":   map[string]any{"name": name, "namespace": namespace},
		"status":     status,
	}}
}

func TestPodsAreMapped(t *testing.T) {
	t.Parallel()

	core := fake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:         "outegro",
			Name:              "migrate-x1",
			Labels:            map[string]string{"app": "migrate"},
			CreationTimestamp: metav1.NewTime(ts),
			OwnerReferences:   []metav1.OwnerReference{{Kind: "Job", Name: "migrate"}},
		},
		Status: corev1.PodStatus{
			Phase:      corev1.PodRunning,
			Conditions: []corev1.PodCondition{{Type: corev1.PodReady, Status: corev1.ConditionFalse, Reason: "ContainersNotReady", LastTransitionTime: metav1.NewTime(ts)}},
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:                 "app",
				State:                corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "CrashLoopBackOff"}},
				LastTerminationState: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "OOMKilled", FinishedAt: metav1.NewTime(ts)}},
			}},
		},
	}, &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "kube-system", Name: "coredns"}})

	pods, err := kube.NewCluster(core.CoreV1(), newDynamic()).Pods(t.Context())
	require.NoError(t, err)
	require.Len(t, pods, 2)

	var got domain.Pod
	for _, p := range pods {
		if p.Name == "migrate-x1" {
			got = p
		}
	}
	assert.Equal(t, domain.Pod{
		Namespace:  "outegro",
		Name:       "migrate-x1",
		Labels:     map[string]string{"app": "migrate"},
		Phase:      "Running",
		OwnerKinds: []string{"Job"},
		CreatedAt:  ts,
		Conditions: []domain.Condition{{Type: "Ready", Status: "False", Reason: "ContainersNotReady", LastTransitionTime: ts}},
		Containers: []domain.ContainerStatus{{Name: "app", WaitingReason: "CrashLoopBackOff", LastTerminationReason: "OOMKilled", LastTerminationAt: ts}},
	}, got)
}

func TestNodesAreMapped(t *testing.T) {
	t.Parallel()

	core := fake.NewClientset(&corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "vps"},
		Status: corev1.NodeStatus{Conditions: []corev1.NodeCondition{
			{Type: corev1.NodeMemoryPressure, Status: corev1.ConditionFalse, Reason: "KubeletHasSufficientMemory"},
			{Type: corev1.NodeReady, Status: corev1.ConditionTrue, Reason: "KubeletReady", Message: "kubelet is posting ready status"},
		}},
	})
	nodes, err := kube.NewCluster(core.CoreV1(), newDynamic()).Nodes(t.Context())
	require.NoError(t, err)
	assert.Equal(t, []domain.Node{{Name: "vps", Conditions: []domain.Condition{
		{Type: "MemoryPressure", Status: "False", Reason: "KubeletHasSufficientMemory"},
		{Type: "Ready", Status: "True", Reason: "KubeletReady", Message: "kubelet is posting ready status"},
	}}}, nodes)
}

func TestListErrorsAreWrapped(t *testing.T) {
	t.Parallel()

	core := fake.NewClientset()
	boom := errors.New("etcdserver: request timed out")
	core.PrependReactor("list", "*", func(k8stesting.Action) (bool, runtime.Object, error) { return true, nil, boom })
	dyn := newDynamic()
	dyn.PrependReactor("list", "*", func(k8stesting.Action) (bool, runtime.Object, error) { return true, nil, boom })
	c := kube.NewCluster(core.CoreV1(), dyn)

	_, err := c.Pods(t.Context())
	require.ErrorIs(t, err, boom)
	_, err = c.Nodes(t.Context())
	require.ErrorIs(t, err, boom)
	_, err = c.Certificates(t.Context())
	require.ErrorIs(t, err, boom)
	_, err = c.Backups(t.Context(), "outegro")
	require.ErrorIs(t, err, boom)
	_, err = c.ArgoApps(t.Context(), "argocd")
	require.ErrorIs(t, err, boom)
}

func TestPaginationFollowsContinue(t *testing.T) {
	t.Parallel()

	core := fake.NewClientset()
	calls := 0
	core.PrependReactor("list", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		calls++
		opts := action.(k8stesting.ListActionImpl).ListOptions
		if opts.Continue == "" {
			assert.Equal(t, int64(500), opts.Limit)
			return true, &corev1.PodList{
				ListMeta: metav1.ListMeta{Continue: "page-2"},
				Items:    []corev1.Pod{{ObjectMeta: metav1.ObjectMeta{Name: "a"}}},
			}, nil
		}
		assert.Equal(t, "page-2", opts.Continue)
		return true, &corev1.PodList{Items: []corev1.Pod{{ObjectMeta: metav1.ObjectMeta{Name: "b"}}}}, nil
	})

	pods, err := kube.NewCluster(core.CoreV1(), newDynamic()).Pods(t.Context())
	require.NoError(t, err)
	assert.Equal(t, 2, calls)
	require.Len(t, pods, 2)
	assert.Equal(t, "a", pods[0].Name)
	assert.Equal(t, "b", pods[1].Name)
}

func TestCertificates(t *testing.T) {
	t.Parallel()

	dyn := newDynamic(
		object("cert-manager.io/v1", "Certificate", "outegro", "outegro-dev-tls", map[string]any{
			"notAfter": "2026-12-01T00:00:00Z",
			"conditions": []any{map[string]any{
				"type": "Ready", "status": "True", "reason": "Ready", "message": "Certificate is up to date and has not expired",
				"lastTransitionTime": "2026-09-01T00:00:00Z", "observedGeneration": int64(3),
			}},
		}),
		object("cert-manager.io/v1", "Certificate", "argocd", "pending", map[string]any{}),
	)
	certs, err := kube.NewCluster(fake.NewClientset().CoreV1(), dyn).Certificates(t.Context())
	require.NoError(t, err)
	require.Len(t, certs, 2)

	byName := map[string]domain.Certificate{}
	for _, c := range certs {
		byName[c.Name] = c
	}
	assert.Equal(t, domain.Certificate{
		Namespace: "outegro",
		Name:      "outegro-dev-tls",
		Conditions: []domain.Condition{{
			Type: "Ready", Status: "True", Reason: "Ready", Message: "Certificate is up to date and has not expired",
			LastTransitionTime: time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC),
		}},
		NotAfter: time.Date(2026, 12, 1, 0, 0, 0, 0, time.UTC),
	}, normalize(byName["outegro-dev-tls"]))
	assert.True(t, byName["pending"].NotAfter.IsZero())
	assert.Empty(t, byName["pending"].Conditions)
}

// normalize converts times to UTC: metav1.Time decodes into the local zone.
func normalize(c domain.Certificate) domain.Certificate {
	c.NotAfter = c.NotAfter.UTC()
	for i := range c.Conditions {
		c.Conditions[i].LastTransitionTime = c.Conditions[i].LastTransitionTime.UTC()
	}
	return c
}

func TestPostgresCluster(t *testing.T) {
	t.Parallel()

	dyn := newDynamic(object("postgresql.cnpg.io/v1", "Cluster", "outegro", "pg", map[string]any{
		"phase": "Cluster in healthy state",
		"conditions": []any{
			map[string]any{"type": "Ready", "status": "True", "reason": "ClusterIsReady", "message": "Cluster is Ready", "lastTransitionTime": "2026-10-01T00:00:00Z"},
			map[string]any{"type": "ContinuousArchiving", "status": "False", "reason": "ContinuousArchivingFailing", "message": "wal archive failed", "lastTransitionTime": "2026-10-01T00:00:00Z"},
		},
	}))
	c := kube.NewCluster(fake.NewClientset().CoreV1(), dyn)

	pg, err := c.PostgresCluster(t.Context(), "outegro", "pg")
	require.NoError(t, err)
	assert.Equal(t, "pg", pg.Name)
	require.Len(t, pg.Conditions, 2)
	assert.Equal(t, "ContinuousArchiving", pg.Conditions[1].Type)
	assert.Equal(t, "False", pg.Conditions[1].Status)
	assert.Equal(t, "wal archive failed", pg.Conditions[1].Message)

	_, err = c.PostgresCluster(t.Context(), "outegro", "other")
	require.ErrorIs(t, err, ports.ErrNotFound)
}

func TestPostgresClusterError(t *testing.T) {
	t.Parallel()
	dyn := newDynamic()
	boom := errors.New("forbidden")
	dyn.PrependReactor("get", "clusters", func(k8stesting.Action) (bool, runtime.Object, error) { return true, nil, boom })
	_, err := kube.NewCluster(fake.NewClientset().CoreV1(), dyn).PostgresCluster(t.Context(), "outegro", "pg")
	require.ErrorIs(t, err, boom)
	require.NotErrorIs(t, err, ports.ErrNotFound)
}

func TestBackups(t *testing.T) {
	t.Parallel()

	dyn := newDynamic(
		object("postgresql.cnpg.io/v1", "Backup", "outegro", "pg-20261010", map[string]any{"phase": "completed", "stoppedAt": "2026-10-10T03:00:00Z"}),
		object("postgresql.cnpg.io/v1", "Backup", "outegro", "pg-running", map[string]any{"phase": "running"}),
		object("postgresql.cnpg.io/v1", "Backup", "other", "pg-elsewhere", map[string]any{"phase": "completed", "stoppedAt": "2026-10-10T04:00:00Z"}),
	)
	backups, err := kube.NewCluster(fake.NewClientset().CoreV1(), dyn).Backups(t.Context(), "outegro")
	require.NoError(t, err)
	require.Len(t, backups, 2)

	byName := map[string]domain.Backup{}
	for _, b := range backups {
		byName[b.Name] = b
	}
	assert.Equal(t, "completed", byName["pg-20261010"].Phase)
	assert.True(t, byName["pg-20261010"].StoppedAt.Equal(time.Date(2026, 10, 10, 3, 0, 0, 0, time.UTC)))
	assert.True(t, byName["pg-running"].StoppedAt.IsZero())
}

func TestArgoApps(t *testing.T) {
	t.Parallel()

	dyn := newDynamic(
		object("argoproj.io/v1alpha1", "Application", "argocd", "platform", map[string]any{
			"sync": map[string]any{"status": "Synced", "revision": "abc"}, "health": map[string]any{"status": "Healthy"},
		}),
		object("argoproj.io/v1alpha1", "Application", "argocd", "fresh", nil),
	)
	apps, err := kube.NewCluster(fake.NewClientset().CoreV1(), dyn).ArgoApps(t.Context(), "argocd")
	require.NoError(t, err)
	assert.ElementsMatch(t, []domain.ArgoApp{
		{Name: "platform", SyncStatus: "Synced", HealthStatus: "Healthy"},
		{Name: "fresh"},
	}, apps)
}

func TestMalformedCustomResource(t *testing.T) {
	t.Parallel()
	dyn := newDynamic(object("postgresql.cnpg.io/v1", "Backup", "outegro", "bad", map[string]any{"stoppedAt": int64(42)}))
	_, err := kube.NewCluster(fake.NewClientset().CoreV1(), dyn).Backups(t.Context(), "outegro")
	require.ErrorContains(t, err, "decode Backup outegro/bad")
}
