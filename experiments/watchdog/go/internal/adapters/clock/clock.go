// Package clock implements ports.Clock.
package clock

import (
	"time"

	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

var (
	_ ports.Clock = System{}
	_ ports.Clock = Fixed{}
)

// System is the real clock, in UTC.
type System struct{}

// Now returns the current time in UTC.
func (System) Now() time.Time { return time.Now().UTC() }

// Fixed always returns the same instant; tests use it.
type Fixed time.Time

// Now returns the fixed instant.
func (f Fixed) Now() time.Time { return time.Time(f) }
