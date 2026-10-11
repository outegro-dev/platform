//! Kubernetes adapter: [`ClusterSource`] on top of the `kube` crate.
//!
//! Core resources (pods, nodes) use the typed API from `k8s-openapi`. CRDs
//! (cert-manager, CNPG, Argo CD) use `DynamicObject` + `ApiResource`, and only
//! their `status` is decoded into small serde structs: no generated CRD types,
//! no dependency on the operators' crates.

use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use k8s_openapi::api::core::v1 as core;
use k8s_openapi::apimachinery::pkg::apis::meta::v1::Time;
use kube::api::{Api, ApiResource, DynamicObject, ListParams};
use kube::config::{InClusterError, KubeConfigOptions, KubeconfigError};
use kube::core::GroupVersionKind;
use kube::{Client, Config};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use thiserror::Error;
use tracing::warn;

use crate::domain::{
    ArgoApp, Backup, Certificate, Condition, ContainerStatus, Node, PgCluster, Pod, Terminated,
};
use crate::ports::{ClusterSource, SourceError};
use crate::telemetry::Chain;

/// Upper bound for one API response; the pass deadline is usually shorter.
pub const READ_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Error)]
pub enum KubeSetupError {
    #[error("no in-cluster service account ({in_cluster}) and no usable kubeconfig")]
    Config {
        in_cluster: InClusterError,
        #[source]
        kubeconfig: KubeconfigError,
    },
    #[error("cannot build the Kubernetes client")]
    Client(#[from] kube::Error),
}

/// In-cluster configuration first (the CronJob), then `KUBECONFIG` /
/// `~/.kube/config` (a laptop). `kube::Config::infer` tries them the other
/// way round, hence the explicit order.
pub async fn client() -> Result<Client, KubeSetupError> {
    let mut config = match Config::incluster() {
        Ok(config) => config,
        Err(in_cluster) => Config::from_kubeconfig(&KubeConfigOptions::default())
            .await
            .map_err(|kubeconfig| KubeSetupError::Config {
                in_cluster,
                kubeconfig,
            })?,
    };
    config.read_timeout = Some(READ_TIMEOUT);
    Ok(Client::try_from(config)?)
}

/// The cluster as seen through the Kubernetes API.
#[derive(Clone)]
pub struct KubeCluster {
    client: Client,
}

impl std::fmt::Debug for KubeCluster {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("KubeCluster").finish_non_exhaustive()
    }
}

impl KubeCluster {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    async fn list_dynamic(
        &self,
        resource: &ApiResource,
        namespace: Option<&str>,
    ) -> Result<Vec<DynamicObject>, SourceError> {
        let api: Api<DynamicObject> = match namespace {
            Some(ns) => Api::namespaced_with(self.client.clone(), ns, resource),
            None => Api::all_with(self.client.clone(), resource),
        };
        Ok(api
            .list(&ListParams::default())
            .await
            .map_err(request)?
            .items)
    }
}

fn request(err: kube::Error) -> SourceError {
    SourceError::Request(Box::new(err))
}

fn resource(group: &str, version: &str, kind: &str, plural: &str) -> ApiResource {
    ApiResource::from_gvk_with_plural(&GroupVersionKind::gvk(group, version, kind), plural)
}

fn certificate_resource() -> ApiResource {
    resource("cert-manager.io", "v1", "Certificate", "certificates")
}

fn cluster_resource() -> ApiResource {
    resource("postgresql.cnpg.io", "v1", "Cluster", "clusters")
}

fn backup_resource() -> ApiResource {
    resource("postgresql.cnpg.io", "v1", "Backup", "backups")
}

fn application_resource() -> ApiResource {
    resource("argoproj.io", "v1alpha1", "Application", "applications")
}

#[async_trait]
impl ClusterSource for KubeCluster {
    async fn pods(&self) -> Result<Vec<Pod>, SourceError> {
        let list = Api::<core::Pod>::all(self.client.clone())
            .list(&ListParams::default())
            .await
            .map_err(request)?;
        Ok(list.items.into_iter().map(pod_from).collect())
    }

    async fn nodes(&self) -> Result<Vec<Node>, SourceError> {
        let list = Api::<core::Node>::all(self.client.clone())
            .list(&ListParams::default())
            .await
            .map_err(request)?;
        Ok(list.items.into_iter().map(node_from).collect())
    }

    async fn certificates(&self) -> Result<Vec<Certificate>, SourceError> {
        let objects = self.list_dynamic(&certificate_resource(), None).await?;
        Ok(decode_all(objects, |meta, status: CertificateStatus| {
            Certificate {
                namespace: meta.namespace,
                name: meta.name,
                conditions: conditions_from(status.conditions),
                not_after: status.not_after,
            }
        }))
    }

    async fn pg_cluster(
        &self,
        namespace: &str,
        name: &str,
    ) -> Result<Option<PgCluster>, SourceError> {
        let api: Api<DynamicObject> =
            Api::namespaced_with(self.client.clone(), namespace, &cluster_resource());
        let Some(object) = api.get_opt(name).await.map_err(request)? else {
            return Ok(None);
        };
        let (meta, status) =
            decode::<ClusterStatus>(object).map_err(|err| SourceError::Decode(Box::new(err)))?;
        Ok(Some(PgCluster {
            name: meta.name,
            conditions: conditions_from(status.conditions),
        }))
    }

    async fn backups(&self, namespace: &str) -> Result<Vec<Backup>, SourceError> {
        let objects = self
            .list_dynamic(&backup_resource(), Some(namespace))
            .await?;
        Ok(decode_all(objects, |meta, status: BackupStatus| Backup {
            name: meta.name,
            phase: status.phase,
            stopped_at: status.stopped_at,
        }))
    }

    async fn argo_applications(&self, namespace: &str) -> Result<Vec<ArgoApp>, SourceError> {
        let objects = self
            .list_dynamic(&application_resource(), Some(namespace))
            .await?;
        Ok(decode_all(objects, |meta, status: ApplicationStatus| {
            ArgoApp {
                name: meta.name,
                sync_status: status.sync.and_then(|s| s.status),
                health_status: status.health.and_then(|h| h.status),
            }
        }))
    }
}

/// `k8s-openapi` uses `jiff` timestamps; the domain uses `chrono`.
fn to_chrono(time: &Time) -> Option<DateTime<Utc>> {
    let nanos = u32::try_from(time.0.subsec_nanosecond()).unwrap_or(0);
    DateTime::from_timestamp(time.0.as_second(), nanos)
}

/// Moves fields out of the API object instead of cloning them: the object is
/// consumed, so `unwrap_or_default()` on each `Option` costs nothing.
fn pod_from(pod: core::Pod) -> Pod {
    let meta = pod.metadata;
    let status = pod.status.unwrap_or_default();
    Pod {
        namespace: meta.namespace.unwrap_or_default(),
        name: meta.name.unwrap_or_default(),
        labels: meta.labels.unwrap_or_default(),
        phase: status.phase,
        owner_kinds: meta
            .owner_references
            .unwrap_or_default()
            .into_iter()
            .map(|owner| owner.kind)
            .collect(),
        created: meta.creation_timestamp.as_ref().and_then(to_chrono),
        conditions: status
            .conditions
            .unwrap_or_default()
            .into_iter()
            .map(|c| Condition {
                kind: c.type_,
                status: c.status,
                reason: c.reason,
                message: c.message,
                last_transition: c.last_transition_time.as_ref().and_then(to_chrono),
            })
            .collect(),
        containers: status
            .container_statuses
            .unwrap_or_default()
            .into_iter()
            .map(container_from)
            .collect(),
    }
}

fn container_from(status: core::ContainerStatus) -> ContainerStatus {
    ContainerStatus {
        name: status.name,
        waiting_reason: status
            .state
            .and_then(|state| state.waiting)
            .and_then(|waiting| waiting.reason),
        last_terminated: status
            .last_state
            .and_then(|state| state.terminated)
            .map(|terminated| Terminated {
                reason: terminated.reason,
                finished_at: terminated.finished_at.as_ref().and_then(to_chrono),
            }),
    }
}

fn node_from(node: core::Node) -> Node {
    Node {
        name: node.metadata.name.unwrap_or_default(),
        conditions: node
            .status
            .and_then(|status| status.conditions)
            .unwrap_or_default()
            .into_iter()
            .map(|c| Condition {
                kind: c.type_,
                status: c.status,
                reason: c.reason,
                message: c.message,
                last_transition: c.last_transition_time.as_ref().and_then(to_chrono),
            })
            .collect(),
    }
}

/// The metadata the CRD mappings need.
struct Meta {
    namespace: String,
    name: String,
}

/// Splits a `DynamicObject` into metadata and its decoded `status`.
fn decode<S: DeserializeOwned + Default>(
    mut object: DynamicObject,
) -> Result<(Meta, S), serde_json::Error> {
    let status = match object.data.get_mut("status").map(serde_json::Value::take) {
        None | Some(serde_json::Value::Null) => S::default(),
        Some(value) => serde_json::from_value(value)?,
    };
    let meta = Meta {
        namespace: object.metadata.namespace.unwrap_or_default(),
        name: object.metadata.name.unwrap_or_default(),
    };
    Ok((meta, status))
}

/// Decodes every object; one malformed object is skipped with a warning
/// instead of hiding the whole list.
fn decode_all<S, T>(objects: Vec<DynamicObject>, map: impl Fn(Meta, S) -> T) -> Vec<T>
where
    S: DeserializeOwned + Default,
{
    objects
        .into_iter()
        .filter_map(|object| {
            let name = object.metadata.name.clone().unwrap_or_default();
            match decode::<S>(object) {
                Ok((meta, status)) => Some(map(meta, status)),
                Err(err) => {
                    warn!(object = %name, error = %Chain(&err), "cannot decode status; object skipped");
                    None
                }
            }
        })
        .collect()
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawCondition {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    status: String,
    reason: Option<String>,
    message: Option<String>,
    last_transition_time: Option<DateTime<Utc>>,
}

fn conditions_from(raw: Vec<RawCondition>) -> Vec<Condition> {
    raw.into_iter()
        .map(|c| Condition {
            kind: c.kind,
            status: c.status,
            reason: c.reason,
            message: c.message,
            last_transition: c.last_transition_time,
        })
        .collect()
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CertificateStatus {
    #[serde(default)]
    conditions: Vec<RawCondition>,
    not_after: Option<DateTime<Utc>>,
}

#[derive(Debug, Default, Deserialize)]
struct ClusterStatus {
    #[serde(default)]
    conditions: Vec<RawCondition>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BackupStatus {
    phase: Option<String>,
    stopped_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Default, Deserialize)]
struct ApplicationStatus {
    sync: Option<StatusField>,
    health: Option<StatusField>,
}

#[derive(Debug, Default, Deserialize)]
struct StatusField {
    status: Option<String>,
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    use super::*;

    fn cluster(server: &MockServer) -> KubeCluster {
        let config = Config::new(server.uri().parse().expect("uri"));
        KubeCluster::new(Client::try_from(config).expect("client"))
    }

    fn list(kind: &str, api_version: &str, items: &serde_json::Value) -> serde_json::Value {
        json!({ "kind": kind, "apiVersion": api_version, "metadata": {}, "items": items })
    }

    async fn serve(server: &MockServer, url: &str, body: serde_json::Value) {
        Mock::given(method("GET"))
            .and(path(url))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .mount(server)
            .await;
    }

    #[tokio::test]
    async fn maps_pods() {
        let server = MockServer::start().await;
        serve(
            &server,
            "/api/v1/pods",
            list(
                "PodList",
                "v1",
                &json!([{
                    "metadata": {
                        "name": "api-1", "namespace": "outegro",
                        "labels": { "app": "api" },
                        "creationTimestamp": "2026-10-10T07:00:00Z",
                        "ownerReferences": [{ "apiVersion": "apps/v1", "kind": "ReplicaSet", "name": "api-x", "uid": "1" }]
                    },
                    "status": {
                        "phase": "Running",
                        "conditions": [{ "type": "Ready", "status": "False", "lastTransitionTime": "2026-10-10T07:30:00Z" }],
                        "containerStatuses": [{
                            "name": "main", "image": "api", "imageID": "", "ready": false, "restartCount": 3,
                            "state": { "waiting": { "reason": "CrashLoopBackOff" } },
                            "lastState": { "terminated": { "exitCode": 137, "reason": "OOMKilled", "finishedAt": "2026-10-10T07:55:00Z" } }
                        }]
                    }
                }]),
            ),
        )
        .await;

        let pods = cluster(&server).pods().await.expect("pods");
        let at = |h, m| Utc.with_ymd_and_hms(2026, 10, 10, h, m, 0).unwrap();
        assert_eq!(
            pods,
            [Pod {
                namespace: "outegro".into(),
                name: "api-1".into(),
                labels: [("app".to_owned(), "api".to_owned())].into(),
                phase: Some("Running".into()),
                owner_kinds: vec!["ReplicaSet".into()],
                created: Some(at(7, 0)),
                conditions: vec![Condition {
                    kind: "Ready".into(),
                    status: "False".into(),
                    reason: None,
                    message: None,
                    last_transition: Some(at(7, 30)),
                }],
                containers: vec![ContainerStatus {
                    name: "main".into(),
                    waiting_reason: Some("CrashLoopBackOff".into()),
                    last_terminated: Some(Terminated {
                        reason: Some("OOMKilled".into()),
                        finished_at: Some(at(7, 55)),
                    }),
                }],
            }]
        );
    }

    #[tokio::test]
    async fn maps_nodes() {
        let server = MockServer::start().await;
        serve(
            &server,
            "/api/v1/nodes",
            list(
                "NodeList",
                "v1",
                &json!([{ "metadata": { "name": "srv1" }, "status": { "conditions": [
                    { "type": "Ready", "status": "True", "reason": "KubeletReady" },
                    { "type": "DiskPressure", "status": "True" }
                ]}}]),
            ),
        )
        .await;
        let nodes = cluster(&server).nodes().await.expect("nodes");
        assert_eq!(nodes.len(), 1);
        assert_eq!(nodes[0].name, "srv1");
        assert_eq!(
            nodes[0].conditions[0].reason.as_deref(),
            Some("KubeletReady")
        );
        assert_eq!(nodes[0].conditions[1].kind, "DiskPressure");
    }

    #[tokio::test]
    async fn maps_certificates_and_skips_malformed_ones() {
        let server = MockServer::start().await;
        serve(
            &server,
            "/apis/cert-manager.io/v1/certificates",
            list(
                "CertificateList",
                "cert-manager.io/v1",
                &json!([
                    { "apiVersion": "cert-manager.io/v1", "kind": "Certificate",
                      "metadata": { "name": "tls", "namespace": "outegro" },
                      "status": { "notAfter": "2026-12-01T00:00:00Z",
                                  "conditions": [{ "type": "Ready", "status": "True", "message": "ok" }] } },
                    { "apiVersion": "cert-manager.io/v1", "kind": "Certificate",
                      "metadata": { "name": "new", "namespace": "outegro" } },
                    { "apiVersion": "cert-manager.io/v1", "kind": "Certificate",
                      "metadata": { "name": "broken", "namespace": "outegro" },
                      "status": { "notAfter": "not a date" } }
                ]),
            ),
        )
        .await;
        let certs = cluster(&server).certificates().await.expect("certs");
        assert_eq!(certs.len(), 2);
        assert_eq!(certs[0].name, "tls");
        assert_eq!(
            certs[0].not_after,
            Some(Utc.with_ymd_and_hms(2026, 12, 1, 0, 0, 0).unwrap())
        );
        assert_eq!(certs[0].conditions[0].message.as_deref(), Some("ok"));
        assert_eq!(certs[1].name, "new");
        assert_eq!(certs[1].conditions, []);
    }

    #[tokio::test]
    async fn reads_pg_cluster_and_backups() {
        let server = MockServer::start().await;
        serve(
            &server,
            "/apis/postgresql.cnpg.io/v1/namespaces/outegro/clusters/pg",
            json!({ "apiVersion": "postgresql.cnpg.io/v1", "kind": "Cluster",
                    "metadata": { "name": "pg", "namespace": "outegro" },
                    "status": { "conditions": [{ "type": "ContinuousArchiving", "status": "False", "reason": "Failing" }] } }),
        )
        .await;
        serve(
            &server,
            "/apis/postgresql.cnpg.io/v1/namespaces/outegro/backups",
            list(
                "BackupList",
                "postgresql.cnpg.io/v1",
                &json!([{ "apiVersion": "postgresql.cnpg.io/v1", "kind": "Backup",
                         "metadata": { "name": "daily", "namespace": "outegro" },
                         "status": { "phase": "completed", "stoppedAt": "2026-10-10T03:00:00Z" } }]),
            ),
        )
        .await;
        let source = cluster(&server);

        let pg = source
            .pg_cluster("outegro", "pg")
            .await
            .expect("cluster")
            .expect("present");
        assert_eq!(pg.conditions[0].kind, "ContinuousArchiving");
        assert_eq!(pg.conditions[0].reason.as_deref(), Some("Failing"));

        let backups = source.backups("outegro").await.expect("backups");
        assert_eq!(
            backups,
            [Backup {
                name: "daily".into(),
                phase: Some("completed".into()),
                stopped_at: Some(Utc.with_ymd_and_hms(2026, 10, 10, 3, 0, 0).unwrap()),
            }]
        );
    }

    #[tokio::test]
    async fn missing_pg_cluster_is_none() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path(
                "/apis/postgresql.cnpg.io/v1/namespaces/outegro/clusters/pg",
            ))
            .respond_with(ResponseTemplate::new(404).set_body_json(json!({
                "kind": "Status", "apiVersion": "v1", "status": "Failure",
                "reason": "NotFound", "code": 404, "message": "not found"
            })))
            .mount(&server)
            .await;
        let pg = cluster(&server)
            .pg_cluster("outegro", "pg")
            .await
            .expect("ok");
        assert_eq!(pg, None);
    }

    #[tokio::test]
    async fn maps_argo_applications() {
        let server = MockServer::start().await;
        serve(
            &server,
            "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications",
            list(
                "ApplicationList",
                "argoproj.io/v1alpha1",
                &json!([
                    { "apiVersion": "argoproj.io/v1alpha1", "kind": "Application",
                      "metadata": { "name": "landing", "namespace": "argocd" },
                      "status": { "sync": { "status": "OutOfSync" }, "health": { "status": "Healthy" } } },
                    { "apiVersion": "argoproj.io/v1alpha1", "kind": "Application",
                      "metadata": { "name": "fresh", "namespace": "argocd" } }
                ]),
            ),
        )
        .await;
        let apps = cluster(&server)
            .argo_applications("argocd")
            .await
            .expect("apps");
        assert_eq!(
            apps,
            [
                ArgoApp {
                    name: "landing".into(),
                    sync_status: Some("OutOfSync".into()),
                    health_status: Some("Healthy".into()),
                },
                ArgoApp {
                    name: "fresh".into(),
                    sync_status: None,
                    health_status: None,
                },
            ]
        );
    }

    #[tokio::test]
    async fn api_errors_become_source_errors() {
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .respond_with(ResponseTemplate::new(403).set_body_json(json!({
                "kind": "Status", "apiVersion": "v1", "status": "Failure",
                "reason": "Forbidden", "code": 403, "message": "forbidden"
            })))
            .mount(&server)
            .await;
        let source = cluster(&server);
        assert!(matches!(source.pods().await, Err(SourceError::Request(_))));
        assert!(matches!(
            source.certificates().await,
            Err(SourceError::Request(_))
        ));
        assert!(matches!(
            source.pg_cluster("outegro", "pg").await,
            Err(SourceError::Request(_))
        ));
    }

    #[test]
    fn converts_jiff_to_chrono() {
        let time = Time("2026-10-10T08:00:00.5Z".parse().expect("timestamp"));
        let expected = Utc.with_ymd_and_hms(2026, 10, 10, 8, 0, 0).unwrap()
            + chrono::Duration::milliseconds(500);
        assert_eq!(to_chrono(&time), Some(expected));
    }
}
