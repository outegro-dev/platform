package checks

import (
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

// Thresholds from the specification.
const (
	// DiskWarnPercent is the disk usage that is reported.
	DiskWarnPercent = 80
	// CertWarnDays is how many days before expiry a certificate is reported.
	CertWarnDays = 14
	// BackupMaxAgeHours is the age of the newest completed backup that is reported.
	BackupMaxAgeHours = 26
)

const (
	secondsPerDay  = 24 * 60 * 60
	secondsPerHour = 60 * 60
	backupComplete = "completed"
)

// pgConditions are the CloudNativePG cluster conditions that must be True.
var pgConditions = []string{"Ready", "ContinuousArchiving", "LastBackupSucceeded"}

// Nodes reports a node that is not Ready or has any other condition True
// (memory, disk or PID pressure, network unavailable).
func Nodes(nodes []domain.Node) []domain.Finding {
	var out []domain.Finding
	for i := range nodes {
		n := &nodes[i]
		for _, c := range n.Conditions {
			isReady := c.Type == domain.ConditionReady
			if (isReady && c.Status != domain.ConditionTrue) || (!isReady && c.Status == domain.ConditionTrue) {
				out = append(out, domain.Finding{
					Key:     "node:" + n.Name + ":" + c.Type,
					Message: fmt.Sprintf("node %s: %s=%s (%s)", n.Name, c.Type, c.Status, c.Reason),
				})
			}
		}
	}
	return out
}

// Disk reports the server disk when usage reaches DiskWarnPercent.
func Disk(usedPercent int) []domain.Finding {
	if usedPercent < DiskWarnPercent {
		return nil
	}
	return []domain.Finding{{Key: "disk", Message: fmt.Sprintf("server disk %d%% used", usedPercent)}}
}

// Certificates reports certificates that are not ready or expire in less
// than CertWarnDays days.
func Certificates(certs []domain.Certificate, now time.Time) []domain.Finding {
	var out []domain.Finding
	for i := range certs {
		c := &certs[i]
		key := "cert:" + c.Name
		ready, found := domain.FindCondition(c.Conditions, domain.ConditionReady)
		if !found || ready.Status != domain.ConditionTrue {
			msg := "unknown"
			if found && ready.Message != "" {
				msg = ready.Message
			}
			out = append(out, domain.Finding{Key: key, Message: fmt.Sprintf("certificate %s not ready: %s", c.Name, msg)})
			continue
		}
		// A ready certificate always has notAfter; the script treated a
		// missing one as the unix epoch, which reports it. Keep that.
		notAfter := int64(0)
		if !c.NotAfter.IsZero() {
			notAfter = c.NotAfter.Unix()
		}
		if days := floorDiv(notAfter-now.Unix(), secondsPerDay); days < CertWarnDays {
			out = append(out, domain.Finding{Key: key, Message: fmt.Sprintf("certificate %s expires in %d days", c.Name, days)})
		}
	}
	return out
}

// CertDaysLeft is the smallest number of whole days until notAfter among
// issued certificates; false when no certificate has notAfter.
func CertDaysLeft(certs []domain.Certificate, now time.Time) (int, bool) {
	best, found := int64(0), false
	for i := range certs {
		if certs[i].NotAfter.IsZero() {
			continue
		}
		days := floorDiv(certs[i].NotAfter.Unix()-now.Unix(), secondsPerDay)
		if !found || days < best {
			best, found = days, true
		}
	}
	return int(best), found
}

// PostgresCluster reports cluster conditions that are not True. A nil
// cluster means it does not exist.
func PostgresCluster(cluster *domain.PGCluster) []domain.Finding {
	if cluster == nil {
		return []domain.Finding{{Key: "pg:cluster", Message: "PostgreSQL cluster pg is missing"}}
	}
	var out []domain.Finding
	for _, c := range cluster.Conditions {
		if !slices.Contains(pgConditions, c.Type) || c.Status == domain.ConditionTrue {
			continue
		}
		out = append(out, domain.Finding{
			Key:     "pg:" + c.Type,
			Message: fmt.Sprintf("PostgreSQL %s: %s %s", c.Type, c.Reason, c.Message),
		})
	}
	return out
}

// Backups reports when the newest completed backup is BackupMaxAgeHours
// old or older, or when there is none. It also returns the age in whole
// hours of the newest completed backup (false when there is none).
func Backups(backups []domain.Backup, now time.Time) ([]domain.Finding, int, bool) {
	var newest time.Time
	for i := range backups {
		b := &backups[i]
		if b.Phase == backupComplete && !b.StoppedAt.IsZero() && b.StoppedAt.After(newest) {
			newest = b.StoppedAt
		}
	}
	if newest.IsZero() {
		return []domain.Finding{{Key: "pg:backup-age", Message: "no completed backup found"}}, 0, false
	}
	hours := int((now.Unix() - newest.Unix()) / secondsPerHour)
	if hours >= BackupMaxAgeHours {
		return []domain.Finding{{Key: "pg:backup-age", Message: fmt.Sprintf("last completed backup is %d h old", hours)}}, hours, true
	}
	return nil, hours, true
}

// ArgoApps reports applications that are not Synced or not Healthy.
func ArgoApps(apps []domain.ArgoApp) []domain.Finding {
	var out []domain.Finding
	for i := range apps {
		a := &apps[i]
		if a.SyncStatus == "Synced" && a.HealthStatus == "Healthy" {
			continue
		}
		out = append(out, domain.Finding{
			Key:     "argo:" + a.Name,
			Message: fmt.Sprintf("Argo CD %s: %s / %s", a.Name, orUnknown(a.SyncStatus), orUnknown(a.HealthStatus)),
		})
	}
	return out
}

// Probes reports HTTP endpoints that did not answer 200.
func Probes(results []domain.ProbeResult) []domain.Finding {
	var out []domain.Finding
	for _, r := range results {
		if r.Code == http.StatusOK {
			continue
		}
		answer := "no response"
		if r.Code != 0 {
			answer = strconv.Itoa(r.Code)
		}
		out = append(out, domain.Finding{Key: "http:" + r.Name, Message: fmt.Sprintf("%s answered %s", r.URL, answer)})
	}
	return out
}

func orUnknown(s string) string {
	if s == "" {
		return "?"
	}
	return s
}

// floorDiv divides rounding towards negative infinity, like jq's floor.
func floorDiv(a, b int64) int64 {
	q := a / b
	if a%b != 0 && (a < 0) != (b < 0) {
		q--
	}
	return q
}
