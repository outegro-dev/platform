// Package httpprobe implements ports.Prober with net/http.
package httpprobe

import (
	"context"
	"io"
	"net/http"
	"time"

	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

// maxDrain is how much of a response body is read so the connection can be
// reused; the content itself is not needed.
const maxDrain = 64 << 10

var _ ports.Prober = (*Prober)(nil)

// Prober performs GET requests and reports the status code.
type Prober struct {
	client    *http.Client
	timeout   time.Duration
	userAgent string
}

// New returns a Prober with a per-request timeout. Redirects are not
// followed: like curl without -L, a 301 is reported as 301.
func New(timeout time.Duration, userAgent string) *Prober {
	return &Prober{
		client: &http.Client{
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
		timeout:   timeout,
		userAgent: userAgent,
	}
}

// Probe fetches url and returns its status code. Any transport error,
// including the timeout, is returned as an error.
func (p *Prober) Probe(ctx context.Context, url string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, p.timeout)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, http.NoBody)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", p.userAgent)

	resp, err := p.client.Do(req)
	if err != nil {
		return 0, err // *url.Error already names the method and URL
	}
	defer func() { _ = resp.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxDrain))
	return resp.StatusCode, nil
}
