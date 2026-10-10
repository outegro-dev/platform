//! [`Notifier`] for the Telegram Bot API (`sendMessage`).
//!
//! The bot token is part of the URL path (`/bot<token>/sendMessage`), so any
//! `reqwest::Error` would print it. Errors are stripped of their URL
//! (`Error::without_url`) and carry a masked URL instead.

use std::time::Duration;

use async_trait::async_trait;
use serde::Deserialize;
use url::Url;

use crate::config::{Secret, TelegramConfig};
use crate::ports::{Notifier, NotifyError};

/// Same as the script's `curl -m 15`.
pub const SEND_TIMEOUT: Duration = Duration::from_secs(15);

pub struct TelegramNotifier {
    client: reqwest::Client,
    api_url: Url,
    token: Secret,
    chat_id: String,
}

impl std::fmt::Debug for TelegramNotifier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TelegramNotifier")
            .field("url", &self.masked_url())
            .finish_non_exhaustive()
    }
}

impl TelegramNotifier {
    pub fn new(client: reqwest::Client, config: TelegramConfig) -> Self {
        Self {
            client,
            api_url: config.api_url,
            token: config.token,
            chat_id: config.chat_id,
        }
    }

    fn base(&self) -> &str {
        self.api_url.as_str().trim_end_matches('/')
    }

    fn url(&self) -> String {
        format!("{}/bot{}/sendMessage", self.base(), self.token.expose())
    }

    /// The request URL as it may appear in logs.
    pub fn masked_url(&self) -> String {
        format!("{}/bot***/sendMessage", self.base())
    }

    fn transport(&self, err: reqwest::Error) -> NotifyError {
        NotifyError::Transport {
            url: self.masked_url(),
            source: Box::new(err.without_url()),
        }
    }
}

#[derive(Debug, Deserialize)]
struct ApiError {
    description: Option<String>,
}

#[async_trait]
impl Notifier for TelegramNotifier {
    async fn send(&self, text: &str) -> Result<(), NotifyError> {
        let response = self
            .client
            .post(self.url())
            .timeout(SEND_TIMEOUT)
            .form(&[
                ("chat_id", self.chat_id.as_str()),
                ("text", text),
                ("disable_web_page_preview", "true"),
            ])
            .send()
            .await
            .map_err(|err| self.transport(err))?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let description = response
            .json::<ApiError>()
            .await
            .ok()
            .and_then(|body| body.description)
            .unwrap_or_default();
        Err(NotifyError::Rejected {
            status: status.as_u16(),
            description,
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use wiremock::matchers::{body_string_contains, method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::adapters::http::client;
    use crate::telemetry::Chain;

    const TOKEN: &str = "123456:SECRET-token";

    fn notifier(api_url: &str) -> TelegramNotifier {
        TelegramNotifier::new(
            client().expect("client"),
            TelegramConfig {
                api_url: Url::parse(api_url).expect("url"),
                token: Secret::new(TOKEN),
                chat_id: "42".into(),
            },
        )
    }

    #[tokio::test]
    async fn posts_the_message_as_a_form() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path(format!("/bot{TOKEN}/sendMessage")))
            .and(body_string_contains("chat_id=42"))
            .and(body_string_contains("disable_web_page_preview=true"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ok": true })))
            .expect(1)
            .mount(&server)
            .await;

        notifier(&server.uri())
            .send("🔴 outegro.dev: problem\n• disk")
            .await
            .expect("sent");

        let requests = server.received_requests().await.expect("recording");
        let form: Vec<(String, String)> = url::form_urlencoded::parse(&requests[0].body)
            .into_owned()
            .collect();
        assert!(form.contains(&(
            "text".to_owned(),
            "🔴 outegro.dev: problem\n• disk".to_owned()
        )));
    }

    #[tokio::test]
    async fn rejection_carries_the_description_but_not_the_token() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({
                "ok": false, "error_code": 400, "description": "Bad Request: chat not found"
            })))
            .mount(&server)
            .await;
        let err = notifier(&server.uri())
            .send("x")
            .await
            .expect_err("rejected");
        assert!(matches!(err, NotifyError::Rejected { status: 400, .. }));
        let text = format!("{} | {err:?}", Chain(&err));
        assert!(text.contains("chat not found"), "{text}");
        assert!(!text.contains("SECRET"), "{text}");
    }

    #[tokio::test]
    async fn transport_errors_mask_the_token() {
        let uri = crate::test_support::closed_port_url();
        let err = notifier(&uri).send("x").await.expect_err("unreachable");
        let text = format!("{} | {err:?}", Chain(&err));
        assert!(matches!(err, NotifyError::Transport { .. }));
        assert!(text.contains("/bot***/sendMessage"), "{text}");
        assert!(!text.contains("SECRET"), "{text}");
    }

    #[test]
    fn debug_output_is_masked() {
        let debug = format!("{:?}", notifier("https://api.telegram.org"));
        assert!(!debug.contains("SECRET"), "{debug}");
        assert!(debug.contains("https://api.telegram.org/bot***/sendMessage"));
    }
}
