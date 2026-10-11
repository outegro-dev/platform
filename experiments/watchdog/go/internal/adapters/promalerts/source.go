// Package promalerts implements ports.AlertsSource with the official
// Prometheus Go client (GET /api/v1/alerts).
package promalerts

import (
	"context"
	"fmt"
	"time"

	"github.com/prometheus/client_golang/api"
	promv1 "github.com/prometheus/client_golang/api/prometheus/v1"
	"github.com/prometheus/common/model"

	"github.com/outegro-dev/watchdog-lab/go/internal/domain"
	"github.com/outegro-dev/watchdog-lab/go/internal/ports"
)

var _ ports.AlertsSource = (*Source)(nil)

// Source reads active alerts from Prometheus.
type Source struct {
	api     promv1.API
	timeout time.Duration
}

// New returns a Source for the Prometheus server at address. Each call to
// Alerts is bounded by timeout.
func New(address string, timeout time.Duration) (*Source, error) {
	client, err := api.NewClient(api.Config{Address: address})
	if err != nil {
		return nil, fmt.Errorf("prometheus client: %w", err)
	}
	return &Source{api: promv1.NewAPI(client), timeout: timeout}, nil
}

// Alerts returns the active alerts.
func (s *Source) Alerts(ctx context.Context) ([]domain.Alert, error) {
	ctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	res, err := s.api.Alerts(ctx)
	if err != nil {
		return nil, fmt.Errorf("prometheus alerts: %w", err)
	}
	out := make([]domain.Alert, 0, len(res.Alerts))
	for _, a := range res.Alerts {
		out = append(out, domain.Alert{
			State:       string(a.State),
			Labels:      toMap(a.Labels),
			Annotations: toMap(a.Annotations),
		})
	}
	return out, nil
}

func toMap(ls model.LabelSet) map[string]string {
	out := make(map[string]string, len(ls))
	for k, v := range ls {
		out[string(k)] = string(v)
	}
	return out
}
