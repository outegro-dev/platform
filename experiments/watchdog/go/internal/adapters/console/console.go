// Package console implements ports.Notifier by printing messages, for
// DRY_RUN (shadow) mode: nothing leaves the process.
package console

import (
	"context"
	"fmt"
	"io"
	"sync"

	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

var _ ports.Notifier = (*Notifier)(nil)

// Notifier writes every message to w, framed so it is easy to compare
// with what the shell watchdog sent.
type Notifier struct {
	mu sync.Mutex
	w  io.Writer
}

// New returns a Notifier that writes to w (os.Stdout in main).
func New(w io.Writer) *Notifier {
	return &Notifier{w: w}
}

// Send prints text. It is safe for concurrent use.
func (n *Notifier) Send(_ context.Context, text string) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	if _, err := fmt.Fprintf(n.w, "----- dry run: telegram message -----\n%s\n", text); err != nil {
		return fmt.Errorf("console: %w", err)
	}
	return nil
}
