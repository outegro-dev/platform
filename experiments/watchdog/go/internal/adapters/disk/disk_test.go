package disk

import (
	"path/filepath"
	"runtime"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestUsedPercent(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                string
		blocks, free, avail uint64
		want                int
	}{
		{name: "empty disk", blocks: 1000, free: 1000, avail: 950, want: 0},
		{name: "exact 80 %", blocks: 1000, free: 200, avail: 200, want: 80},
		{name: "rounds up like df", blocks: 1000, free: 201, avail: 201, want: 80},                     // 79.9 % -> 80
		{name: "root reserve counts as used for users", blocks: 1000, free: 250, avail: 200, want: 79}, // 750/950 = 78.9 -> 79
		{name: "full for users", blocks: 1000, free: 50, avail: 0, want: 100},
		{name: "free larger than blocks is clamped", blocks: 10, free: 20, avail: 10, want: 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got, err := usedPercent(tt.blocks, tt.free, tt.avail)
			require.NoError(t, err)
			assert.Equal(t, tt.want, got)
		})
	}

	_, err := usedPercent(0, 0, 0)
	require.ErrorIs(t, err, ErrEmptyFilesystem)
}

func TestStatfs(t *testing.T) {
	t.Parallel()
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("statfs is only implemented for linux and darwin")
	}

	pct, err := NewStatfs(t.TempDir()).UsedPercent()
	require.NoError(t, err)
	assert.GreaterOrEqual(t, pct, 0)
	assert.LessOrEqual(t, pct, 100)

	_, err = NewStatfs(filepath.Join(t.TempDir(), "missing")).UsedPercent()
	require.ErrorContains(t, err, "statfs")
}
