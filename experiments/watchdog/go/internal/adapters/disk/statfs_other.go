//go:build !linux && !darwin

package disk

import (
	"errors"
	"fmt"
	"runtime"
)

// statfs is not available on this platform; the watchdog runs on Linux.
func statfs(string) (blocks, free, avail uint64, err error) {
	return 0, 0, 0, fmt.Errorf("statfs on %s: %w", runtime.GOOS, errors.ErrUnsupported)
}
