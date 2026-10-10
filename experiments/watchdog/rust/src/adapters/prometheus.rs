//! [`AlertsSource`] over the Prometheus HTTP API (`GET /api/v1/alerts`).
//!
//! There is no official Rust client for the Prometheus query API; the
//! endpoint is one GET with a small JSON body, so `reqwest` + serde structs
//! for the fields we read are the simplest correct option.

use std::collections::BTreeMap;
use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;
use url::Url;

use crate::domain::Alert;
use crate::ports::{AlertsSource, SourceError};

#[derive(Debug, Clone)]
pub struct PrometheusAlerts {
    client: reqwest::Client,
    alerts_url: Url,
    timeout: Duration,
}

impl PrometheusAlerts {
    /// `base` is `PROMETHEUS_URL`; the path is appended like the script's
    /// `"$PROMETHEUS/api/v1/alerts"`, so a base path prefix is kept.
    pub fn new(
        client: reqwest::Client,
        base: &Url,
        timeout: Duration,
    ) -> Result<Self, url::ParseError> {
        let alerts_url = Url::parse(&format!(
            "{}/api/v1/alerts",
            base.as_str().trim_end_matches('/')
        ))?;
        Ok(Self {
            client,
            alerts_url,
            timeout,
        })
    }
}

#[derive(Debug, Deserialize)]
struct AlertsResponse {
    status: String,
    #[serde(default)]
    data: AlertsData,
}

#[derive(Debug, Default, Deserialize)]
struct AlertsData {
    #[serde(default)]
    alerts: Vec<RawAlert>,
}

#[derive(Debug, Deserialize)]
struct RawAlert {
    #[serde(default)]
    state: String,
    #[serde(default)]
    labels: BTreeMap<String, String>,
    #[serde(default)]
    annotations: BTreeMap<String, String>,
}

#[derive(Debug, thiserror::Error)]
#[error("Prometheus answered status {0:?}")]
struct NotSuccess(String);

#[async_trait]
impl AlertsSource for PrometheusAlerts {
    async fn alerts(&self) -> Result<Vec<Alert>, SourceError> {
        let response = self
            .client
            .get(self.alerts_url.clone())
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|err| SourceError::Request(Box::new(err)))?;
        let status = response.status();
        if !status.is_success() {
            return Err(SourceError::Status(status.as_u16()));
        }
        let body = response
            .bytes()
            .await
            .map_err(|err| SourceError::Request(Box::new(err)))?;
        let parsed: AlertsResponse =
            serde_json::from_slice(&body).map_err(|err| SourceError::Decode(Box::new(err)))?;
        if parsed.status != "success" {
            return Err(SourceError::Decode(Box::new(NotSuccess(parsed.status))));
        }
        Ok(parsed
            .data
            .alerts
            .into_iter()
            .map(|raw| Alert {
                state: raw.state,
                labels: raw.labels,
                annotations: raw.annotations,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::adapters::http::client;

    fn source(server: &MockServer, base_path: &str) -> PrometheusAlerts {
        let base = Url::parse(&format!("{}{base_path}", server.uri())).expect("url");
        PrometheusAlerts::new(client().expect("client"), &base, Duration::from_secs(2))
            .expect("source")
    }

    #[tokio::test]
    async fn parses_alerts() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/api/v1/alerts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "status": "success",
                "data": { "alerts": [
                    { "labels": { "alertname": "HighLatency", "severity": "critical" },
                      "annotations": { "summary": "p99 is high" },
                      "state": "firing", "activeAt": "2026-10-10T07:00:00Z", "value": "1e+00" }
                ]}
            })))
            .mount(&server)
            .await;

        let alerts = source(&server, "/").alerts().await.expect("alerts");
        assert_eq!(alerts.len(), 1);
        assert_eq!(alerts[0].state, "firing");
        assert_eq!(alerts[0].labels["alertname"], "HighLatency");
        assert_eq!(alerts[0].annotations["summary"], "p99 is high");
    }

    #[tokio::test]
    async fn keeps_base_path_prefix() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/prometheus/api/v1/alerts"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "status": "success", "data": { "alerts": [] } })),
            )
            .expect(1)
            .mount(&server)
            .await;
        let alerts = source(&server, "/prometheus")
            .alerts()
            .await
            .expect("alerts");
        assert_eq!(alerts, []);
    }

    #[tokio::test]
    async fn http_errors_and_garbage_are_errors() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(503))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_body_string("<html>"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!({ "status": "error", "error": "boom" })),
            )
            .mount(&server)
            .await;

        let source = source(&server, "");
        assert!(matches!(
            source.alerts().await,
            Err(SourceError::Status(503))
        ));
        assert!(matches!(source.alerts().await, Err(SourceError::Decode(_))));
        assert!(matches!(source.alerts().await, Err(SourceError::Decode(_))));
    }

    #[tokio::test]
    async fn timeout_is_an_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(5)))
            .mount(&server)
            .await;
        let base = Url::parse(&server.uri()).expect("url");
        let source =
            PrometheusAlerts::new(client().expect("client"), &base, Duration::from_millis(100))
                .expect("source");
        assert!(matches!(
            source.alerts().await,
            Err(SourceError::Request(_))
        ));
    }
}
