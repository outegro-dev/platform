// Package disk implements ports.DiskStat with statfs(2).
package disk

import (
	"errors"
	"fmt"

	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

// ErrEmptyFilesystem reports a filesystem with no usable blocks.
var ErrEmptyFilesystem = errors.New("filesystem reports no blocks")

var _ ports.DiskStat = (*Statfs)(nil)

// Statfs reports the usage of the filesystem that holds Path. In the
// cluster Path is a tiny local-path volume, which lives on the node's root
// filesystem, so its usage is the server disk usage.
type Statfs struct {
	Path string
}

// NewStatfs returns a DiskStat for path.
func NewStatfs(path string) *Statfs {
	return &Statfs{Path: path}
}

// UsedPercent returns the used share of the filesystem like df(1).
func (s *Statfs) UsedPercent() (int, error) {
	blocks, free, avail, err := statfs(s.Path)
	if err != nil {
		return 0, fmt.Errorf("statfs %s: %w", s.Path, err)
	}
	return usedPercent(blocks, free, avail)
}

// usedPercent follows coreutils df: used = blocks - free; the percentage
// is used / (used + available to unprivileged users), rounded up. Blocks
// reserved for root are therefore not counted as free.
func usedPercent(blocks, free, avail uint64) (int, error) {
	if free > blocks {
		free = blocks
	}
	used := blocks - free
	total := used + avail
	if total == 0 {
		return 0, ErrEmptyFilesystem
	}
	pct := (used*100 + total - 1) / total
	return int(pct), nil //nolint:gosec // pct is at most 100
}
