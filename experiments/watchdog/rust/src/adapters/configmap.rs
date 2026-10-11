//! [`StateStore`] in a ConfigMap (`state.json` key), with optimistic locking.
//!
//! `load` remembers the `resourceVersion`; `save` replaces the ConfigMap with
//! that version, so a concurrent writer causes `409 Conflict` instead of a
//! silent overwrite. On conflict the version is re-read and the write is
//! retried once. A missing ConfigMap is created.

use std::collections::BTreeMap;
use std::sync::{Mutex, PoisonError};

use async_trait::async_trait;
use k8s_openapi::api::core::v1::ConfigMap;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::ObjectMeta;
use kube::api::{Api, PostParams};
use kube::{Client, Error as KubeError};
use tracing::{info, warn};

use crate::ports::{StateStore, StoreError};
use crate::state::{self, State};
use crate::telemetry::Chain;

/// The data key inside the ConfigMap.
pub const STATE_KEY: &str = "state.json";

pub struct ConfigMapStore {
    api: Api<ConfigMap>,
    name: String,
    /// `resourceVersion` seen by the last read or write; `None` = not there.
    ///
    /// A `std::sync::Mutex` is enough: it is never held across an `.await`.
    /// It makes the store `Sync`, which `Arc<dyn StateStore>` requires.
    resource_version: Mutex<Option<String>>,
}

impl std::fmt::Debug for ConfigMapStore {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConfigMapStore")
            .field("name", &self.name)
            .finish_non_exhaustive()
    }
}

impl ConfigMapStore {
    pub fn new(client: Client, namespace: &str, name: impl Into<String>) -> Self {
        Self {
            api: Api::namespaced(client, namespace),
            name: name.into(),
            resource_version: Mutex::new(None),
        }
    }

    fn remembered_version(&self) -> Option<String> {
        // A poisoned lock only means another thread panicked while holding
        // it; the `Option<String>` inside is still valid.
        self.resource_version
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn remember_version(&self, version: Option<String>) {
        *self
            .resource_version
            .lock()
            .unwrap_or_else(PoisonError::into_inner) = version;
    }

    async fn write(&self, json: &str, version: Option<String>) -> Result<(), KubeError> {
        let config_map = ConfigMap {
            metadata: ObjectMeta {
                name: Some(self.name.clone()),
                resource_version: version.clone(),
                labels: Some(BTreeMap::from([
                    ("app.kubernetes.io/name".to_owned(), "watchdog".to_owned()),
                    ("app.kubernetes.io/component".to_owned(), "state".to_owned()),
                ])),
                ..ObjectMeta::default()
            },
            data: Some(BTreeMap::from([(STATE_KEY.to_owned(), json.to_owned())])),
            ..ConfigMap::default()
        };
        let params = PostParams::default();
        let written = match version {
            Some(_) => self.api.replace(&self.name, &params, &config_map).await?,
            None => self.api.create(&params, &config_map).await?,
        };
        self.remember_version(written.metadata.resource_version);
        Ok(())
    }
}

fn is_conflict(err: &KubeError) -> bool {
    matches!(err, KubeError::Api(status) if status.is_conflict() || status.is_already_exists())
}

#[async_trait]
impl StateStore for ConfigMapStore {
    async fn load(&self) -> Result<Option<State>, StoreError> {
        let found = self
            .api
            .get_opt(&self.name)
            .await
            .map_err(|err| StoreError::Read(Box::new(err)))?;
        let Some(config_map) = found else {
            self.remember_version(None);
            return Ok(None);
        };
        self.remember_version(config_map.metadata.resource_version);

        let raw = config_map
            .data
            .as_ref()
            .and_then(|data| data.get(STATE_KEY));
        match raw.map(|json| state::decode(json)) {
            Some(Ok(state)) => Ok(Some(state)),
            Some(Err(err)) => {
                warn!(configmap = %self.name, error = %Chain(&err), "unreadable state; treating this pass as the first run");
                Ok(None)
            }
            None => {
                warn!(configmap = %self.name, key = STATE_KEY, "state key missing; treating this pass as the first run");
                Ok(None)
            }
        }
    }

    async fn save(&self, state: &State) -> Result<(), StoreError> {
        let json = state::encode(state)?;
        match self.write(&json, self.remembered_version()).await {
            Ok(()) => Ok(()),
            Err(err) if is_conflict(&err) => {
                info!(configmap = %self.name, "state changed concurrently; re-reading and retrying once");
                let latest = self
                    .api
                    .get_opt(&self.name)
                    .await
                    .map_err(|err| StoreError::Read(Box::new(err)))?;
                let version = latest.and_then(|cm| cm.metadata.resource_version);
                self.write(&json, version)
                    .await
                    .map_err(|err| StoreError::Write(Box::new(err)))
            }
            Err(err) => Err(StoreError::Write(Box::new(err))),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};
    use wiremock::matchers::{body_partial_json, method, path};
    use wiremock::{Mock, MockServer, Request, ResponseTemplate};

    use super::*;
    use crate::state::Entry;

    const CM_PATH: &str = "/api/v1/namespaces/outegro/configmaps/watchdog-state-v2";
    const CM_COLLECTION: &str = "/api/v1/namespaces/outegro/configmaps";

    fn store(server: &MockServer) -> ConfigMapStore {
        let config = kube::Config::new(server.uri().parse().expect("uri"));
        let client = Client::try_from(config).expect("client");
        ConfigMapStore::new(client, "outegro", "watchdog-state-v2")
    }

    fn config_map(version: &str, data: Option<Value>) -> Value {
        let mut cm = json!({
            "apiVersion": "v1", "kind": "ConfigMap",
            "metadata": { "name": "watchdog-state-v2", "namespace": "outegro", "resourceVersion": version }
        });
        if let Some(data) = data {
            cm["data"] = data;
        }
        cm
    }

    fn status(code: u16, reason: &str) -> ResponseTemplate {
        ResponseTemplate::new(code).set_body_json(json!({
            "kind": "Status", "apiVersion": "v1", "status": "Failure",
            "reason": reason, "code": code, "message": reason
        }))
    }

    /// Echoes the written ConfigMap back with a new resourceVersion.
    fn echo(
        version: &'static str,
    ) -> impl Fn(&Request) -> ResponseTemplate + Send + Sync + 'static {
        move |request: &Request| {
            let mut body: Value = serde_json::from_slice(&request.body).expect("json body");
            body["metadata"]["resourceVersion"] = json!(version);
            ResponseTemplate::new(200).set_body_json(body)
        }
    }

    fn sample() -> State {
        State {
            findings: BTreeMap::from([(
                "disk".to_owned(),
                Entry {
                    since: 1,
                    notified: 2,
                    message: "server disk 90% used".to_owned(),
                },
            )]),
            digest_day: Some("20261010".to_owned()),
        }
    }

    #[tokio::test]
    async fn missing_config_map_is_first_run_and_is_created() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(CM_PATH))
            .respond_with(status(404, "NotFound"))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(CM_COLLECTION))
            .and(body_partial_json(
                json!({ "metadata": { "name": "watchdog-state-v2" } }),
            ))
            .respond_with(echo("1"))
            .expect(1)
            .mount(&server)
            .await;

        let store = store(&server);
        assert_eq!(store.load().await.expect("load"), None);
        store.save(&sample()).await.expect("save");

        let requests = server.received_requests().await.expect("recording");
        let created: Value = serde_json::from_slice(&requests[1].body).expect("json");
        let saved =
            state::decode(created["data"][STATE_KEY].as_str().expect("state")).expect("decode");
        assert_eq!(saved, sample());
    }

    #[tokio::test]
    async fn existing_state_is_read_and_replaced_with_its_version() {
        let server = MockServer::start().await;
        let json = state::encode(&sample()).expect("encode");
        Mock::given(method("GET"))
            .and(path(CM_PATH))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(config_map("41", Some(json!({ STATE_KEY: json })))),
            )
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path(CM_PATH))
            .and(body_partial_json(
                json!({ "metadata": { "resourceVersion": "41" } }),
            ))
            .respond_with(echo("42"))
            .expect(1)
            .mount(&server)
            .await;

        let store = store(&server);
        assert_eq!(store.load().await.expect("load"), Some(sample()));
        store.save(&State::default()).await.expect("save");
    }

    #[rstest::rstest]
    #[case::garbage(Some(json!({ STATE_KEY: "{not json" })))]
    #[case::other_version(Some(json!({ STATE_KEY: "{\"version\":7}" })))]
    #[case::missing_key(Some(json!({ "other": "x" })))]
    #[case::no_data(None)]
    #[tokio::test]
    async fn unreadable_state_is_first_run_but_updates_in_place(#[case] data: Option<Value>) {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(CM_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(config_map("7", data)))
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path(CM_PATH))
            .and(body_partial_json(
                json!({ "metadata": { "resourceVersion": "7" } }),
            ))
            .respond_with(echo("8"))
            .expect(1)
            .mount(&server)
            .await;

        let store = store(&server);
        assert_eq!(store.load().await.expect("load"), None);
        store.save(&sample()).await.expect("save");
    }

    #[tokio::test]
    async fn conflict_is_retried_once_with_a_fresh_version() {
        let server = MockServer::start().await;
        // First read: version 1. Re-read after the conflict: version 2.
        Mock::given(method("GET"))
            .and(path(CM_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(config_map("1", None)))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(CM_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(config_map("2", None)))
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path(CM_PATH))
            .and(body_partial_json(
                json!({ "metadata": { "resourceVersion": "1" } }),
            ))
            .respond_with(status(409, "Conflict"))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path(CM_PATH))
            .and(body_partial_json(
                json!({ "metadata": { "resourceVersion": "2" } }),
            ))
            .respond_with(echo("3"))
            .expect(1)
            .mount(&server)
            .await;

        let store = store(&server);
        assert_eq!(store.load().await.expect("load"), None);
        store.save(&sample()).await.expect("save after retry");
    }

    #[tokio::test]
    async fn create_race_falls_back_to_replace() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(CM_PATH))
            .respond_with(status(404, "NotFound"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path(CM_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(config_map("5", None)))
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(CM_COLLECTION))
            .respond_with(status(409, "AlreadyExists"))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path(CM_PATH))
            .and(body_partial_json(
                json!({ "metadata": { "resourceVersion": "5" } }),
            ))
            .respond_with(echo("6"))
            .expect(1)
            .mount(&server)
            .await;

        let store = store(&server);
        assert_eq!(store.load().await.expect("load"), None);
        store.save(&sample()).await.expect("save");
    }

    #[tokio::test]
    async fn second_conflict_is_an_error() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(CM_PATH))
            .respond_with(ResponseTemplate::new(200).set_body_json(config_map("1", None)))
            .mount(&server)
            .await;
        Mock::given(method("PUT"))
            .and(path(CM_PATH))
            .respond_with(status(409, "Conflict"))
            .expect(2)
            .mount(&server)
            .await;

        let store = store(&server);
        store.load().await.expect("load");
        assert!(matches!(
            store.save(&sample()).await,
            Err(StoreError::Write(_))
        ));
    }

    #[tokio::test]
    async fn read_errors_are_errors() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(CM_PATH))
            .respond_with(status(403, "Forbidden"))
            .mount(&server)
            .await;
        assert!(matches!(
            store(&server).load().await,
            Err(StoreError::Read(_))
        ));
    }
}
