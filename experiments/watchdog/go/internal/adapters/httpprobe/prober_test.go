package httpprobe_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/httpprobe"
)

func TestProbe(t *testing.T) {
	t.Parallel()

	var gotUA string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/ok":
			gotUA = r.Header.Get("User-Agent")
			_, _ = w.Write([]byte(strings.Repeat("x", 1<<20))) // large body is drained, not a problem
		case "/down":
			w.WriteHeader(http.StatusServiceUnavailable)
		case "/moved":
			http.Redirect(w, r, "/ok", http.StatusMovedPermanently)
		case "/slow":
			select {
			case <-r.Context().Done():
			case <-time.After(5 * time.Second):
			}
		}
	}))
	t.Cleanup(srv.Close)

	p := httpprobe.New(200*time.Millisecond, "outegro-watchdog/test")

	code, err := p.Probe(t.Context(), srv.URL+"/ok")
	require.NoError(t, err)
	assert.Equal(t, http.StatusOK, code)
	assert.Equal(t, "outegro-watchdog/test", gotUA)

	code, err = p.Probe(t.Context(), srv.URL+"/down")
	require.NoError(t, err)
	assert.Equal(t, http.StatusServiceUnavailable, code)

	code, err = p.Probe(t.Context(), srv.URL+"/moved")
	require.NoError(t, err)
	assert.Equal(t, http.StatusMovedPermanently, code, "redirects are reported, not followed")

	start := time.Now()
	_, err = p.Probe(t.Context(), srv.URL+"/slow")
	require.ErrorIs(t, err, context.DeadlineExceeded)
	assert.Less(t, time.Since(start), 2*time.Second, "the probe timeout applies")
}

func TestProbeNoServer(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.NotFoundHandler())
	url := srv.URL
	srv.Close()

	_, err := httpprobe.New(time.Second, "ua").Probe(t.Context(), url)
	require.Error(t, err)
}

func TestProbeBadURL(t *testing.T) {
	t.Parallel()
	_, err := httpprobe.New(time.Second, "ua").Probe(t.Context(), "http://bad host/")
	require.Error(t, err)
}

func TestProbeHonoursParentCancellation(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { <-r.Context().Done() }))
	t.Cleanup(srv.Close)

	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	_, err := httpprobe.New(time.Minute, "ua").Probe(ctx, srv.URL)
	require.ErrorIs(t, err, context.Canceled)
}
