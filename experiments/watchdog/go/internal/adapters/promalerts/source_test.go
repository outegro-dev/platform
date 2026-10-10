package promalerts_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/promalerts"
	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

const alertsJSON = `{
  "status": "success",
  "data": {
    "alerts": [
      {
        "labels": {"alertname": "KubeJobFailed", "severity": "warning", "namespace": "outegro", "job_name": "migrate"},
        "annotations": {"summary": "Job failed to complete."},
        "state": "firing",
        "activeAt": "2026-10-10T10:00:00Z",
        "value": "1e+00"
      },
      {
        "labels": {"alertname": "Watchdog", "severity": "none"},
        "annotations": {},
        "state": "firing",
        "activeAt": "2026-10-01T00:00:00Z",
        "value": "1e+00"
      }
    ]
  }
}`

func TestAlerts(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/alerts" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(alertsJSON))
	}))
	t.Cleanup(srv.Close)

	src, err := promalerts.New(srv.URL, time.Second)
	require.NoError(t, err)
	alerts, err := src.Alerts(t.Context())
	require.NoError(t, err)

	assert.Equal(t, []domain.Alert{
		{
			State:       "firing",
			Labels:      map[string]string{"alertname": "KubeJobFailed", "severity": "warning", "namespace": "outegro", "job_name": "migrate"},
			Annotations: map[string]string{"summary": "Job failed to complete."},
		},
		{
			State:       "firing",
			Labels:      map[string]string{"alertname": "Watchdog", "severity": "none"},
			Annotations: map[string]string{},
		},
	}, alerts)
}

func TestAlertsErrors(t *testing.T) {
	t.Parallel()

	t.Run("server error", func(t *testing.T) {
		t.Parallel()
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			http.Error(w, "boom", http.StatusInternalServerError)
		}))
		t.Cleanup(srv.Close)
		src, err := promalerts.New(srv.URL, time.Second)
		require.NoError(t, err)
		_, err = src.Alerts(t.Context())
		require.ErrorContains(t, err, "prometheus alerts")
	})

	t.Run("timeout", func(t *testing.T) {
		t.Parallel()
		srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
			select {
			case <-r.Context().Done():
			case <-time.After(5 * time.Second):
			}
		}))
		t.Cleanup(srv.Close)
		src, err := promalerts.New(srv.URL, 100*time.Millisecond)
		require.NoError(t, err)
		start := time.Now()
		_, err = src.Alerts(t.Context())
		require.ErrorIs(t, err, context.DeadlineExceeded)
		assert.Less(t, time.Since(start), 2*time.Second)
	})

	t.Run("bad address", func(t *testing.T) {
		t.Parallel()
		_, err := promalerts.New("http://[::1", time.Second)
		require.Error(t, err)
	})
}
