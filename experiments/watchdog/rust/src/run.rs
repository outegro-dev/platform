//! One pass: gather in parallel → evaluate → plan → send → save.
//!
//! This is the only module that sequences I/O. Every source call is bounded
//! by the common deadline (`tokio::time::timeout_at`); the sources run
//! concurrently with `tokio::join!`, the HTTP checks in a `JoinSet`.
//! Dropping the future returned by [`run_once`] (on SIGTERM) cancels all of
//! them, and the state is saved in a single request at the very end, so it is
//! never written halfway.

use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use thiserror::Error;
use tokio::task::JoinSet;
use tokio::time::{Instant, timeout_at};
use tracing::{debug, error, info, warn};

use crate::alerting::{self, MessageKind};
use crate::checks::{self, ARGO_NAMESPACE, Observations, PG_CLUSTER_NAME, ProbeResult};
use crate::config::Config;
use crate::domain::Probe;
use crate::ports::{
    AlertsSource, Clock, ClusterSource, DiskStat, Notifier, Prober, SourceError, StateStore,
    StoreError,
};
use crate::telemetry::Chain;

/// The adapters a pass talks to, injected by the composition root (or tests).
#[derive(Clone)]
pub struct Deps {
    pub cluster: Arc<dyn ClusterSource>,
    pub prober: Arc<dyn Prober>,
    pub alerts: Arc<dyn AlertsSource>,
    pub disk: Arc<dyn DiskStat>,
    pub store: Arc<dyn StateStore>,
    pub notifier: Arc<dyn Notifier>,
    pub clock: Arc<dyn Clock>,
}

impl fmt::Debug for Deps {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        // Trait objects carry no `Debug`; the wiring itself is what matters.
        f.debug_struct("Deps").finish_non_exhaustive()
    }
}

/// The part of the configuration a pass needs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub namespace: String,
    pub watched_namespaces: Vec<String>,
    pub probes: Vec<Probe>,
    pub run_timeout: Duration,
    pub dry_run: bool,
}

impl From<&Config> for Settings {
    fn from(config: &Config) -> Self {
        Self {
            namespace: config.namespace.clone(),
            watched_namespaces: config.watched_namespaces.clone(),
            probes: config.probes.clone(),
            run_timeout: config.run_timeout,
            dry_run: config.dry_run(),
        }
    }
}

/// What happened to the state at the end of the pass.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StateWrite {
    Saved,
    /// Same as before: no write, no needless ConfigMap update.
    Unchanged,
    /// `DRY_RUN`: never written.
    Skipped,
}

/// The outcome of a completed pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Summary {
    pub findings: usize,
    pub planned: usize,
    pub delivered: Vec<MessageKind>,
    pub state: StateWrite,
}

/// Errors that make the pass fail (exit code 1). Failed checks and failed
/// sends are not errors: they become findings or log lines.
#[derive(Debug, Error)]
pub enum RunError {
    #[error("cannot load state")]
    Load(#[source] StoreError),
    #[error("cannot save state")]
    Save(#[source] StoreError),
}

/// Runs one pass.
pub async fn run_once(deps: &Deps, settings: &Settings) -> Result<Summary, RunError> {
    let started = Instant::now();
    let deadline = started + settings.run_timeout;
    let now = deps.clock.now();

    let load_state = async {
        timeout_at(deadline, deps.store.load())
            .await
            .unwrap_or_else(|elapsed| Err(StoreError::Read(Box::new(elapsed))))
    };
    let (previous, observations) = tokio::join!(load_state, gather(deps, settings, deadline));
    let previous = previous.map_err(RunError::Load)?;
    if previous.is_none() {
        info!("no previous state: first run");
    }
    log_unavailable(&observations);

    let evaluation = checks::evaluate(&observations, &settings.watched_namespaces, now);
    for finding in &evaluation.findings {
        debug!(key = %finding.key, message = %finding.message, "finding");
    }

    let plan = alerting::plan(
        previous.as_ref(),
        &evaluation.findings,
        &evaluation.facts,
        now,
    );
    let planned = plan.messages.len();
    let mut delivered = Vec::with_capacity(planned);
    for message in &plan.messages {
        match deps.notifier.send(&message.text).await {
            Ok(()) => delivered.push(message.kind),
            Err(err) => error!(
                kind = ?message.kind,
                error = %Chain(&err),
                "message not delivered; the next pass retries it"
            ),
        }
    }
    let next = plan.apply(&delivered);

    let state = if settings.dry_run {
        StateWrite::Skipped
    } else if previous.as_ref() == Some(&next) {
        StateWrite::Unchanged
    } else {
        deps.store.save(&next).await.map_err(RunError::Save)?;
        StateWrite::Saved
    };

    let elapsed = started.elapsed();
    info!(
        findings = evaluation.findings.len(),
        messages = planned,
        sent = delivered.len(),
        state = ?state,
        dry_run = settings.dry_run,
        duration_ms = u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX),
        "pass complete"
    );
    Ok(Summary {
        findings: evaluation.findings.len(),
        planned,
        delivered,
        state,
    })
}

/// Reads every source concurrently, each bounded by the deadline.
async fn gather(deps: &Deps, settings: &Settings, deadline: Instant) -> Observations {
    let cluster = deps.cluster.as_ref();
    let namespace = settings.namespace.as_str();
    let (pods, nodes, disk_percent, certificates, pg_cluster, backups, argo_apps, probes, alerts) = tokio::join!(
        bounded(deadline, cluster.pods()),
        bounded(deadline, cluster.nodes()),
        bounded(deadline, deps.disk.percent_used()),
        bounded(deadline, cluster.certificates()),
        bounded(deadline, cluster.pg_cluster(namespace, PG_CLUSTER_NAME)),
        bounded(deadline, cluster.backups(namespace)),
        bounded(deadline, cluster.argo_applications(ARGO_NAMESPACE)),
        probe_all(&deps.prober, &settings.probes, deadline),
        bounded(deadline, deps.alerts.alerts()),
    );
    Observations {
        pods,
        nodes,
        disk_percent,
        certificates,
        pg_cluster,
        backups,
        argo_apps,
        probes,
        alerts,
    }
}

/// Cancels `source` at the deadline; a late source counts as unavailable.
async fn bounded<T>(
    deadline: Instant,
    source: impl Future<Output = Result<T, SourceError>>,
) -> Result<T, SourceError> {
    timeout_at(deadline, source)
        .await
        .unwrap_or(Err(SourceError::Deadline))
}

/// Runs the HTTP checks as separate tasks and returns them in config order.
///
/// `JoinSet::spawn` needs `'static + Send` futures, hence the cloned `Arc`
/// and the owned `Probe` in each task. Dropping the set aborts the tasks.
async fn probe_all(
    prober: &Arc<dyn Prober>,
    targets: &[Probe],
    deadline: Instant,
) -> Vec<ProbeResult> {
    let mut tasks = JoinSet::new();
    let mut task_index = HashMap::with_capacity(targets.len());
    for (index, probe) in targets.iter().cloned().enumerate() {
        let prober = Arc::clone(prober);
        let handle = tasks.spawn(async move {
            let status = bounded(deadline, prober.status(&probe.url)).await;
            (index, ProbeResult { probe, status })
        });
        task_index.insert(handle.id(), index);
    }
    let mut results = Vec::with_capacity(targets.len());
    while let Some(joined) = tasks.join_next().await {
        match joined {
            Ok(result) => results.push(result),
            // A panicked check must not vanish: it counts as "no response".
            Err(err) => {
                error!(error = %err, "HTTP check task failed");
                if let Some(&index) = task_index.get(&err.id()) {
                    let status = Err(SourceError::Request(Box::new(err)));
                    let probe = targets[index].clone();
                    results.push((index, ProbeResult { probe, status }));
                }
            }
        }
    }
    results.sort_unstable_by_key(|(index, _)| *index);
    results.into_iter().map(|(_, result)| result).collect()
}

fn log_unavailable(obs: &Observations) {
    let sources: [(&str, Option<&SourceError>); 8] = [
        ("pods", obs.pods.as_ref().err()),
        ("nodes", obs.nodes.as_ref().err()),
        ("disk", obs.disk_percent.as_ref().err()),
        ("certificates", obs.certificates.as_ref().err()),
        ("postgres-cluster", obs.pg_cluster.as_ref().err()),
        ("backups", obs.backups.as_ref().err()),
        ("argocd", obs.argo_apps.as_ref().err()),
        ("prometheus", obs.alerts.as_ref().err()),
    ];
    for (check, err) in sources {
        if let Some(err) = err {
            warn!(check, error = %Chain(err), "source unavailable");
        }
    }
    for result in &obs.probes {
        if let Err(err) = &result.status {
            debug!(probe = %result.probe.name, error = %Chain(err), "HTTP check got no response");
        }
    }
}
