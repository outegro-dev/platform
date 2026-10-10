package kube

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// The structs below declare only the fields of the custom resources the
// watchdog reads. runtime.DefaultUnstructuredConverter fills them from the
// dynamic client's map[string]any using the json tags; unknown fields are
// ignored, so newer CRD versions with extra fields keep working.

type conditionObject struct {
	Type               string      `json:"type"`
	Status             string      `json:"status"`
	Reason             string      `json:"reason,omitempty"`
	Message            string      `json:"message,omitempty"`
	LastTransitionTime metav1.Time `json:"lastTransitionTime"`
}

// certificateObject is a cert-manager.io/v1 Certificate.
type certificateObject struct {
	Metadata metav1.ObjectMeta `json:"metadata"`
	Status   struct {
		Conditions []conditionObject `json:"conditions,omitempty"`
		NotAfter   *metav1.Time      `json:"notAfter,omitempty"`
	} `json:"status"`
}

// clusterObject is a postgresql.cnpg.io/v1 Cluster.
type clusterObject struct {
	Metadata metav1.ObjectMeta `json:"metadata"`
	Status   struct {
		Conditions []conditionObject `json:"conditions,omitempty"`
	} `json:"status"`
}

// backupObject is a postgresql.cnpg.io/v1 Backup.
type backupObject struct {
	Metadata metav1.ObjectMeta `json:"metadata"`
	Status   struct {
		Phase     string       `json:"phase,omitempty"`
		StoppedAt *metav1.Time `json:"stoppedAt,omitempty"`
	} `json:"status"`
}

// applicationObject is an argoproj.io/v1alpha1 Application.
type applicationObject struct {
	Metadata metav1.ObjectMeta `json:"metadata"`
	Status   struct {
		Sync struct {
			Status string `json:"status,omitempty"`
		} `json:"sync"`
		Health struct {
			Status string `json:"status,omitempty"`
		} `json:"health"`
	} `json:"status"`
}
