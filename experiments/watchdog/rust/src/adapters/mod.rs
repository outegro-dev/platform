//! Adapters: implementations of [`crate::ports`] for the real world.

pub mod clock;
pub mod cluster;
pub mod configmap;
pub mod disk;
pub mod http;
pub mod prometheus;
pub mod stdout;
pub mod telegram;

use std::sync::Arc;

use crate::config::Delivery;
use crate::ports::Notifier;

/// Telegram, or stdout for `DRY_RUN`. A runtime choice, which is why the
/// ports are used as `Arc<dyn Trait>` rather than generic parameters.
pub fn notifier_for(delivery: &Delivery, client: reqwest::Client) -> Arc<dyn Notifier> {
    match delivery {
        Delivery::DryRun => Arc::new(stdout::StdoutNotifier::stdout()),
        Delivery::Telegram(config) => {
            Arc::new(telegram::TelegramNotifier::new(client, config.clone()))
        }
    }
}

#[cfg(test)]
mod tests {
    use url::Url;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;
    use crate::config::{Secret, TelegramConfig};

    #[tokio::test]
    async fn telegram_delivery_goes_to_the_bot_api() {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/bot1:x/sendMessage"))
            .respond_with(ResponseTemplate::new(200))
            .expect(1)
            .mount(&server)
            .await;
        let delivery = Delivery::Telegram(TelegramConfig {
            api_url: Url::parse(&server.uri()).expect("url"),
            token: Secret::new("1:x"),
            chat_id: "42".into(),
        });
        let notifier = notifier_for(&delivery, http::client().expect("client"));
        notifier.send("hello").await.expect("sent");
    }
}
