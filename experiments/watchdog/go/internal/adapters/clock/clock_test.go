package clock_test

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"github.com/outegro-dev/watchdog-lab/go/internal/adapters/clock"
)

func TestSystemIsUTC(t *testing.T) {
	t.Parallel()
	now := clock.System{}.Now()
	assert.Equal(t, time.UTC, now.Location())
	assert.WithinDuration(t, time.Now(), now, time.Minute)
}

func TestFixed(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 10, 10, 7, 0, 0, 0, time.UTC)
	assert.Equal(t, at, clock.Fixed(at).Now())
}
