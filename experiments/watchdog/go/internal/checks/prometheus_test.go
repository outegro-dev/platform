package checks_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/outegro-dev/watchdog-lab/go/internal/checks"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

func alert(state string, labels, annotations map[string]string) domain.Alert {
	return domain.Alert{State: state, Labels: labels, Annotations: annotations}
}

func TestPrometheusAlerts(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name  string
		alert domain.Alert
		want  []domain.Finding
	}{
		{
			name: "firing with summary",
			alert: alert("firing",
				map[string]string{"alertname": "RabbitMQQueueGrowing", "severity": "critical", "namespace": "outegro", "queue": "notifications"},
				map[string]string{"summary": "Queue notifications keeps growing"}),
			want: []domain.Finding{{
				Key:     "prom:RabbitMQQueueGrowing:notifications/outegro",
				Message: "RabbitMQQueueGrowing (critical): Queue notifications keeps growing",
			}},
		},
		{
			name: "no severity means warning, no summary means scope",
			alert: alert("firing",
				map[string]string{"alertname": "PVCAlmostFull", "namespace": "outegro", "persistentvolumeclaim": "data-pg-1"}, nil),
			want: []domain.Finding{{Key: "prom:PVCAlmostFull:data-pg-1/outegro", Message: "PVCAlmostFull (warning): data-pg-1/outegro"}},
		},
		{
			name:  "no scope labels",
			alert: alert("firing", map[string]string{"alertname": "TargetDown", "severity": "warning"}, nil),
			want:  []domain.Finding{{Key: "prom:TargetDown:", Message: "TargetDown (warning): "}},
		},
		{name: "pending is ignored", alert: alert("pending", map[string]string{"alertname": "HighLatency"}, nil)},
		{name: "inactive is ignored", alert: alert("inactive", map[string]string{"alertname": "HighLatency"}, nil)},
		{name: "Watchdog is ignored", alert: alert("firing", map[string]string{"alertname": "Watchdog", "severity": "none"}, nil)},
		{name: "InfoInhibitor is ignored", alert: alert("firing", map[string]string{"alertname": "InfoInhibitor"}, nil)},
		{name: "KubePodCrashLooping is ignored", alert: alert("firing", map[string]string{"alertname": "KubePodCrashLooping", "severity": "warning"}, nil)},
		{name: "KubePodNotReady is ignored", alert: alert("firing", map[string]string{"alertname": "KubePodNotReady", "severity": "warning"}, nil)},
		{name: "ContainerOOMKilled is ignored", alert: alert("firing", map[string]string{"alertname": "ContainerOOMKilled", "severity": "warning"}, nil)},
		{name: "severity info is ignored", alert: alert("firing", map[string]string{"alertname": "CPUThrottling", "severity": "info"}, nil)},
		{name: "severity none is ignored", alert: alert("firing", map[string]string{"alertname": "Heartbeat", "severity": "none"}, nil)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, checks.PrometheusAlerts([]domain.Alert{tt.alert}))
		})
	}
}

func TestAlertScope(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name   string
		labels map[string]string
		want   string
	}{
		{name: "nothing", labels: map[string]string{"alertname": "X", "instance": "10.0.0.1:9100"}, want: ""},
		{name: "sorted by value", labels: map[string]string{"namespace": "outegro", "pod": "auth-0", "service": "auth"}, want: "auth/auth-0/outegro"},
		{name: "duplicates collapse", labels: map[string]string{"namespace": "pg", "name": "pg", "job_name": "backup"}, want: "backup/pg"},
		{name: "empty values are dropped", labels: map[string]string{"namespace": "outegro", "pod": "", "deployment": "id-web"}, want: "id-web/outegro"},
		{
			name: "every scope label",
			labels: map[string]string{
				"namespace": "i", "pod": "h", "service": "g", "queue": "f", "name": "e",
				"job_name": "d", "deployment": "c", "statefulset": "b", "persistentvolumeclaim": "a",
			},
			want: "a/b/c/d/e/f/g/h/i",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			assert.Equal(t, tt.want, checks.AlertScope(tt.labels))
		})
	}
}

func TestPrometheusUnavailable(t *testing.T) {
	t.Parallel()
	assert.Equal(t, []domain.Finding{{Key: "prom:api", Message: "Prometheus alerts API does not answer"}}, checks.PrometheusUnavailable())
}
