//! Composition root: configuration → adapters → one pass → exit code.
//!
//! The only place that knows concrete adapter types and the only place that
//! uses `anyhow`: below this file every error is a typed `thiserror` enum.
#![forbid(unsafe_code)]

use std::process::ExitCode;
use std::sync::Arc;

use anyhow::Context as _;
use clap::Parser as _;
use tokio::signal::unix::{SignalKind, signal};
use tracing::{error, warn};
use watchdog::adapters;
use watchdog::adapters::clock::SystemClock;
use watchdog::adapters::cluster::{self, KubeCluster};
use watchdog::adapters::configmap::ConfigMapStore;
use watchdog::adapters::disk::StatvfsDisk;
use watchdog::adapters::http::HttpProber;
use watchdog::adapters::prometheus::PrometheusAlerts;
use watchdog::config::{Cli, Config};
use watchdog::run::{self, Deps, Settings};
use watchdog::telemetry::{self, Chain};

/// The state could not be read or written, or a client could not be built.
const EXIT_FAILURE: u8 = 1;
/// Invalid configuration, detected before any request.
const EXIT_CONFIG: u8 = 2;

/// One pass waits on the network almost all the time, so a single-threaded
/// runtime is enough; the checks still run concurrently on it.
#[tokio::main(flavor = "current_thread")]
async fn main() -> ExitCode {
    // clap itself exits with code 2 on malformed flags and 0 on --help.
    let config = match Config::try_from(Cli::parse()) {
        Ok(config) => config,
        Err(err) => {
            telemetry::init("info");
            error!(error = %Chain(&err), "invalid configuration");
            return ExitCode::from(EXIT_CONFIG);
        }
    };
    telemetry::init(&config.log_filter);

    match run(config).await {
        Ok(code) => code,
        Err(err) => {
            error!(error = %Chain(&*err), "pass failed");
            ExitCode::from(EXIT_FAILURE)
        }
    }
}

async fn run(config: Config) -> anyhow::Result<ExitCode> {
    // Handlers first: from here on a signal cancels the pass cleanly instead
    // of killing the process with the default action.
    let mut terminate = signal(SignalKind::terminate()).context("cannot handle SIGTERM")?;
    let mut interrupt = signal(SignalKind::interrupt()).context("cannot handle SIGINT")?;

    let kube = cluster::client()
        .await
        .context("cannot create Kubernetes client")?;
    let http = adapters::http::client().context("cannot create HTTP client")?;
    let alerts = PrometheusAlerts::new(http.clone(), &config.prometheus_url, config.http_timeout)
        .context("invalid PROMETHEUS_URL")?;

    // Constructor injection: every port gets its adapter here and nowhere else.
    let deps = Deps {
        cluster: Arc::new(KubeCluster::new(kube.clone())),
        prober: Arc::new(HttpProber::new(http.clone(), config.http_timeout)),
        alerts: Arc::new(alerts),
        disk: Arc::new(StatvfsDisk::new(config.disk_path.clone())),
        store: Arc::new(ConfigMapStore::new(
            kube,
            &config.namespace,
            config.state_configmap.clone(),
        )),
        notifier: adapters::notifier_for(&config.delivery, http),
        clock: Arc::new(SystemClock),
    };
    let settings = Settings::from(&config);

    // Whichever finishes first wins; the losing future is dropped, which
    // cancels in-flight requests and aborts the probe tasks.
    tokio::select! {
        result = run::run_once(&deps, &settings) => {
            result?;
            Ok(ExitCode::SUCCESS)
        }
        _ = terminate.recv() => Ok(cancelled("SIGTERM", 15)),
        _ = interrupt.recv() => Ok(cancelled("SIGINT", 2)),
    }
}

/// Conventional `128 + signal number` exit code.
fn cancelled(signal: &str, number: u8) -> ExitCode {
    warn!(
        signal,
        "pass cancelled: unfinished checks stopped, state not written"
    );
    ExitCode::from(128 + number)
}
