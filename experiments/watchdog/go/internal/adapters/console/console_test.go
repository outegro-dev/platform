package console_test

import (
	"bytes"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/console"
)

func TestSend(t *testing.T) {
	t.Parallel()
	var buf bytes.Buffer
	n := console.New(&buf)
	require.NoError(t, n.Send(t.Context(), "🟢 outegro.dev: recovered\n• server disk 91% used"))
	assert.Equal(t, "----- dry run: telegram message -----\n🟢 outegro.dev: recovered\n• server disk 91% used\n", buf.String())
}

type brokenWriter struct{}

func (brokenWriter) Write([]byte) (int, error) { return 0, errors.New("closed pipe") }

func TestSendWriteError(t *testing.T) {
	t.Parallel()
	err := console.New(brokenWriter{}).Send(t.Context(), "x")
	require.ErrorContains(t, err, "closed pipe")
}
