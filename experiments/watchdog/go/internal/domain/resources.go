package domain

import "time"

// Condition statuses used by Kubernetes and the CRDs the watchdog reads.
const (
	ConditionTrue  = "True"
	ConditionFalse = "False"
)

// ConditionReady is the condition type shared by pods, nodes, certificates
// and the PostgreSQL cluster.
const ConditionReady = "Ready"

// Condition is the common shape of status conditions. A zero
// LastTransitionTime means the source did not report it.
type Condition struct {
	Type               string
	Status             string
	Reason             string
	Message            string
	LastTransitionTime time.Time
}

// FindCondition returns the first condition of the given type.
func FindCondition(conditions []Condition, conditionType string) (Condition, bool) {
	for _, c := range conditions {
		if c.Type == conditionType {
			return c, true
		}
	}
	return Condition{}, false
}

// Pod is the part of a Kubernetes pod the checks need.
type Pod struct {
	Namespace  string
	Name       string
	Labels     map[string]string
	Phase      string
	OwnerKinds []string
	CreatedAt  time.Time
	Conditions []Condition
	Containers []ContainerStatus
}

// ContainerStatus is the part of a container status the checks need.
// Empty strings and zero times mean "not reported".
type ContainerStatus struct {
	Name                  string
	WaitingReason         string
	LastTerminationReason string
	LastTerminationAt     time.Time
}

// Node is a cluster node with its conditions.
type Node struct {
	Name       string
	Conditions []Condition
}

// Certificate is a cert-manager Certificate. A zero NotAfter means the
// certificate has not been issued yet.
type Certificate struct {
	Namespace  string
	Name       string
	Conditions []Condition
	NotAfter   time.Time
}

// PGCluster is a CloudNativePG Cluster.
type PGCluster struct {
	Name       string
	Conditions []Condition
}

// Backup is a CloudNativePG Backup. A zero StoppedAt means it has not finished.
type Backup struct {
	Name      string
	Phase     string
	StoppedAt time.Time
}

// ArgoApp is an Argo CD Application with its sync and health status.
type ArgoApp struct {
	Name         string
	SyncStatus   string
	HealthStatus string
}

// Alert is an active Prometheus alert.
type Alert struct {
	State       string
	Labels      map[string]string
	Annotations map[string]string
}

// Probe is a named HTTP endpoint that must answer 200.
type Probe struct {
	Name string
	URL  string
}

// ProbeResult is the outcome of one probe. Code 0 means no response.
type ProbeResult struct {
	Probe
	Code int
}
