// Package kube adapts the Kubernetes API to the watchdog ports: the typed
// client for pods, nodes and the state ConfigMap, the dynamic client for
// the cert-manager, CloudNativePG and Argo CD custom resources.
package kube

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	typedcorev1 "k8s.io/client-go/kubernetes/typed/core/v1"

	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

// Custom resources read through the dynamic client.
var (
	CertificatesGVR = schema.GroupVersionResource{Group: "cert-manager.io", Version: "v1", Resource: "certificates"}
	ClustersGVR     = schema.GroupVersionResource{Group: "postgresql.cnpg.io", Version: "v1", Resource: "clusters"}
	BackupsGVR      = schema.GroupVersionResource{Group: "postgresql.cnpg.io", Version: "v1", Resource: "backups"}
	ApplicationsGVR = schema.GroupVersionResource{Group: "argoproj.io", Version: "v1alpha1", Resource: "applications"}
)

// pageSize keeps list responses small on a busy API server.
const pageSize = 500

// Compile-time checks: the build fails if an adapter stops satisfying its port.
var (
	_ ports.ClusterSource = (*Cluster)(nil)
	_ ports.StateStore    = (*StateStore)(nil)
)

// Cluster implements ports.ClusterSource.
type Cluster struct {
	core typedcorev1.CoreV1Interface
	dyn  dynamic.Interface
}

// NewCluster returns a ClusterSource backed by the given clients. It asks
// for the narrow CoreV1Interface instead of the whole clientset: the
// adapter depends only on what it uses, and tests pass the client-go fakes
// (fake.NewClientset().CoreV1()).
func NewCluster(core typedcorev1.CoreV1Interface, dyn dynamic.Interface) *Cluster {
	return &Cluster{core: core, dyn: dyn}
}

// Pods lists pods in all namespaces.
func (c *Cluster) Pods(ctx context.Context) ([]domain.Pod, error) {
	pods, err := listAll(ctx, func(ctx context.Context, opts metav1.ListOptions) ([]domain.Pod, string, error) {
		list, err := c.core.Pods(metav1.NamespaceAll).List(ctx, opts)
		if err != nil {
			return nil, "", err
		}
		out := make([]domain.Pod, 0, len(list.Items))
		for i := range list.Items {
			out = append(out, toPod(&list.Items[i]))
		}
		return out, list.Continue, nil
	})
	if err != nil {
		return nil, fmt.Errorf("list pods: %w", err)
	}
	return pods, nil
}

// Nodes lists the cluster nodes.
func (c *Cluster) Nodes(ctx context.Context) ([]domain.Node, error) {
	nodes, err := listAll(ctx, func(ctx context.Context, opts metav1.ListOptions) ([]domain.Node, string, error) {
		list, err := c.core.Nodes().List(ctx, opts)
		if err != nil {
			return nil, "", err
		}
		out := make([]domain.Node, 0, len(list.Items))
		for i := range list.Items {
			n := &list.Items[i]
			node := domain.Node{Name: n.Name}
			for _, cond := range n.Status.Conditions {
				node.Conditions = append(node.Conditions, domain.Condition{
					Type:               string(cond.Type),
					Status:             string(cond.Status),
					Reason:             cond.Reason,
					Message:            cond.Message,
					LastTransitionTime: cond.LastTransitionTime.Time,
				})
			}
			out = append(out, node)
		}
		return out, list.Continue, nil
	})
	if err != nil {
		return nil, fmt.Errorf("list nodes: %w", err)
	}
	return nodes, nil
}

// Certificates lists cert-manager certificates in all namespaces.
func (c *Cluster) Certificates(ctx context.Context) ([]domain.Certificate, error) {
	objs, err := listCustom[certificateObject](ctx, c.dyn.Resource(CertificatesGVR))
	if err != nil {
		return nil, fmt.Errorf("list certificates: %w", err)
	}
	out := make([]domain.Certificate, 0, len(objs))
	for i := range objs {
		o := &objs[i]
		cert := domain.Certificate{Namespace: o.Metadata.Namespace, Name: o.Metadata.Name, Conditions: toConditions(o.Status.Conditions)}
		if o.Status.NotAfter != nil {
			cert.NotAfter = o.Status.NotAfter.Time
		}
		out = append(out, cert)
	}
	return out, nil
}

// PostgresCluster reads one CloudNativePG cluster. A missing cluster (or a
// missing CRD) gives an error wrapping ports.ErrNotFound.
func (c *Cluster) PostgresCluster(ctx context.Context, namespace, name string) (domain.PGCluster, error) {
	u, err := c.dyn.Resource(ClustersGVR).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		return domain.PGCluster{}, fmt.Errorf("postgres cluster %s/%s: %w", namespace, name, ports.ErrNotFound)
	}
	if err != nil {
		return domain.PGCluster{}, fmt.Errorf("get postgres cluster %s/%s: %w", namespace, name, err)
	}
	var obj clusterObject
	if err := runtime.DefaultUnstructuredConverter.FromUnstructured(u.Object, &obj); err != nil {
		return domain.PGCluster{}, fmt.Errorf("decode postgres cluster %s/%s: %w", namespace, name, err)
	}
	return domain.PGCluster{Name: obj.Metadata.Name, Conditions: toConditions(obj.Status.Conditions)}, nil
}

// Backups lists CloudNativePG backups in a namespace.
func (c *Cluster) Backups(ctx context.Context, namespace string) ([]domain.Backup, error) {
	objs, err := listCustom[backupObject](ctx, c.dyn.Resource(BackupsGVR).Namespace(namespace))
	if err != nil {
		return nil, fmt.Errorf("list backups in %s: %w", namespace, err)
	}
	out := make([]domain.Backup, 0, len(objs))
	for i := range objs {
		o := &objs[i]
		b := domain.Backup{Name: o.Metadata.Name, Phase: o.Status.Phase}
		if o.Status.StoppedAt != nil {
			b.StoppedAt = o.Status.StoppedAt.Time
		}
		out = append(out, b)
	}
	return out, nil
}

// ArgoApps lists Argo CD applications in a namespace.
func (c *Cluster) ArgoApps(ctx context.Context, namespace string) ([]domain.ArgoApp, error) {
	objs, err := listCustom[applicationObject](ctx, c.dyn.Resource(ApplicationsGVR).Namespace(namespace))
	if err != nil {
		return nil, fmt.Errorf("list argo cd applications in %s: %w", namespace, err)
	}
	out := make([]domain.ArgoApp, 0, len(objs))
	for i := range objs {
		o := &objs[i]
		out = append(out, domain.ArgoApp{
			Name:         o.Metadata.Name,
			SyncStatus:   o.Status.Sync.Status,
			HealthStatus: o.Status.Health.Status,
		})
	}
	return out, nil
}

// listAll follows the API server's pagination (limit + continue token)
// until the last page. The type parameter lets the same loop serve pods,
// nodes and custom resources.
func listAll[T any](ctx context.Context, page func(context.Context, metav1.ListOptions) ([]T, string, error)) ([]T, error) {
	var all []T
	opts := metav1.ListOptions{Limit: pageSize}
	for {
		items, next, err := page(ctx, opts)
		if err != nil {
			return nil, err
		}
		all = append(all, items...)
		if next == "" {
			return all, nil
		}
		opts.Continue = next
	}
}

// listCustom lists a custom resource and decodes every item into T, a
// small struct that declares only the fields the watchdog reads.
func listCustom[T any](ctx context.Context, res dynamic.ResourceInterface) ([]T, error) {
	return listAll(ctx, func(ctx context.Context, opts metav1.ListOptions) ([]T, string, error) {
		list, err := res.List(ctx, opts)
		if err != nil {
			return nil, "", err
		}
		out, err := decodeItems[T](list.Items)
		if err != nil {
			return nil, "", err
		}
		return out, list.GetContinue(), nil
	})
}

func decodeItems[T any](items []unstructured.Unstructured) ([]T, error) {
	out := make([]T, len(items))
	for i := range items {
		if err := runtime.DefaultUnstructuredConverter.FromUnstructured(items[i].Object, &out[i]); err != nil {
			return nil, fmt.Errorf("decode %s %s/%s: %w", items[i].GetKind(), items[i].GetNamespace(), items[i].GetName(), err)
		}
	}
	return out, nil
}

func toPod(p *corev1.Pod) domain.Pod {
	pod := domain.Pod{
		Namespace: p.Namespace,
		Name:      p.Name,
		Labels:    p.Labels,
		Phase:     string(p.Status.Phase),
		CreatedAt: p.CreationTimestamp.Time,
	}
	for _, ref := range p.OwnerReferences {
		pod.OwnerKinds = append(pod.OwnerKinds, ref.Kind)
	}
	for _, c := range p.Status.Conditions {
		pod.Conditions = append(pod.Conditions, domain.Condition{
			Type:               string(c.Type),
			Status:             string(c.Status),
			Reason:             c.Reason,
			Message:            c.Message,
			LastTransitionTime: c.LastTransitionTime.Time,
		})
	}
	for i := range p.Status.ContainerStatuses {
		cs := &p.Status.ContainerStatuses[i]
		s := domain.ContainerStatus{Name: cs.Name}
		if w := cs.State.Waiting; w != nil {
			s.WaitingReason = w.Reason
		}
		if t := cs.LastTerminationState.Terminated; t != nil {
			s.LastTerminationReason = t.Reason
			s.LastTerminationAt = t.FinishedAt.Time
		}
		pod.Containers = append(pod.Containers, s)
	}
	return pod
}

func toConditions(in []conditionObject) []domain.Condition {
	out := make([]domain.Condition, 0, len(in))
	for _, c := range in {
		out = append(out, domain.Condition{
			Type:               c.Type,
			Status:             c.Status,
			Reason:             c.Reason,
			Message:            c.Message,
			LastTransitionTime: c.LastTransitionTime.Time,
		})
	}
	return out
}
