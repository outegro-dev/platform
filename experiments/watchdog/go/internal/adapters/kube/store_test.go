package kube_test

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/kube"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

const (
	ns     = "outegro"
	cmName = "watchdog-state-v2"
)

var configMapsResource = schema.GroupResource{Resource: "configmaps"}

func stateCM(data map[string]string) *corev1.ConfigMap {
	return &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Namespace: ns, Name: cmName, ResourceVersion: "7", Labels: map[string]string{"keep": "me"}},
		Data:       data,
	}
}

func sample() domain.State {
	return domain.State{Version: 1, DigestDay: "20261010", Entries: map[string]domain.Entry{
		"disk": {Since: 10, Notified: 20, Message: "server disk 91% used"},
	}}
}

func storedState(t *testing.T, core *fake.Clientset) (domain.State, *corev1.ConfigMap) {
	t.Helper()
	cm, err := core.CoreV1().ConfigMaps(ns).Get(t.Context(), cmName, metav1.GetOptions{})
	require.NoError(t, err)
	st, err := domain.DecodeState([]byte(cm.Data[kube.StateKey]))
	require.NoError(t, err)
	return st, cm
}

func TestLoadMissingConfigMap(t *testing.T) {
	t.Parallel()
	s := kube.NewStateStore(fake.NewClientset().CoreV1(), ns, cmName)
	_, found, err := s.Load(t.Context())
	require.NoError(t, err)
	assert.False(t, found)
}

func TestLoadExistingState(t *testing.T) {
	t.Parallel()
	raw, err := domain.EncodeState(sample())
	require.NoError(t, err)
	s := kube.NewStateStore(fake.NewClientset(stateCM(map[string]string{kube.StateKey: string(raw)})).CoreV1(), ns, cmName)

	st, found, err := s.Load(t.Context())
	require.NoError(t, err)
	assert.True(t, found)
	assert.Equal(t, sample(), st)
}

func TestLoadCorruptState(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		data map[string]string
	}{
		{name: "no state key", data: map[string]string{"state": "disk\t1\t0\tmsg"}},
		{name: "not json", data: map[string]string{kube.StateKey: "{"}},
		{name: "other version", data: map[string]string{kube.StateKey: `{"version":9}`}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			core := fake.NewClientset(stateCM(tt.data))
			s := kube.NewStateStore(core.CoreV1(), ns, cmName)
			_, found, err := s.Load(t.Context())
			require.ErrorIs(t, err, ports.ErrCorruptState)
			assert.False(t, found)

			// Treated as a first run, the next save overwrites the bad data
			// in place instead of failing on "already exists".
			require.NoError(t, s.Save(t.Context(), sample()))
			st, cm := storedState(t, core)
			assert.Equal(t, sample(), st)
			assert.Equal(t, "me", cm.Labels["keep"], "other metadata is preserved")
		})
	}
}

func TestLoadVersionErrorKeepsCause(t *testing.T) {
	t.Parallel()
	s := kube.NewStateStore(fake.NewClientset(stateCM(map[string]string{kube.StateKey: `{"version":9}`})).CoreV1(), ns, cmName)
	_, _, err := s.Load(t.Context())
	require.ErrorIs(t, err, ports.ErrCorruptState)
	require.ErrorIs(t, err, domain.ErrStateVersion, "both sentinels are reachable through the wrapping")
}

func TestLoadAPIError(t *testing.T) {
	t.Parallel()
	core := fake.NewClientset()
	core.PrependReactor("get", "configmaps", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(configMapsResource, cmName, errors.New("RBAC"))
	})
	_, _, err := kube.NewStateStore(core.CoreV1(), ns, cmName).Load(t.Context())
	require.Error(t, err)
	assert.True(t, apierrors.IsForbidden(err), "the API error stays inspectable: %v", err)
	require.NotErrorIs(t, err, ports.ErrCorruptState)
}

func TestSaveCreatesConfigMap(t *testing.T) {
	t.Parallel()
	core := fake.NewClientset()
	s := kube.NewStateStore(core.CoreV1(), ns, cmName)
	_, _, err := s.Load(t.Context())
	require.NoError(t, err)

	require.NoError(t, s.Save(t.Context(), sample()))
	st, cm := storedState(t, core)
	assert.Equal(t, sample(), st)
	assert.Equal(t, "watchdog", cm.Labels["app.kubernetes.io/managed-by"])

	// A second save in the same pass updates what was created.
	next := sample()
	next.DigestDay = "20261011"
	require.NoError(t, s.Save(t.Context(), next))
	st, _ = storedState(t, core)
	assert.Equal(t, "20261011", st.DigestDay)
}

func TestSaveUpdatesLoadedVersion(t *testing.T) {
	t.Parallel()
	raw, err := domain.EncodeState(domain.NewState())
	require.NoError(t, err)
	core := fake.NewClientset(stateCM(map[string]string{kube.StateKey: string(raw), "note": "kept"}))
	s := kube.NewStateStore(core.CoreV1(), ns, cmName)
	_, _, err = s.Load(t.Context())
	require.NoError(t, err)

	var sentVersion string
	core.PrependReactor("update", "configmaps", func(a k8stesting.Action) (bool, runtime.Object, error) {
		sentVersion = a.(k8stesting.UpdateAction).GetObject().(*corev1.ConfigMap).ResourceVersion
		return false, nil, nil // let the tracker handle it
	})
	require.NoError(t, s.Save(t.Context(), sample()))

	assert.Equal(t, "7", sentVersion, "optimistic concurrency: update the version that was read")
	st, cm := storedState(t, core)
	assert.Equal(t, sample(), st)
	assert.Equal(t, "kept", cm.Data["note"], "other keys are preserved")
}

func TestSaveRetriesOnceOnConflict(t *testing.T) {
	t.Parallel()
	core := fake.NewClientset(stateCM(map[string]string{kube.StateKey: `{"version":1}`}))
	s := kube.NewStateStore(core.CoreV1(), ns, cmName)
	_, _, err := s.Load(t.Context())
	require.NoError(t, err)

	updates, gets := 0, 0
	core.PrependReactor("update", "configmaps", func(k8stesting.Action) (bool, runtime.Object, error) {
		updates++
		if updates == 1 {
			return true, nil, apierrors.NewConflict(configMapsResource, cmName, errors.New("the object has been modified"))
		}
		return false, nil, nil
	})
	core.PrependReactor("get", "configmaps", func(k8stesting.Action) (bool, runtime.Object, error) {
		gets++
		return false, nil, nil
	})

	require.NoError(t, s.Save(t.Context(), sample()))
	assert.Equal(t, 2, updates)
	assert.Equal(t, 1, gets, "re-read once before the retry")
	st, _ := storedState(t, core)
	assert.Equal(t, sample(), st)
}

func TestSaveGivesUpAfterSecondConflict(t *testing.T) {
	t.Parallel()
	core := fake.NewClientset(stateCM(map[string]string{kube.StateKey: `{"version":1}`}))
	s := kube.NewStateStore(core.CoreV1(), ns, cmName)
	_, _, err := s.Load(t.Context())
	require.NoError(t, err)

	updates := 0
	core.PrependReactor("update", "configmaps", func(k8stesting.Action) (bool, runtime.Object, error) {
		updates++
		return true, nil, apierrors.NewConflict(configMapsResource, cmName, errors.New("modified"))
	})
	err = s.Save(t.Context(), sample())
	require.Error(t, err)
	assert.True(t, apierrors.IsConflict(err))
	assert.Equal(t, 2, updates, "exactly one retry")
}

func TestSaveWhenCreatedConcurrently(t *testing.T) {
	t.Parallel()
	core := fake.NewClientset()
	s := kube.NewStateStore(core.CoreV1(), ns, cmName)
	_, found, err := s.Load(t.Context())
	require.NoError(t, err)
	require.False(t, found)

	// Someone else creates the ConfigMap between Load and Save.
	_, err = core.CoreV1().ConfigMaps(ns).Create(t.Context(), stateCM(map[string]string{kube.StateKey: `{"version":1}`}), metav1.CreateOptions{})
	require.NoError(t, err)

	require.NoError(t, s.Save(t.Context(), sample()))
	st, _ := storedState(t, core)
	assert.Equal(t, sample(), st)
}

func TestSaveCreateError(t *testing.T) {
	t.Parallel()
	core := fake.NewClientset()
	core.PrependReactor("create", "configmaps", func(k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, apierrors.NewForbidden(configMapsResource, cmName, errors.New("RBAC"))
	})
	s := kube.NewStateStore(core.CoreV1(), ns, cmName)
	_, _, err := s.Load(t.Context())
	require.NoError(t, err)
	err = s.Save(t.Context(), sample())
	require.Error(t, err)
	assert.True(t, apierrors.IsForbidden(err))
}
