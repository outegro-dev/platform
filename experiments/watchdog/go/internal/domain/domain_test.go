package domain_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

func TestDedupeKeepsFirst(t *testing.T) {
	t.Parallel()

	in := []domain.Finding{
		{Key: "pod:outegro/auth", Message: "first replica"},
		{Key: "disk", Message: "disk"},
		{Key: "pod:outegro/auth", Message: "second replica"},
	}
	assert.Equal(t, []domain.Finding{
		{Key: "pod:outegro/auth", Message: "first replica"},
		{Key: "disk", Message: "disk"},
	}, domain.Dedupe(in))
	assert.Empty(t, domain.Dedupe(nil))
}

func TestStateRoundTrip(t *testing.T) {
	t.Parallel()

	st := domain.State{
		DigestDay: "20261010",
		Entries: map[string]domain.Entry{
			"disk":          {Since: 100, Notified: 200, Message: "server disk 91% used"},
			"argo:platform": {Since: 300, Message: "Argo CD platform: OutOfSync / Healthy"},
		},
	}
	data, err := domain.EncodeState(st)
	require.NoError(t, err)
	// Version is always written; keys are sorted, so the output is stable.
	assert.JSONEq(t, `{
		"version": 1,
		"digestDay": "20261010",
		"entries": {
			"argo:platform": {"since": 300, "notified": 0, "message": "Argo CD platform: OutOfSync / Healthy"},
			"disk": {"since": 100, "notified": 200, "message": "server disk 91% used"}
		}
	}`, string(data))

	got, err := domain.DecodeState(data)
	require.NoError(t, err)
	st.Version = domain.StateVersion
	assert.Equal(t, st, got)
}

func TestEncodeEmptyState(t *testing.T) {
	t.Parallel()
	data, err := domain.EncodeState(domain.State{})
	require.NoError(t, err)
	assert.JSONEq(t, `{"version":1,"entries":{}}`, string(data))
}

func TestDecodeState(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name    string
		data    string
		fails   bool
		wantErr error // checked with errors.Is when set
	}{
		{name: "minimal", data: `{"version":1}`},
		{name: "unknown fields are tolerated", data: `{"version":1,"entries":{},"extra":true}`},
		{name: "future version", data: `{"version":2,"entries":{}}`, fails: true, wantErr: domain.ErrStateVersion},
		{name: "missing version", data: `{"entries":{}}`, fails: true, wantErr: domain.ErrStateVersion},
		{name: "shell script format", data: "disk\t100\t0\tmsg", fails: true},
		{name: "wrong type", data: `{"version":"1"}`, fails: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			st, err := domain.DecodeState([]byte(tt.data))
			if !tt.fails {
				require.NoError(t, err)
				assert.NotNil(t, st.Entries, "entries are never nil after decoding")
				return
			}
			require.Error(t, err)
			if tt.wantErr != nil {
				require.ErrorIs(t, err, tt.wantErr)
			}
		})
	}
}

func TestCloneIsDeep(t *testing.T) {
	t.Parallel()

	orig := domain.State{Version: 1, Entries: map[string]domain.Entry{"disk": {Since: 1}}}
	c := orig.Clone()
	c.Entries["disk"] = domain.Entry{Since: 2}
	c.Entries["new"] = domain.Entry{}
	assert.Equal(t, int64(1), orig.Entries["disk"].Since)
	assert.Len(t, orig.Entries, 1)

	assert.NotNil(t, domain.State{}.Clone().Entries)
}

func TestFindCondition(t *testing.T) {
	t.Parallel()

	conds := []domain.Condition{
		{Type: "PodScheduled", Status: "True"},
		{Type: "Ready", Status: "False", LastTransitionTime: time.Unix(10, 0)},
	}
	c, ok := domain.FindCondition(conds, "Ready")
	assert.True(t, ok)
	assert.Equal(t, "False", c.Status)

	_, ok = domain.FindCondition(conds, "Initialized")
	assert.False(t, ok)
}

func TestPtr(t *testing.T) {
	t.Parallel()
	p := domain.Ptr(42)
	assert.Equal(t, 42, *p)
}
