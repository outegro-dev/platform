package telegram_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/telegram"
)

const token = "123456:AAH-very-secret-token"

type received struct {
	path        string
	contentType string
	userAgent   string
	body        map[string]any
}

func server(t *testing.T, status int, response string) (*httptest.Server, *[]received) {
	t.Helper()
	var (
		mu  sync.Mutex
		got []received
	)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		got = append(got, received{path: r.URL.Path, contentType: r.Header.Get("Content-Type"), userAgent: r.UserAgent(), body: body})
		mu.Unlock()
		w.WriteHeader(status)
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(srv.Close)
	return srv, &got
}

func TestSend(t *testing.T) {
	t.Parallel()
	srv, got := server(t, http.StatusOK, `{"ok":true,"result":{"message_id":1}}`)

	c := telegram.New(srv.URL+"/", token, "-100123", telegram.WithUserAgent("outegro-watchdog/test"))
	require.NoError(t, c.Send(t.Context(), "🔴 outegro.dev: problem\n• server disk 91% used"))

	require.Len(t, *got, 1)
	r := (*got)[0]
	assert.Equal(t, "/bot"+token+"/sendMessage", r.path)
	assert.Equal(t, "application/json", r.contentType)
	assert.Equal(t, "outegro-watchdog/test", r.userAgent)
	assert.Equal(t, map[string]any{
		"chat_id":              "-100123",
		"text":                 "🔴 outegro.dev: problem\n• server disk 91% used",
		"link_preview_options": map[string]any{"is_disabled": true},
	}, r.body)
}

func TestSendRejected(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		status   int
		response string
		want     string
	}{
		{name: "bad request", status: http.StatusBadRequest, response: `{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}`, want: "HTTP 400: Bad Request: chat not found"},
		{name: "unauthorized", status: http.StatusUnauthorized, response: `{"ok":false,"description":"Unauthorized"}`, want: "HTTP 401: Unauthorized"},
		{name: "html error page", status: http.StatusBadGateway, response: `<html>bad gateway</html>`, want: "HTTP 502: Bad Gateway"},
		{name: "ok status but ok=false", status: http.StatusOK, response: `{"ok":false,"description":"strange"}`, want: "HTTP 200: strange"},
		{name: "description quoting the token", status: http.StatusNotFound, response: `{"ok":false,"description":"no bot ` + token + `"}`, want: "no bot ***"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			srv, _ := server(t, tt.status, tt.response)
			err := telegram.New(srv.URL, token, "1").Send(t.Context(), "hi")
			require.Error(t, err)
			assert.Contains(t, err.Error(), tt.want)
			assert.NotContains(t, err.Error(), token)

			var apiErr *telegram.APIError
			require.ErrorAs(t, err, &apiErr)
			assert.Equal(t, tt.status, apiErr.StatusCode)
		})
	}
}

func TestSendBadJSONWithOKStatus(t *testing.T) {
	t.Parallel()
	srv, _ := server(t, http.StatusOK, `not json`)
	err := telegram.New(srv.URL, token, "1").Send(t.Context(), "hi")
	require.Error(t, err)
	assert.NotContains(t, err.Error(), token)
}

func TestTransportErrorsMaskTheToken(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.NotFoundHandler())
	addr := srv.URL
	srv.Close() // connection refused from now on

	err := telegram.New(addr, token, "1").Send(t.Context(), "hi")
	require.Error(t, err)
	assert.NotContains(t, err.Error(), token)
	assert.Contains(t, err.Error(), "/bot***/sendMessage")

	var ue *url.Error
	require.ErrorAs(t, err, &ue, "still a *url.Error for callers that inspect it")
	assert.NotContains(t, ue.URL, token)
}

func TestTimeoutMasksTheTokenAndKeepsTheCause(t *testing.T) {
	t.Parallel()

	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		// Reading the body lets net/http watch the connection, so the
		// request context ends as soon as the client gives up.
		_, _ = io.Copy(io.Discard, r.Body)
		select {
		case <-r.Context().Done():
		case <-time.After(5 * time.Second):
		}
	}))
	t.Cleanup(srv.Close)

	err := telegram.New(srv.URL, token, "1", telegram.WithTimeout(100*time.Millisecond)).Send(t.Context(), "hi")
	require.Error(t, err)
	assert.NotContains(t, err.Error(), token)
	assert.ErrorIs(t, err, context.DeadlineExceeded, "errors.Is sees the cause through the masking")
}

func TestBadBaseURLMasksTheToken(t *testing.T) {
	t.Parallel()
	err := telegram.New("http://bad host", token, "1").Send(t.Context(), "hi")
	require.Error(t, err)
	assert.NotContains(t, err.Error(), token)
}

func TestPrintingTheClientMasksTheToken(t *testing.T) {
	t.Parallel()
	c := telegram.New("https://api.telegram.org", token, "1")
	for _, format := range []string{"%v", "%+v", "%#v", "%s"} {
		out := fmt.Sprintf(format, c)
		assert.NotContains(t, out, token, format)
		assert.Contains(t, out, "/bot***/sendMessage", format)
	}
}

func TestCustomHTTPClient(t *testing.T) {
	t.Parallel()
	srv, got := server(t, http.StatusOK, `{"ok":true}`)
	c := telegram.New(srv.URL, token, "1", telegram.WithHTTPClient(srv.Client()))
	require.NoError(t, c.Send(t.Context(), "hi"))
	assert.Len(t, *got, 1)
}
