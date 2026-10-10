// Package checks turns cluster data into findings. Every function here is
// pure: it takes plain domain values and the pass time and returns findings
// (and facts for the daily digest). No I/O, no clock, no logging.
package checks

import (
	"fmt"
	"slices"
	"time"

	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

// Thresholds from the specification.
const (
	// NotReadyAfter is how long a pod may stay not ready before it is reported.
	NotReadyAfter = 600 * time.Second
	// OOMWindow is how recent an OOM kill must be to be reported.
	OOMWindow = 900 * time.Second
)

// badWaitingReasons are container waiting reasons that never fix themselves.
var badWaitingReasons = []string{
	"CrashLoopBackOff",
	"ImagePullBackOff",
	"ErrImagePull",
	"CreateContainerConfigError",
}

// appLabels are tried in order to name the application a pod belongs to.
var appLabels = []string{"app", "app.kubernetes.io/name", "k8s-app"}

const (
	phaseSucceeded = "Succeeded"
	phaseRunning   = "Running"
	ownerJob       = "Job"
)

// Pods reports crash-looping containers and pods that stay not ready.
// Pods outside the watched namespaces, finished pods and pods of Jobs are
// ignored. One finding per pod at most: a container failure wins over
// readiness.
func Pods(pods []domain.Pod, watched []string, now time.Time) []domain.Finding {
	var out []domain.Finding
	for i := range pods {
		p := &pods[i]
		if !slices.Contains(watched, p.Namespace) || p.Phase == phaseSucceeded || slices.Contains(p.OwnerKinds, ownerJob) {
			continue
		}
		key := "pod:" + p.Namespace + "/" + AppName(p)
		if reason, ok := badWaitingReason(p.Containers); ok {
			out = append(out, domain.Finding{
				Key:     key,
				Message: fmt.Sprintf("%s/%s: %s", p.Namespace, p.Name, reason),
			})
			continue
		}
		ready, found := domain.FindCondition(p.Conditions, domain.ConditionReady)
		status := domain.ConditionFalse
		since := p.CreatedAt
		if found {
			status = ready.Status
			if !ready.LastTransitionTime.IsZero() {
				since = ready.LastTransitionTime
			}
		}
		age := now.Unix() - since.Unix()
		if status != domain.ConditionTrue && age > int64(NotReadyAfter/time.Second) {
			out = append(out, domain.Finding{
				Key:     key,
				Message: fmt.Sprintf("%s/%s not ready for %d min", p.Namespace, p.Name, age/60),
			})
		}
	}
	return out
}

// PodsUnavailable is the finding for a pod list that could not be read.
func PodsUnavailable() []domain.Finding {
	return []domain.Finding{{Key: "kube:pods", Message: "cannot list pods"}}
}

// OOMKills reports containers in watched namespaces whose last termination
// was an OOM kill less than OOMWindow ago. Unlike Pods it looks at every
// pod, including finished ones and Jobs.
func OOMKills(pods []domain.Pod, watched []string, now time.Time) []domain.Finding {
	var out []domain.Finding
	for i := range pods {
		p := &pods[i]
		if !slices.Contains(watched, p.Namespace) {
			continue
		}
		for _, c := range p.Containers {
			if c.LastTerminationReason != "OOMKilled" {
				continue
			}
			if now.Unix()-c.LastTerminationAt.Unix() >= int64(OOMWindow/time.Second) {
				continue
			}
			out = append(out, domain.Finding{
				Key:     "oom:" + p.Namespace + "/" + c.Name,
				Message: fmt.Sprintf("%s/%s: container %s ran out of memory", p.Namespace, p.Name, c.Name),
			})
		}
	}
	return out
}

// RunningPods counts pods in phase Running across all namespaces.
func RunningPods(pods []domain.Pod) int {
	n := 0
	for i := range pods {
		if pods[i].Phase == phaseRunning {
			n++
		}
	}
	return n
}

// AppName is the application a pod belongs to: the first present label of
// app, app.kubernetes.io/name, k8s-app, or else the pod name.
func AppName(p *domain.Pod) string {
	for _, l := range appLabels {
		if v := p.Labels[l]; v != "" {
			return v
		}
	}
	return p.Name
}

func badWaitingReason(containers []domain.ContainerStatus) (string, bool) {
	for _, c := range containers {
		if slices.Contains(badWaitingReasons, c.WaitingReason) {
			return c.WaitingReason, true
		}
	}
	return "", false
}
