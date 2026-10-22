// Package ports declares what the watchdog core needs from the outside
// world. Adapters in internal/adapters satisfy these interfaces implicitly
// (Go has no "implements"); tests satisfy them with small in-memory fakes.
package ports

import (
	"context"
	"errors"
	"time"

	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
)

// ErrNotFound reports that a requested object does not exist.
var ErrNotFound = errors.New("not found")

// ErrCorruptState reports a stored state that cannot be read. The caller
// treats it as a first run.
var ErrCorruptState = errors.New("stored state is unreadable")

// ClusterSource reads the Kubernetes objects the checks look at and
// returns them as domain values, not raw API objects.
type ClusterSource interface {
	// Pods lists pods in all namespaces.
	Pods(ctx context.Context) ([]domain.Pod, error)
	Nodes(ctx context.Context) ([]domain.Node, error)
	// Certificates lists cert-manager certificates in all namespaces.
	Certificates(ctx context.Context) ([]domain.Certificate, error)
	// PostgresCluster returns an error wrapping ErrNotFound when the
	// cluster does not exist.
	PostgresCluster(ctx context.Context, namespace, name string) (domain.PGCluster, error)
	Backups(ctx context.Context, namespace string) ([]domain.Backup, error)
	ArgoApps(ctx context.Context, namespace string) ([]domain.ArgoApp, error)
}

// Prober fetches a URL and returns the HTTP status code.
type Prober interface {
	Probe(ctx context.Context, url string) (int, error)
}

// AlertsSource returns the active Prometheus alerts.
type AlertsSource interface {
	Alerts(ctx context.Context) ([]domain.Alert, error)
}

// DiskStat reports how full the server disk is, in percent, rounded up.
type DiskStat interface {
	UsedPercent() (int, error)
}

// StateStore keeps the alerting state between passes.
type StateStore interface {
	// Load returns found == false when nothing has been saved yet and an
	// error wrapping ErrCorruptState when the stored data is unreadable.
	Load(ctx context.Context) (state domain.State, found bool, err error)
	Save(ctx context.Context, state domain.State) error
}

// Notifier delivers one message to the owner.
type Notifier interface {
	Send(ctx context.Context, text string) error
}

// Clock tells the time; tests use a fixed one.
type Clock interface {
	Now() time.Time
}
