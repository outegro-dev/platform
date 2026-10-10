package checks

import "testing"

// TestFloorDiv is an internal test (package checks, not checks_test): it can
// reach the unexported helper.
func TestFloorDiv(t *testing.T) {
	t.Parallel()

	tests := []struct{ a, b, want int64 }{
		{a: 7, b: 2, want: 3},
		{a: 6, b: 2, want: 3},
		{a: -1, b: 86400, want: -1},
		{a: -86400, b: 86400, want: -1},
		{a: -86401, b: 86400, want: -2},
		{a: 0, b: 86400, want: 0},
	}
	for _, tt := range tests {
		if got := floorDiv(tt.a, tt.b); got != tt.want {
			t.Errorf("floorDiv(%d, %d) = %d, want %d", tt.a, tt.b, got, tt.want)
		}
	}
}
