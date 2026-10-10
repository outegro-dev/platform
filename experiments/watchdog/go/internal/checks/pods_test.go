package checks_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/outegro-dev/watchdog-lab/go/internal/checks"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

var (
	now     = time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	watched = []string{"outegro", "kube-system"}
)

func ago(d time.Duration) time.Time { return now.Add(-d) }

// pod builds a running, ready pod; tests change what they need.
func pod(mutate ...func(*domain.Pod)) domain.Pod {
	p := domain.Pod{
		Namespace: "outegro",
		Name:      "auth-backend-7d9f-abcde",
		Labels:    map[string]string{"app": "auth-backend"},
		Phase:     "Running",
		CreatedAt: ago(48 * time.Hour),
		Conditions: []domain.Condition{
			{Type: "Ready", Status: "True", LastTransitionTime: ago(47 * time.Hour)},
		},
		Containers: []domain.ContainerStatus{{Name: "app"}},
	}
	for _, m := range mutate {
		m(&p)
	}
	return p
}

func notReadyFor(d time.Duration) func(*domain.Pod) {
	return func(p *domain.Pod) {
		p.Conditions = []domain.Condition{{Type: "Ready", Status: "False", LastTransitionTime: ago(d)}}
	}
}

func waiting(reason string) func(*domain.Pod) {
	return func(p *domain.Pod) { p.Containers[0].WaitingReason = reason }
}

func TestPods(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		pod  domain.Pod
		want []domain.Finding
	}{
		{name: "healthy pod", pod: pod()},
		{
			name: "crash loop",
			pod:  pod(waiting("CrashLoopBackOff")),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde: CrashLoopBackOff"}},
		},
		{
			name: "image pull back-off",
			pod:  pod(waiting("ImagePullBackOff")),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde: ImagePullBackOff"}},
		},
		{
			name: "image pull error",
			pod:  pod(waiting("ErrImagePull")),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde: ErrImagePull"}},
		},
		{
			name: "config error",
			pod:  pod(waiting("CreateContainerConfigError")),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde: CreateContainerConfigError"}},
		},
		{name: "harmless waiting reason", pod: pod(waiting("ContainerCreating"))},
		{
			name: "second container crashes",
			pod: pod(func(p *domain.Pod) {
				p.Containers = append(p.Containers, domain.ContainerStatus{Name: "sidecar", WaitingReason: "CrashLoopBackOff"})
			}),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde: CrashLoopBackOff"}},
		},
		{name: "not ready exactly 600 s", pod: pod(notReadyFor(600 * time.Second))},
		{
			name: "not ready 601 s",
			pod:  pod(notReadyFor(601 * time.Second)),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde not ready for 10 min"}},
		},
		{
			name: "not ready minutes are floored",
			pod:  pod(notReadyFor(59*time.Minute + 59*time.Second)),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde not ready for 59 min"}},
		},
		{
			name: "crash wins over not ready",
			pod:  pod(notReadyFor(time.Hour), waiting("CrashLoopBackOff")),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde: CrashLoopBackOff"}},
		},
		{
			name: "no Ready condition counts from creation",
			pod: pod(func(p *domain.Pod) {
				p.Conditions = nil
				p.CreatedAt = ago(11 * time.Minute)
			}),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde not ready for 11 min"}},
		},
		{
			name: "no Ready condition, young pod",
			pod: pod(func(p *domain.Pod) {
				p.Conditions = nil
				p.CreatedAt = ago(5 * time.Minute)
			}),
		},
		{
			name: "Ready without transition time counts from creation",
			pod: pod(func(p *domain.Pod) {
				p.Conditions = []domain.Condition{{Type: "Ready", Status: "Unknown"}}
				p.CreatedAt = ago(20 * time.Minute)
			}),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde not ready for 20 min"}},
		},
		{
			name: "succeeded pod is skipped",
			pod:  pod(notReadyFor(time.Hour), func(p *domain.Pod) { p.Phase = "Succeeded" }),
		},
		{
			name: "job pod is skipped",
			pod:  pod(waiting("CrashLoopBackOff"), func(p *domain.Pod) { p.OwnerKinds = []string{"Job"} }),
		},
		{
			name: "replica set pod is checked",
			pod:  pod(waiting("ErrImagePull"), func(p *domain.Pod) { p.OwnerKinds = []string{"ReplicaSet"} }),
			want: []domain.Finding{{Key: "pod:outegro/auth-backend", Message: "outegro/auth-backend-7d9f-abcde: ErrImagePull"}},
		},
		{
			name: "unwatched namespace is skipped",
			pod:  pod(waiting("CrashLoopBackOff"), func(p *domain.Pod) { p.Namespace = "monitoring" }),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, checks.Pods([]domain.Pod{tt.pod}, watched, now))
		})
	}
}

func TestAppName(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		labels map[string]string
		want   string
	}{
		{name: "app label wins", labels: map[string]string{"app": "a", "app.kubernetes.io/name": "b", "k8s-app": "c"}, want: "a"},
		{name: "recommended label", labels: map[string]string{"app.kubernetes.io/name": "b", "k8s-app": "c"}, want: "b"},
		{name: "k8s-app label", labels: map[string]string{"k8s-app": "kube-dns"}, want: "kube-dns"},
		{name: "empty label falls through", labels: map[string]string{"app": "", "k8s-app": "c"}, want: "c"},
		{name: "pod name", labels: nil, want: "auth-backend-7d9f-abcde"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			p := pod(func(p *domain.Pod) { p.Labels = tt.labels })
			assert.Equal(t, tt.want, checks.AppName(&p))
		})
	}
}

func TestOOMKills(t *testing.T) {
	t.Parallel()

	oom := func(d time.Duration) func(*domain.Pod) {
		return func(p *domain.Pod) {
			p.Containers[0].LastTerminationReason = "OOMKilled"
			p.Containers[0].LastTerminationAt = ago(d)
		}
	}
	want := []domain.Finding{{Key: "oom:outegro/app", Message: "outegro/auth-backend-7d9f-abcde: container app ran out of memory"}}

	tests := []struct {
		name string
		pod  domain.Pod
		want []domain.Finding
	}{
		{name: "no termination", pod: pod()},
		{name: "OOM 899 s ago", pod: pod(oom(899 * time.Second)), want: want},
		{name: "OOM exactly 900 s ago", pod: pod(oom(900 * time.Second))},
		{name: "other reason", pod: pod(oom(time.Second), func(p *domain.Pod) { p.Containers[0].LastTerminationReason = "Error" })},
		{name: "succeeded pod still counts", pod: pod(oom(time.Minute), func(p *domain.Pod) { p.Phase = "Succeeded" }), want: want},
		{name: "job pod still counts", pod: pod(oom(time.Minute), func(p *domain.Pod) { p.OwnerKinds = []string{"Job"} }), want: want},
		{name: "unwatched namespace", pod: pod(oom(time.Minute), func(p *domain.Pod) { p.Namespace = "default" })},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, checks.OOMKills([]domain.Pod{tt.pod}, watched, now))
		})
	}
}

func TestRunningPods(t *testing.T) {
	t.Parallel()
	pods := []domain.Pod{
		pod(),
		pod(func(p *domain.Pod) { p.Namespace = "unwatched" }), // all namespaces count
		pod(func(p *domain.Pod) { p.Phase = "Pending" }),
		pod(func(p *domain.Pod) { p.Phase = "Succeeded" }),
	}
	assert.Equal(t, 2, checks.RunningPods(pods))
	assert.Equal(t, 0, checks.RunningPods(nil))
}

func TestPodsUnavailable(t *testing.T) {
	t.Parallel()
	assert.Equal(t, []domain.Finding{{Key: "kube:pods", Message: "cannot list pods"}}, checks.PodsUnavailable())
}
