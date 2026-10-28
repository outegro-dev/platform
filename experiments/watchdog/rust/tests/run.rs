//! A whole pass on fakes: in-memory cluster, state store and clock; real
//! HTTP adapters against wiremock servers standing in for the probed
//! services, Prometheus and the Telegram Bot API.

// Test code: a panic with a clear message is the desired failure mode.
#![allow(clippy::unwrap_used)]

mod common;

use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Duration as Span;
use clap::Parser as _;
use common::{ClusterData, FakeClock, FakeCluster, FakeDisk, FakeStore, utc};
use serde_json::json;
use url::Url;
use watchdog::adapters::http::{HttpProber, client};
use watchdog::adapters::notifier_for;
use watchdog::adapters::prometheus::PrometheusAlerts;
use watchdog::adapters::telegram::TelegramNotifier;
use watchdog::alerting::MessageKind;
use watchdog::config::{Cli, Config, Secret, TelegramConfig};
use watchdog::domain::{
    ArgoApp, Backup, Certificate, Condition, ContainerStatus, Node, PgCluster, Pod, Probe,
};
use watchdog::ports::Notifier;
use watchdog::run::{Deps, RunError, Settings, StateWrite, run_once};
use watchdog::state::State;
use wiremock::matchers::{method, path, path_regex};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "123456:SECRET-token";

fn condition(kind: &str, status: &str) -> Condition {
    Condition {
        kind: kind.into(),
        status: status.into(),
        ..Condition::default()
    }
}

fn pod(namespace: &str, name: &str, app: &str) -> Pod {
    Pod {
        namespace: namespace.into(),
        name: name.into(),
        labels: [("app".to_owned(), app.to_owned())].into(),
        phase: Some("Running".into()),
        owner_kinds: vec!["ReplicaSet".into()],
        created: Some(utc(0, 0) - Span::days(3)),
        conditions: vec![condition("Ready", "True")],
        containers: vec![ContainerStatus {
            name: "main".into(),
            ..ContainerStatus::default()
        }],
    }
}

fn crashing_pod() -> Pod {
    let mut p = pod("outegro", "auth-backend-7d9f-x2", "auth-backend");
    p.conditions = vec![condition("Ready", "False")];
    p.containers[0].waiting_reason = Some("CrashLoopBackOff".into());
    p
}

fn healthy_cluster() -> ClusterData {
    let now = utc(8, 0);
    ClusterData {
        pods: Some(vec![
            pod("outegro", "landing-1", "landing"),
            pod("kube-system", "coredns-1", "coredns"),
            pod("monitoring", "prometheus-0", "prometheus"),
        ]),
        nodes: Some(vec![Node {
            name: "srv1".into(),
            conditions: vec![
                condition("Ready", "True"),
                condition("MemoryPressure", "False"),
            ],
        }]),
        certificates: Some(vec![Certificate {
            namespace: "outegro".into(),
            name: "outegro-dev-tls".into(),
            conditions: vec![condition("Ready", "True")],
            not_after: Some(now + Span::days(60)),
        }]),
        pg_cluster: Some(Some(PgCluster {
            name: "pg".into(),
            conditions: vec![
                condition("Ready", "True"),
                condition("ContinuousArchiving", "True"),
                condition("LastBackupSucceeded", "True"),
            ],
        })),
        backups: Some(vec![Backup {
            name: "pg-daily".into(),
            phase: Some("completed".into()),
            stopped_at: Some(now - Span::hours(3)),
        }]),
        argo_apps: Some(vec![ArgoApp {
            name: "landing".into(),
            sync_status: Some("Synced".into()),
            health_status: Some("Healthy".into()),
        }]),
        delay: Duration::ZERO,
    }
}

/// One wiremock server plays the probed services, Prometheus and Telegram.
struct World {
    web: MockServer,
    cluster: Arc<FakeCluster>,
    store: Arc<FakeStore>,
    clock: Arc<FakeClock>,
    disk: Option<u8>,
    settings: Settings,
}

impl World {
    async fn new(
        cluster: ClusterData,
        store: Arc<FakeStore>,
        now: chrono::DateTime<chrono::Utc>,
    ) -> Self {
        let web = MockServer::start().await;
        let probes = ["landing", "id"]
            .iter()
            .map(|name| Probe {
                name: (*name).to_owned(),
                url: Url::parse(&format!("{}/health/{name}", web.uri())).unwrap(),
            })
            .collect();
        Self {
            web,
            cluster: FakeCluster::new(cluster),
            store,
            clock: FakeClock::at(now),
            disk: Some(41),
            settings: Settings {
                namespace: "outegro".into(),
                watched_namespaces: vec!["outegro".into(), "kube-system".into()],
                probes,
                run_timeout: Duration::from_secs(5),
                dry_run: false,
            },
        }
    }

    fn telegram(&self) -> Arc<dyn Notifier> {
        Arc::new(TelegramNotifier::new(
            client().unwrap(),
            TelegramConfig {
                api_url: Url::parse(&self.web.uri()).unwrap(),
                token: Secret::new(TOKEN),
                chat_id: "42".into(),
            },
        ))
    }

    fn deps(&self, notifier: Arc<dyn Notifier>) -> Deps {
        let http = client().unwrap();
        let base = Url::parse(&self.web.uri()).unwrap();
        Deps {
            cluster: self.cluster.clone(),
            prober: Arc::new(HttpProber::new(http.clone(), Duration::from_secs(2))),
            alerts: Arc::new(PrometheusAlerts::new(http, &base, Duration::from_secs(2)).unwrap()),
            disk: Arc::new(FakeDisk(self.disk)),
            store: self.store.clone(),
            notifier,
            clock: self.clock.clone(),
        }
    }

    async fn pass(&self) -> Result<watchdog::run::Summary, RunError> {
        run_once(&self.deps(self.telegram()), &self.settings).await
    }

    /// Mounts healthy probes, Prometheus with `alerts`, and Telegram
    /// answering `telegram_status`.
    async fn serve(&self, alerts: serde_json::Value, telegram_status: u16) {
        self.web.reset().await;
        Mock::given(method("GET"))
            .and(path_regex("^/health/"))
            .respond_with(ResponseTemplate::new(200))
            .mount(&self.web)
            .await;
        Mock::given(method("GET"))
            .and(path("/api/v1/alerts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "status": "success", "data": { "alerts": alerts }
            })))
            .mount(&self.web)
            .await;
        Mock::given(method("POST"))
            .and(path(format!("/bot{TOKEN}/sendMessage")))
            .respond_with(ResponseTemplate::new(telegram_status).set_body_json(json!({
                "ok": telegram_status == 200, "description": "test"
            })))
            .mount(&self.web)
            .await;
    }

    /// Texts of every Telegram `sendMessage` request so far.
    async fn sent(&self) -> Vec<String> {
        self.web
            .received_requests()
            .await
            .unwrap()
            .iter()
            .filter(|r| r.url.path().ends_with("/sendMessage"))
            .filter_map(|r| {
                url::form_urlencoded::parse(&r.body)
                    .find(|(k, _)| k == "text")
                    .map(|(_, v)| v.into_owned())
            })
            .collect()
    }
}

fn queue_alert() -> serde_json::Value {
    json!([
        { "state": "firing", "labels": { "alertname": "Watchdog", "severity": "none" }, "annotations": {} },
        { "state": "firing",
          "labels": { "alertname": "RabbitmqQueueBacklog", "severity": "critical", "namespace": "outegro", "queue": "mail" },
          "annotations": { "summary": "Queue mail has 5000 messages" } },
        { "state": "pending", "labels": { "alertname": "HighLatency" }, "annotations": {} }
    ])
}

#[tokio::test]
async fn findings_become_messages_and_state_then_quiet_then_recovery() {
    let mut cluster = healthy_cluster();
    cluster.pods.as_mut().unwrap().push(crashing_pod());
    let mut world = World::new(cluster, FakeStore::empty(), utc(8, 0)).await;
    world.disk = Some(85);
    world.serve(queue_alert(), 200).await;

    // First pass: greeting, problems, daily digest.
    let summary = world.pass().await.expect("pass");
    assert_eq!(summary.findings, 3);
    assert_eq!(
        summary.delivered,
        [
            MessageKind::Greeting,
            MessageKind::Problem,
            MessageKind::Digest
        ]
    );
    assert_eq!(summary.state, StateWrite::Saved);
    assert_eq!(
        world.sent().await,
        [
            "👋 outegro.dev watchdog is on duty: pods, nodes, disk, certificates, backups, Argo CD and health checks every 5 minutes.",
            "🔴 outegro.dev: problem\n\
             • server disk 85% used\n\
             • outegro/auth-backend-7d9f-x2: CrashLoopBackOff\n\
             • RabbitmqQueueBacklog (critical): Queue mail has 5000 messages",
            "☀️ outegro.dev daily: Failing checks: 3.\n\
             Pods running: 4\n\
             Last backup: 3 h ago\n\
             Certificate: 60 days left\n\
             Disk: 85% used",
        ]
    );
    let state = world.store.current().expect("saved");
    let ts = utc(8, 0).timestamp();
    assert_eq!(
        state.findings.keys().collect::<Vec<_>>(),
        [
            "disk",
            "pod:outegro/auth-backend",
            "prom:RabbitmqQueueBacklog:mail/outegro"
        ]
    );
    assert!(
        state
            .findings
            .values()
            .all(|e| e.since == ts && e.notified == ts)
    );
    assert_eq!(state.digest_day.as_deref(), Some("20261010"));

    // Second pass, nothing changed: no message, no ConfigMap write.
    world.clock.advance(Span::minutes(5));
    let summary = world.pass().await.expect("pass");
    assert_eq!(summary.planned, 0);
    assert_eq!(summary.state, StateWrite::Unchanged);
    assert_eq!(world.sent().await.len(), 3);
    assert_eq!(world.store.save_count(), 1);

    // Third pass: the pod is fixed.
    world.cluster.update(|data| {
        data.pods
            .as_mut()
            .unwrap()
            .retain(|p| !p.name.starts_with("auth-backend"));
    });
    world.clock.advance(Span::minutes(5));
    let summary = world.pass().await.expect("pass");
    assert_eq!(summary.delivered, [MessageKind::Recovered]);
    assert_eq!(
        world.sent().await.last().unwrap(),
        "🟢 outegro.dev: recovered\n• outegro/auth-backend-7d9f-x2: CrashLoopBackOff"
    );
    let state = world.store.current().unwrap();
    assert!(!state.findings.contains_key("pod:outegro/auth-backend"));
    assert_eq!(world.store.save_count(), 2);
}

#[tokio::test]
async fn dry_run_prints_but_neither_sends_nor_saves() {
    let mut cluster = healthy_cluster();
    cluster.pods.as_mut().unwrap().push(crashing_pod());
    let world = World::new(cluster, FakeStore::empty(), utc(9, 0)).await;
    world.serve(json!([]), 200).await;

    // The same wiring as main: configuration decides the notifier.
    let config = Config::try_from(
        Cli::try_parse_from([
            "watchdog",
            "--dry-run",
            "true",
            "--telegram-bot-token",
            TOKEN,
            "--telegram-chat-id",
            "42",
            "--telegram-api-url",
            &world.web.uri(),
        ])
        .unwrap(),
    )
    .unwrap();
    let mut settings = world.settings.clone();
    settings.dry_run = config.dry_run();
    let notifier = notifier_for(&config.delivery, client().unwrap());

    let summary = run_once(&world.deps(notifier), &settings)
        .await
        .expect("pass");

    assert_eq!(
        summary.delivered,
        [
            MessageKind::Greeting,
            MessageKind::Problem,
            MessageKind::Digest
        ],
        "printed to stdout"
    );
    assert_eq!(summary.state, StateWrite::Skipped);
    assert_eq!(
        world.sent().await,
        Vec::<String>::new(),
        "Telegram untouched"
    );
    assert_eq!(world.store.save_count(), 0);
    assert_eq!(world.store.current(), None);
}

#[tokio::test]
async fn failed_telegram_sends_are_retried_next_pass() {
    let mut cluster = healthy_cluster();
    cluster.pods.as_mut().unwrap().push(crashing_pod());
    let world = World::new(cluster, FakeStore::with(State::default()), utc(10, 0)).await;
    world.serve(json!([]), 500).await;

    let summary = world
        .pass()
        .await
        .expect("a failed send does not fail the pass");
    assert_eq!(summary.planned, 2);
    assert_eq!(summary.delivered, []);
    let state = world.store.current().unwrap();
    assert_eq!(state.findings["pod:outegro/auth-backend"].notified, 0);
    assert_eq!(state.digest_day, None);

    world.serve(json!([]), 200).await;
    world.clock.advance(Span::minutes(5));
    let summary = world.pass().await.expect("pass");
    assert_eq!(
        summary.delivered,
        [MessageKind::Problem, MessageKind::Digest]
    );
    assert_eq!(
        world.sent().await[0],
        "🔴 outegro.dev: problem\n• outegro/auth-backend-7d9f-x2: CrashLoopBackOff"
    );
    let state = world.store.current().unwrap();
    assert_eq!(
        state.findings["pod:outegro/auth-backend"].notified,
        utc(10, 5).timestamp()
    );
    assert_eq!(state.digest_day.as_deref(), Some("20261010"));
}

#[tokio::test]
async fn http_checks_run_in_parallel_and_wait_for_grace() {
    let mut world = World::new(
        healthy_cluster(),
        FakeStore::with(State::default()),
        utc(6, 0),
    )
    .await;
    Mock::given(method("GET"))
        .and(path("/health/bad"))
        .respond_with(ResponseTemplate::new(503).set_delay(Duration::from_millis(400)))
        .with_priority(1)
        .mount(&world.web)
        .await;
    Mock::given(method("GET"))
        .and(path_regex("^/health/"))
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_millis(400)))
        .mount(&world.web)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/alerts"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({ "status": "success", "data": { "alerts": [] } })),
        )
        .mount(&world.web)
        .await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ok": true })))
        .mount(&world.web)
        .await;
    let bad = format!("{}/health/bad", world.web.uri());
    world.settings.probes = ["a", "b", "c", "d", "e"]
        .iter()
        .map(|name| Probe {
            name: (*name).to_owned(),
            url: Url::parse(&format!("{}/health/{name}", world.web.uri())).unwrap(),
        })
        .chain([Probe {
            name: "bad".into(),
            url: Url::parse(&bad).unwrap(),
        }])
        .collect();

    let started = Instant::now();
    let summary = world.pass().await.expect("pass");
    assert!(
        started.elapsed() < Duration::from_millis(1500),
        "six 400 ms checks took {:?}",
        started.elapsed()
    );
    assert_eq!(summary.findings, 1);
    assert_eq!(summary.planned, 0, "http: has a 4 minute grace");

    world.clock.advance(Span::minutes(4));
    let summary = world.pass().await.expect("pass");
    assert_eq!(summary.delivered, [MessageKind::Problem]);
    assert_eq!(
        world.sent().await,
        [format!("🔴 outegro.dev: problem\n• {bad} answered 503")]
    );
}

#[tokio::test]
async fn deadline_cancels_slow_sources() {
    let mut cluster = healthy_cluster();
    cluster.delay = Duration::from_secs(30);
    let mut world = World::new(cluster, FakeStore::with(State::default()), utc(6, 0)).await;
    world.settings.run_timeout = Duration::from_millis(300);
    world.serve(json!([]), 200).await;

    let started = Instant::now();
    let summary = world.pass().await.expect("pass");
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    // Pods and the PG cluster turn into findings; the rest is skipped.
    assert_eq!(summary.findings, 2);
    assert_eq!(
        world.sent().await,
        ["🔴 outegro.dev: problem\n• cannot list pods\n• PostgreSQL cluster pg is missing"]
    );
}

#[tokio::test]
async fn prometheus_outage_is_reported_after_its_grace() {
    let world = World::new(
        healthy_cluster(),
        FakeStore::with(State::default()),
        utc(6, 0),
    )
    .await;
    Mock::given(method("GET"))
        .and(path_regex("^/health/"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&world.web)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/v1/alerts"))
        .respond_with(ResponseTemplate::new(502))
        .mount(&world.web)
        .await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "ok": true })))
        .mount(&world.web)
        .await;

    assert_eq!(world.pass().await.unwrap().planned, 0);
    world.clock.advance(Span::minutes(10));
    assert_eq!(world.pass().await.unwrap().planned, 0);
    world.clock.advance(Span::minutes(5));
    let summary = world.pass().await.unwrap();
    assert_eq!(summary.delivered, [MessageKind::Problem]);
    assert_eq!(
        world.sent().await,
        ["🔴 outegro.dev: problem\n• Prometheus alerts API does not answer"]
    );
}

#[tokio::test]
async fn unreadable_state_store_fails_the_pass_before_sending() {
    let store = Arc::new(FakeStore {
        fail_load: true,
        ..FakeStore::default()
    });
    let world = World::new(healthy_cluster(), store, utc(9, 0)).await;
    world.serve(json!([]), 200).await;

    assert!(matches!(world.pass().await, Err(RunError::Load(_))));
    assert_eq!(world.sent().await, Vec::<String>::new());
}

#[tokio::test]
async fn unwritable_state_store_fails_the_pass_after_sending() {
    let store = Arc::new(FakeStore {
        fail_save: true,
        ..FakeStore::default()
    });
    let world = World::new(healthy_cluster(), store, utc(6, 0)).await;
    world.serve(json!([]), 200).await;

    assert!(matches!(world.pass().await, Err(RunError::Save(_))));
    assert_eq!(world.sent().await.len(), 1, "the greeting went out");
}

/// A prober whose task panics, to check that `JoinSet` failures are handled.
struct PanickingProber;

#[async_trait::async_trait]
impl watchdog::ports::Prober for PanickingProber {
    async fn status(&self, _url: &Url) -> Result<u16, watchdog::ports::SourceError> {
        panic!("probe task panicked on purpose");
    }
}

#[tokio::test]
async fn a_panicking_check_counts_as_no_response() {
    let world = World::new(
        healthy_cluster(),
        FakeStore::with(State::default()),
        utc(6, 0),
    )
    .await;
    world.serve(json!([]), 200).await;
    let mut deps = world.deps(world.telegram());
    deps.prober = Arc::new(PanickingProber);

    let summary = run_once(&deps, &world.settings).await.expect("pass");
    assert_eq!(summary.findings, 2);
    let state = world.store.current().unwrap();
    assert_eq!(
        state.findings["http:landing"].message,
        format!("{}/health/landing answered no response", world.web.uri())
    );
}
