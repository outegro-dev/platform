// Package domain holds the watchdog's core types: what the checks look at,
// what they produce and what the alerting remembers between passes.
//
// The package has no I/O and no dependencies outside the standard library,
// so every other package can import it.
package domain

// Finding is one detected problem. Key identifies the problem across passes
// (for example "pod:outegro/auth-backend"); Message is the line the owner sees.
type Finding struct {
	Key     string
	Message string
}

// Facts feed the daily digest. A nil pointer means "unknown" and is printed
// as "?" in the message.
type Facts struct {
	PodsRunning     *int
	BackupAgeHours  *int
	CertDaysLeft    *int
	DiskUsedPercent *int
}

// Ptr returns a pointer to a copy of v. It keeps call sites short when
// filling optional fields such as Facts.
func Ptr[T any](v T) *T {
	return &v
}

// Dedupe keeps the first finding for every key and preserves input order.
func Dedupe(findings []Finding) []Finding {
	seen := make(map[string]struct{}, len(findings))
	out := make([]Finding, 0, len(findings))
	for _, f := range findings {
		if _, dup := seen[f.Key]; dup {
			continue
		}
		seen[f.Key] = struct{}{}
		out = append(out, f)
	}
	return out
}
