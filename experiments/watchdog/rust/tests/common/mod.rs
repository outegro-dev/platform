//! In-memory fakes of the ports and fixtures shared by integration tests.
//!
//! Like a `NestJS` testing module with `useValue` providers: the real `run`
//! code talks to these through the same traits as in production.

// Each test binary uses a different subset of the helpers.
#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use chrono::{DateTime, TimeZone, Utc};
use watchdog::domain::{ArgoApp, Backup, Certificate, Node, PgCluster, Pod};
use watchdog::ports::{Clock, ClusterSource, DiskStat, SourceError, StateStore, StoreError};
use watchdog::state::State;

/// What the fake cluster answers. `None` means "the API call fails".
#[derive(Debug, Clone, Default)]
pub struct ClusterData {
    pub pods: Option<Vec<Pod>>,
    pub nodes: Option<Vec<Node>>,
    pub certificates: Option<Vec<Certificate>>,
    /// `Some(None)`: the cluster does not exist.
    #[allow(clippy::option_option)]
    pub pg_cluster: Option<Option<PgCluster>>,
    pub backups: Option<Vec<Backup>>,
    pub argo_apps: Option<Vec<ArgoApp>>,
    /// Every call waits this long first (deadline tests).
    pub delay: Duration,
}

#[derive(Debug, Default)]
pub struct FakeCluster {
    data: Mutex<ClusterData>,
}

impl FakeCluster {
    pub fn new(data: ClusterData) -> Arc<Self> {
        Arc::new(Self {
            data: Mutex::new(data),
        })
    }

    /// Changes the cluster between passes.
    pub fn update(&self, change: impl FnOnce(&mut ClusterData)) {
        change(&mut self.data.lock().unwrap());
    }

    /// Clones the data so no lock is held across `.await`.
    async fn answer<T: Clone>(
        &self,
        pick: impl Fn(&ClusterData) -> Option<T>,
    ) -> Result<T, SourceError> {
        let (value, delay) = {
            let data = self.data.lock().unwrap();
            (pick(&data), data.delay)
        };
        tokio::time::sleep(delay).await;
        value.ok_or(SourceError::Status(500))
    }
}

#[async_trait]
impl ClusterSource for FakeCluster {
    async fn pods(&self) -> Result<Vec<Pod>, SourceError> {
        self.answer(|d| d.pods.clone()).await
    }

    async fn nodes(&self) -> Result<Vec<Node>, SourceError> {
        self.answer(|d| d.nodes.clone()).await
    }

    async fn certificates(&self) -> Result<Vec<Certificate>, SourceError> {
        self.answer(|d| d.certificates.clone()).await
    }

    async fn pg_cluster(
        &self,
        namespace: &str,
        name: &str,
    ) -> Result<Option<PgCluster>, SourceError> {
        assert_eq!((namespace, name), ("outegro", "pg"));
        self.answer(|d| d.pg_cluster.clone()).await
    }

    async fn backups(&self, namespace: &str) -> Result<Vec<Backup>, SourceError> {
        assert_eq!(namespace, "outegro");
        self.answer(|d| d.backups.clone()).await
    }

    async fn argo_applications(&self, namespace: &str) -> Result<Vec<ArgoApp>, SourceError> {
        assert_eq!(namespace, "argocd");
        self.answer(|d| d.argo_apps.clone()).await
    }
}

/// A state store in memory that counts writes and can be told to fail.
#[derive(Debug, Default)]
pub struct FakeStore {
    pub state: Mutex<Option<State>>,
    pub saves: AtomicUsize,
    pub fail_load: bool,
    pub fail_save: bool,
}

impl FakeStore {
    pub fn empty() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn with(state: State) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(Some(state)),
            ..Self::default()
        })
    }

    pub fn current(&self) -> Option<State> {
        self.state.lock().unwrap().clone()
    }

    pub fn save_count(&self) -> usize {
        self.saves.load(Ordering::SeqCst)
    }
}

#[async_trait]
impl StateStore for FakeStore {
    async fn load(&self) -> Result<Option<State>, StoreError> {
        if self.fail_load {
            return Err(StoreError::Read("API unavailable".into()));
        }
        Ok(self.current())
    }

    async fn save(&self, state: &State) -> Result<(), StoreError> {
        if self.fail_save {
            return Err(StoreError::Write("API unavailable".into()));
        }
        self.saves.fetch_add(1, Ordering::SeqCst);
        *self.state.lock().unwrap() = Some(state.clone());
        Ok(())
    }
}

/// Disk usage that never changes; `None` fails like a missing mount.
#[derive(Debug, Clone, Copy)]
pub struct FakeDisk(pub Option<u8>);

#[async_trait]
impl DiskStat for FakeDisk {
    async fn percent_used(&self) -> Result<u8, SourceError> {
        self.0
            .ok_or_else(|| SourceError::Io(std::io::Error::other("not mounted")))
    }
}

/// A clock the test moves by hand.
#[derive(Debug)]
pub struct FakeClock(Mutex<DateTime<Utc>>);

impl FakeClock {
    pub fn at(time: DateTime<Utc>) -> Arc<Self> {
        Arc::new(Self(Mutex::new(time)))
    }

    pub fn advance(&self, by: chrono::Duration) {
        *self.0.lock().unwrap() += by;
    }
}

impl Clock for FakeClock {
    fn now(&self) -> DateTime<Utc> {
        *self.0.lock().unwrap()
    }
}

pub fn utc(hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 10, 10, hour, minute, 0).unwrap()
}
