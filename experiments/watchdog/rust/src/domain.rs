//! Domain types: what the checks look at and what they produce.
//!
//! They are deliberately minimal. Adapters translate Kubernetes objects,
//! Prometheus JSON and HTTP answers into these structs, so the core never
//! depends on API crates and tests build them with plain literals.

use std::collections::BTreeMap;
use std::fmt;

use chrono::{DateTime, Utc};
use url::Url;

/// A problem found by a check. `key` identifies the problem across passes,
/// `message` is the line the owner reads in Telegram.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Finding {
    pub key: String,
    pub message: String,
}

impl Finding {
    pub fn new(key: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            key: key.into(),
            message: message.into(),
        }
    }
}

/// Numbers for the daily digest; `None` is rendered as `?`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Facts {
    pub pods_running: Option<usize>,
    pub backup_age_hours: Option<i64>,
    pub certificate_days_left: Option<i64>,
    pub disk_percent: Option<u8>,
}

/// A Kubernetes-style status condition (`type`, `status`, `reason`, ...).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Condition {
    pub kind: String,
    pub status: String,
    pub reason: Option<String>,
    pub message: Option<String>,
    pub last_transition: Option<DateTime<Utc>>,
}

impl Condition {
    pub fn is_true(&self) -> bool {
        self.status == "True"
    }
}

/// The first condition of the given type, as `jq 'map(select(.type == t)) | first'`.
pub fn find_condition<'a>(conditions: &'a [Condition], kind: &str) -> Option<&'a Condition> {
    conditions.iter().find(|c| c.kind == kind)
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Pod {
    pub namespace: String,
    pub name: String,
    pub labels: BTreeMap<String, String>,
    pub phase: Option<String>,
    /// Kinds from `metadata.ownerReferences` (`ReplicaSet`, `Job`, ...).
    pub owner_kinds: Vec<String>,
    pub created: Option<DateTime<Utc>>,
    pub conditions: Vec<Condition>,
    pub containers: Vec<ContainerStatus>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ContainerStatus {
    pub name: String,
    /// `state.waiting.reason`, if the container is waiting.
    pub waiting_reason: Option<String>,
    /// `lastState.terminated`, if the container was terminated before.
    pub last_terminated: Option<Terminated>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Terminated {
    pub reason: Option<String>,
    pub finished_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Node {
    pub name: String,
    pub conditions: Vec<Condition>,
}

/// `certificates.cert-manager.io/v1`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Certificate {
    pub namespace: String,
    pub name: String,
    pub conditions: Vec<Condition>,
    pub not_after: Option<DateTime<Utc>>,
}

/// `clusters.postgresql.cnpg.io/v1`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PgCluster {
    pub name: String,
    pub conditions: Vec<Condition>,
}

/// `backups.postgresql.cnpg.io/v1`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Backup {
    pub name: String,
    pub phase: Option<String>,
    pub stopped_at: Option<DateTime<Utc>>,
}

/// `applications.argoproj.io/v1alpha1`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ArgoApp {
    pub name: String,
    pub sync_status: Option<String>,
    pub health_status: Option<String>,
}

/// One entry of Prometheus `GET /api/v1/alerts`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Alert {
    pub state: String,
    pub labels: BTreeMap<String, String>,
    pub annotations: BTreeMap<String, String>,
}

/// An HTTP check from `PROBES` (`name=URL`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    pub name: String,
    pub url: Url,
}

impl fmt::Display for Probe {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}={}", self.name, self.url)
    }
}

/// Treats an empty string like a missing value (`Some("")` → `None`).
pub(crate) fn non_empty(value: Option<&String>) -> Option<&str> {
    value.map(String::as_str).filter(|v| !v.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn find_condition_returns_first_match() {
        let conditions = vec![
            Condition {
                kind: "Ready".into(),
                status: "False".into(),
                ..Condition::default()
            },
            Condition {
                kind: "Ready".into(),
                status: "True".into(),
                ..Condition::default()
            },
        ];
        let ready = find_condition(&conditions, "Ready").expect("ready condition");
        assert!(!ready.is_true());
        assert!(find_condition(&conditions, "MemoryPressure").is_none());
    }

    #[test]
    fn non_empty_filters_blank_values() {
        let blank = String::new();
        let value = "x".to_owned();
        assert_eq!(non_empty(None), None);
        assert_eq!(non_empty(Some(&blank)), None);
        assert_eq!(non_empty(Some(&value)), Some("x"));
    }

    #[test]
    fn probe_displays_as_config_entry() {
        let probe = Probe {
            name: "landing".into(),
            url: Url::parse("https://outegro.dev/").expect("url"),
        };
        assert_eq!(probe.to_string(), "landing=https://outegro.dev/");
    }
}
