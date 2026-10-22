//! Shared HTTP client and the [`Prober`] for `PROBES`.

use std::time::Duration;

use async_trait::async_trait;
use reqwest::redirect::Policy;
use url::Url;

use crate::ports::{Prober, SourceError};

/// Installs `ring` as the process-wide rustls crypto provider.
///
/// `kube` and `reqwest` both use rustls; with one explicit provider there is
/// a single crypto backend in the binary (no C toolchain for aws-lc). Calling
/// it again is harmless: the first installation wins.
pub fn install_crypto_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// One connection pool for probes, Prometheus and Telegram. Timeouts are set
/// per request by each adapter. Redirects are not followed, like `curl`
/// without `-L`: a `301` from a health endpoint is reported as such.
pub fn client() -> Result<reqwest::Client, reqwest::Error> {
    install_crypto_provider();
    reqwest::Client::builder()
        .redirect(Policy::none())
        .user_agent(concat!("outegro-watchdog/", env!("CARGO_PKG_VERSION")))
        .build()
}

/// HTTP GET with a timeout; any answer is a status code.
#[derive(Debug, Clone)]
pub struct HttpProber {
    client: reqwest::Client,
    timeout: Duration,
}

impl HttpProber {
    pub fn new(client: reqwest::Client, timeout: Duration) -> Self {
        Self { client, timeout }
    }
}

#[async_trait]
impl Prober for HttpProber {
    async fn status(&self, url: &Url) -> Result<u16, SourceError> {
        let response = self
            .client
            .get(url.clone())
            .timeout(self.timeout)
            .send()
            .await
            .map_err(|err| SourceError::Request(Box::new(err)))?;
        Ok(response.status().as_u16())
    }
}

#[cfg(test)]
mod tests {
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    async fn probe(
        server: &MockServer,
        route: &str,
        timeout: Duration,
    ) -> Result<u16, SourceError> {
        let prober = HttpProber::new(client().expect("client"), timeout);
        let url = Url::parse(&format!("{}{route}", server.uri())).expect("url");
        prober.status(&url).await
    }

    #[tokio::test]
    async fn reports_status_codes_without_following_redirects() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/ok"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/moved"))
            .respond_with(ResponseTemplate::new(301).insert_header("location", "/ok"))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/down"))
            .respond_with(ResponseTemplate::new(503))
            .mount(&server)
            .await;

        let timeout = Duration::from_secs(5);
        assert_eq!(probe(&server, "/ok", timeout).await.expect("ok"), 200);
        assert_eq!(probe(&server, "/moved", timeout).await.expect("moved"), 301);
        assert_eq!(probe(&server, "/down", timeout).await.expect("down"), 503);
    }

    #[tokio::test]
    async fn slow_answer_is_no_response() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(2)))
            .mount(&server)
            .await;
        let result = probe(&server, "/slow", Duration::from_millis(100)).await;
        assert!(matches!(result, Err(SourceError::Request(_))));
    }

    #[tokio::test]
    async fn connection_refused_is_no_response() {
        let uri = crate::test_support::closed_port_url();
        let prober = HttpProber::new(client().expect("client"), Duration::from_secs(1));
        let result = prober.status(&Url::parse(&uri).expect("url")).await;
        assert!(matches!(result, Err(SourceError::Request(_))));
    }
}
