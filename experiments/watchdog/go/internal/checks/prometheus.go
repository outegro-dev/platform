package checks

import (
	"fmt"
	"slices"
	"strings"

	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

// ignoredAlerts are covered by the watchdog's own checks or carry no signal.
var ignoredAlerts = []string{
	"Watchdog",
	"InfoInhibitor",
	"KubePodCrashLooping",
	"KubePodNotReady",
	"ContainerOOMKilled",
}

// ignoredSeverities never reach the owner.
var ignoredSeverities = []string{"info", "none"}

// scopeLabels describe what an alert is about; their values form the scope.
var scopeLabels = []string{
	"namespace", "pod", "service", "queue", "name",
	"job_name", "deployment", "statefulset", "persistentvolumeclaim",
}

const (
	alertFiring     = "firing"
	defaultSeverity = "warning"
)

// PrometheusUnavailable is the finding for an alerts API that did not answer.
func PrometheusUnavailable() []domain.Finding {
	return []domain.Finding{{Key: "prom:api", Message: "Prometheus alerts API does not answer"}}
}

// PrometheusAlerts reports firing alerts except the ignored names and
// severities. The key holds the alert name and its scope, so the same
// alert on two objects gives two findings.
func PrometheusAlerts(alerts []domain.Alert) []domain.Finding {
	var out []domain.Finding
	for i := range alerts {
		a := &alerts[i]
		if a.State != alertFiring {
			continue
		}
		name := a.Labels["alertname"]
		if slices.Contains(ignoredAlerts, name) {
			continue
		}
		severity := a.Labels["severity"]
		if severity == "" {
			severity = defaultSeverity
		}
		if slices.Contains(ignoredSeverities, severity) {
			continue
		}
		scope := AlertScope(a.Labels)
		summary := a.Annotations["summary"]
		if summary == "" {
			summary = scope
		}
		out = append(out, domain.Finding{
			Key:     "prom:" + name + ":" + scope,
			Message: fmt.Sprintf("%s (%s): %s", name, severity, summary),
		})
	}
	return out
}

// AlertScope joins the unique non-empty values of the scope labels with
// "/", in sorted order.
func AlertScope(labels map[string]string) string {
	values := make([]string, 0, len(scopeLabels))
	for _, l := range scopeLabels {
		if v := labels[l]; v != "" {
			values = append(values, v)
		}
	}
	slices.Sort(values)
	return strings.Join(slices.Compact(values), "/")
}
