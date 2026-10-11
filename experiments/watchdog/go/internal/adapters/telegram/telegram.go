// Package telegram implements ports.Notifier with the Telegram Bot API.
package telegram

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

// DefaultTimeout bounds one sendMessage call (the shell script used 15 s).
const DefaultTimeout = 15 * time.Second

// maxResponse caps how much of a response is read.
const maxResponse = 1 << 20

// APIError is a response the Bot API rejected.
type APIError struct {
	StatusCode  int
	Description string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("telegram: sendMessage rejected with HTTP %d: %s", e.StatusCode, e.Description)
}

var _ ports.Notifier = (*Client)(nil)

// Client sends messages to one chat. The bot token is part of the API URL,
// so every error that could carry the URL is rewritten with the token
// masked before it leaves this package.
type Client struct {
	http      *http.Client
	endpoint  string // contains the token: never log or wrap it
	masked    string // the same URL with the token replaced by ***
	token     string
	chatID    string
	timeout   time.Duration
	userAgent string
}

// Option customises a Client.
type Option func(*Client)

// WithTimeout overrides DefaultTimeout.
func WithTimeout(d time.Duration) Option { return func(c *Client) { c.timeout = d } }

// WithHTTPClient replaces the HTTP client (tests, proxies).
func WithHTTPClient(hc *http.Client) Option { return func(c *Client) { c.http = hc } }

// WithUserAgent sets the User-Agent header.
func WithUserAgent(ua string) Option { return func(c *Client) { c.userAgent = ua } }

// New returns a Client for apiURL (https://api.telegram.org in production).
func New(apiURL, token, chatID string, opts ...Option) *Client {
	base := strings.TrimRight(apiURL, "/")
	c := &Client{
		http:     &http.Client{},
		endpoint: base + "/bot" + token + "/sendMessage",
		masked:   base + "/bot***/sendMessage",
		token:    token,
		chatID:   chatID,
		timeout:  DefaultTimeout,
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// String keeps the token out of %v and %+v: fmt would otherwise print the
// unexported fields, endpoint and token included.
func (c *Client) String() string { return "telegram.Client(" + c.masked + ")" }

// GoString does the same for %#v.
func (c *Client) GoString() string { return c.String() }

type sendMessageRequest struct {
	ChatID             string             `json:"chat_id"`
	Text               string             `json:"text"`
	LinkPreviewOptions linkPreviewOptions `json:"link_preview_options"`
}

type linkPreviewOptions struct {
	IsDisabled bool `json:"is_disabled"`
}

type apiResponse struct {
	OK          bool   `json:"ok"`
	Description string `json:"description"`
}

// Send delivers text as a plain message with link previews disabled.
func (c *Client) Send(ctx context.Context, text string) error {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()

	body, err := json.Marshal(sendMessageRequest{
		ChatID:             c.chatID,
		Text:               text,
		LinkPreviewOptions: linkPreviewOptions{IsDisabled: true},
	})
	if err != nil {
		return fmt.Errorf("telegram: encode request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.endpoint, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("telegram: build request: %w", c.redact(err))
	}
	req.Header.Set("Content-Type", "application/json")
	if c.userAgent != "" {
		req.Header.Set("User-Agent", c.userAgent)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("telegram: sendMessage: %w", c.redact(err))
	}
	defer func() { _ = resp.Body.Close() }()

	var out apiResponse
	decodeErr := json.NewDecoder(io.LimitReader(resp.Body, maxResponse)).Decode(&out)
	if resp.StatusCode != http.StatusOK || !out.OK {
		desc := out.Description
		if desc == "" {
			desc = http.StatusText(resp.StatusCode)
		}
		return &APIError{StatusCode: resp.StatusCode, Description: c.scrub(desc)}
	}
	if decodeErr != nil {
		return fmt.Errorf("telegram: decode response: %w", decodeErr)
	}
	return nil
}

// redact replaces the URL inside a *url.Error (which net/http returns from
// Do and includes in its message) with the masked one. The wrapped cause is
// kept, so errors.Is(err, context.DeadlineExceeded) still works.
func (c *Client) redact(err error) error {
	var ue *url.Error
	if errors.As(err, &ue) {
		return &url.Error{Op: ue.Op, URL: c.masked, Err: c.redactInner(ue.Err)}
	}
	return c.redactInner(err)
}

// redactInner is a last line of defence for causes that might quote the
// URL themselves: their text is scrubbed, their identity is dropped.
func (c *Client) redactInner(err error) error {
	if err == nil || c.token == "" || !strings.Contains(err.Error(), c.token) {
		return err
	}
	return errors.New(c.scrub(err.Error()))
}

func (c *Client) scrub(s string) string {
	if c.token == "" {
		return s
	}
	return strings.ReplaceAll(s, c.token, "***")
}
