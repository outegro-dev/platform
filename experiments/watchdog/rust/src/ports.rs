//! Ports: the traits the core needs from the outside world.
//!
//! Adapters in [`crate::adapters`] implement them for Kubernetes, HTTP,
//! Telegram and the filesystem; tests implement them with in-memory fakes.
//!
//! Async methods use `#[async_trait]` because the composition root picks the
//! implementation at runtime (Telegram or stdout, depending on `DRY_RUN`), so
//! the traits are used as `Arc<dyn Trait>`. Native `async fn` in traits is not
//! dyn-compatible yet; `async_trait` boxes the future to make it so.

use std::error::Error as StdError;

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use thiserror::Error;
use url::Url;

use crate::domain::{Alert, ArgoApp, Backup, Certificate, Node, PgCluster, Pod};
use crate::state::State;

/// A boxed error that can cross task boundaries.
pub type BoxError = Box<dyn StdError + Send + Sync + 'static>;

/// Why a source (cluster, HTTP, Prometheus, disk) gave no data.
#[derive(Debug, Error)]
pub enum SourceError {
    /// The pass deadline expired before the source answered.
    #[error("deadline exceeded")]
    Deadline,
    /// The request failed: network, TLS, timeout or an API error.
    #[error("request failed")]
    Request(#[source] BoxError),
    /// The source answered with an unexpected HTTP status.
    #[error("unexpected HTTP status {0}")]
    Status(u16),
    /// The answer could not be decoded.
    #[error("cannot decode response")]
    Decode(#[source] BoxError),
    /// A local system call failed (statvfs).
    #[error("I/O error")]
    Io(#[from] std::io::Error),
}

/// Reading or writing the persisted state failed.
#[derive(Debug, Error)]
pub enum StoreError {
    #[error("cannot read state")]
    Read(#[source] BoxError),
    #[error("cannot write state")]
    Write(#[source] BoxError),
    #[error("cannot encode state")]
    Encode(#[from] serde_json::Error),
}

/// A message was not delivered.
#[derive(Debug, Error)]
pub enum NotifyError {
    /// Telegram answered but did not accept the message.
    #[error("Telegram rejected the message: HTTP {status}: {description}")]
    Rejected { status: u16, description: String },
    /// Telegram could not be reached. The source never contains the bot token.
    #[error("cannot reach Telegram at {url}")]
    Transport {
        /// The request URL with the token masked.
        url: String,
        #[source]
        source: BoxError,
    },
    /// Writing to stdout failed (`DRY_RUN`).
    #[error("cannot write message")]
    Io(#[from] std::io::Error),
}

/// Kubernetes, reduced to the domain structs the checks need.
#[async_trait]
pub trait ClusterSource: Send + Sync {
    /// All pods in all namespaces (the checks filter by namespace).
    async fn pods(&self) -> Result<Vec<Pod>, SourceError>;
    async fn nodes(&self) -> Result<Vec<Node>, SourceError>;
    /// cert-manager certificates in all namespaces.
    async fn certificates(&self) -> Result<Vec<Certificate>, SourceError>;
    /// The CNPG cluster, `None` if it does not exist.
    async fn pg_cluster(
        &self,
        namespace: &str,
        name: &str,
    ) -> Result<Option<PgCluster>, SourceError>;
    async fn backups(&self, namespace: &str) -> Result<Vec<Backup>, SourceError>;
    async fn argo_applications(&self, namespace: &str) -> Result<Vec<ArgoApp>, SourceError>;
}

/// An HTTP GET that reports the status code.
#[async_trait]
pub trait Prober: Send + Sync {
    async fn status(&self, url: &Url) -> Result<u16, SourceError>;
}

/// Prometheus alerts.
#[async_trait]
pub trait AlertsSource: Send + Sync {
    async fn alerts(&self) -> Result<Vec<Alert>, SourceError>;
}

/// Disk usage of the probed volume, in percent (as `df`).
#[async_trait]
pub trait DiskStat: Send + Sync {
    async fn percent_used(&self) -> Result<u8, SourceError>;
}

/// Where the alerting state lives between passes.
#[async_trait]
pub trait StateStore: Send + Sync {
    /// `None` means "first run": nothing stored yet or the stored state is
    /// unreadable (the adapter logs a warning in that case).
    async fn load(&self) -> Result<Option<State>, StoreError>;
    async fn save(&self, state: &State) -> Result<(), StoreError>;
}

/// Delivers one message to the owner.
#[async_trait]
pub trait Notifier: Send + Sync {
    async fn send(&self, text: &str) -> Result<(), NotifyError>;
}

/// The current time, injected so tests control it.
pub trait Clock: Send + Sync {
    fn now(&self) -> DateTime<Utc>;
}
