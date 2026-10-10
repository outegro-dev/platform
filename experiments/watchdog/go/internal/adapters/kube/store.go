package kube

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	typedcorev1 "k8s.io/client-go/kubernetes/typed/core/v1"

	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

// StateKey is the ConfigMap data key that holds the JSON state.
const StateKey = "state.json"

// StateStore implements ports.StateStore on a ConfigMap. It remembers the
// ConfigMap read by Load, so Save updates exactly that resource version
// (optimistic concurrency). It is meant for one pass and is not safe for
// concurrent use.
type StateStore struct {
	client    typedcorev1.CoreV1Interface
	namespace string
	name      string
	loaded    *corev1.ConfigMap // nil when the ConfigMap did not exist
}

// NewStateStore returns a store for ConfigMap namespace/name.
func NewStateStore(client typedcorev1.CoreV1Interface, namespace, name string) *StateStore {
	return &StateStore{client: client, namespace: namespace, name: name}
}

func (s *StateStore) configMaps() typedcorev1.ConfigMapInterface {
	return s.client.ConfigMaps(s.namespace)
}

// Load reads the state. A missing ConfigMap is not an error (found is
// false); a ConfigMap without valid state.json gives ports.ErrCorruptState.
func (s *StateStore) Load(ctx context.Context) (domain.State, bool, error) {
	cm, err := s.configMaps().Get(ctx, s.name, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		s.loaded = nil
		return domain.State{}, false, nil
	}
	if err != nil {
		return domain.State{}, false, fmt.Errorf("get configmap %s/%s: %w", s.namespace, s.name, err)
	}
	s.loaded = cm
	raw, ok := cm.Data[StateKey]
	if !ok {
		return domain.State{}, false, fmt.Errorf("configmap %s/%s has no %s: %w", s.namespace, s.name, StateKey, ports.ErrCorruptState)
	}
	st, err := domain.DecodeState([]byte(raw))
	if err != nil {
		// Two %w verbs: callers can match both ports.ErrCorruptState and
		// the underlying cause with errors.Is / errors.As.
		return domain.State{}, false, fmt.Errorf("configmap %s/%s: %w: %w", s.namespace, s.name, ports.ErrCorruptState, err)
	}
	return st, true, nil
}

// Save writes the state: it creates the ConfigMap when Load found none and
// otherwise updates the version Load read. On a conflict (someone changed
// the ConfigMap in between) it re-reads it and retries once.
func (s *StateStore) Save(ctx context.Context, st domain.State) error {
	raw, err := domain.EncodeState(st)
	if err != nil {
		return err
	}
	data := string(raw)

	if s.loaded == nil {
		err := s.create(ctx, data)
		if !apierrors.IsAlreadyExists(err) {
			return err
		}
		// Created by someone else since Load: fall through to update it.
		return s.rereadAndUpdate(ctx, data)
	}

	err = s.update(ctx, s.loaded, data)
	if apierrors.IsConflict(err) {
		return s.rereadAndUpdate(ctx, data)
	}
	return err
}

func (s *StateStore) create(ctx context.Context, data string) error {
	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:      s.name,
			Namespace: s.namespace,
			Labels: map[string]string{
				"app.kubernetes.io/name":       "watchdog",
				"app.kubernetes.io/managed-by": "watchdog",
			},
		},
		Data: map[string]string{StateKey: data},
	}
	created, err := s.configMaps().Create(ctx, cm, metav1.CreateOptions{})
	if err != nil {
		return fmt.Errorf("create configmap %s/%s: %w", s.namespace, s.name, err)
	}
	s.loaded = created
	return nil
}

func (s *StateStore) update(ctx context.Context, base *corev1.ConfigMap, data string) error {
	cm := base.DeepCopy()
	if cm.Data == nil {
		cm.Data = map[string]string{}
	}
	cm.Data[StateKey] = data
	updated, err := s.configMaps().Update(ctx, cm, metav1.UpdateOptions{})
	if err != nil {
		return fmt.Errorf("update configmap %s/%s: %w", s.namespace, s.name, err)
	}
	s.loaded = updated
	return nil
}

func (s *StateStore) rereadAndUpdate(ctx context.Context, data string) error {
	fresh, err := s.configMaps().Get(ctx, s.name, metav1.GetOptions{})
	if err != nil {
		return fmt.Errorf("re-read configmap %s/%s: %w", s.namespace, s.name, err)
	}
	return s.update(ctx, fresh, data)
}
