//go:build linux || darwin

package disk

import "golang.org/x/sys/unix"

// statfs returns the total, free and unprivileged-available block counts.
func statfs(path string) (blocks, free, avail uint64, err error) {
	var st unix.Statfs_t
	if err := unix.Statfs(path, &st); err != nil {
		return 0, 0, 0, err
	}
	return st.Blocks, st.Bfree, st.Bavail, nil
}
