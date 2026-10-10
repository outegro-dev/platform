//! Pure checks: `(observations, now) → findings + facts`.
//!
//! Nothing here performs I/O or reads the clock; the orchestrator
//! ([`crate::run`]) gathers [`Observations`] and passes `now` in. Each
//! submodule is one row of the specification table and is table-tested.

pub mod argo;
pub mod certificates;
pub mod disk;
pub mod http;
pub mod nodes;
pub mod pods;
pub mod postgres;
pub mod prometheus;

use chrono::{DateTime, Utc};

use crate::domain::{
    Alert, ArgoApp, Backup, Certificate, Facts, Finding, Node, PgCluster, Pod, Probe,
};
use crate::ports::SourceError;

/// Name of the CNPG cluster the watchdog looks at.
pub const PG_CLUSTER_NAME: &str = "pg";
/// Namespace of Argo CD applications.
pub const ARGO_NAMESPACE: &str = "argocd";

/// Everything the adapters observed in one pass. `Err` means the source gave
/// no data; each check decides what that means (a finding or a skip).
#[derive(Debug)]
pub struct Observations {
    pub pods: Result<Vec<Pod>, SourceError>,
    pub nodes: Result<Vec<Node>, SourceError>,
    pub disk_percent: Result<u8, SourceError>,
    pub certificates: Result<Vec<Certificate>, SourceError>,
    pub pg_cluster: Result<Option<PgCluster>, SourceError>,
    pub backups: Result<Vec<Backup>, SourceError>,
    pub argo_apps: Result<Vec<ArgoApp>, SourceError>,
    pub probes: Vec<ProbeResult>,
    pub alerts: Result<Vec<Alert>, SourceError>,
}

/// The answer of one HTTP check.
#[derive(Debug)]
pub struct ProbeResult {
    pub probe: Probe,
    pub status: Result<u16, SourceError>,
}

/// Result of all checks: deduplicated findings sorted by key, plus facts.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Evaluation {
    pub findings: Vec<Finding>,
    pub facts: Facts,
}

/// Runs every check over the observations, in the order of the specification
/// table, so "the first finding wins" is deterministic.
pub fn evaluate(obs: &Observations, watched: &[String], now: DateTime<Utc>) -> Evaluation {
    let mut findings = Vec::new();
    let mut facts = Facts::default();

    match &obs.pods {
        Ok(pods) => {
            findings.extend(pods::evaluate(pods, watched, now));
            findings.extend(pods::oom(pods, watched, now));
            facts.pods_running = Some(pods::running(pods));
        }
        Err(_) => findings.push(Finding::new("kube:pods", "cannot list pods")),
    }
    if let Ok(nodes) = &obs.nodes {
        findings.extend(nodes::evaluate(nodes));
    }
    if let Ok(percent) = obs.disk_percent {
        findings.extend(disk::evaluate(percent));
        facts.disk_percent = Some(percent);
    }
    if let Ok(certs) = &obs.certificates {
        findings.extend(certificates::evaluate(certs, now));
        facts.certificate_days_left = certificates::min_days_left(certs, now);
    }
    // As in the script, a cluster that cannot be read counts as missing.
    let cluster = obs.pg_cluster.as_ref().ok().and_then(Option::as_ref);
    findings.extend(postgres::cluster(PG_CLUSTER_NAME, cluster));
    if let Ok(backups) = &obs.backups {
        let backups = postgres::backups(backups, now);
        findings.extend(backups.finding);
        facts.backup_age_hours = backups.age_hours;
    }
    if let Ok(apps) = &obs.argo_apps {
        findings.extend(argo::evaluate(apps));
    }
    findings.extend(http::evaluate(&obs.probes));
    findings.extend(prometheus::evaluate(obs.alerts.as_deref()));

    Evaluation {
        findings: dedup(findings),
        facts,
    }
}

/// Keeps the first finding for each key and sorts by key.
///
/// The sort is stable, so among equal keys the original order survives and
/// `dedup_by` keeps the earliest one. No key is cloned.
pub fn dedup(mut findings: Vec<Finding>) -> Vec<Finding> {
    findings.sort_by(|a, b| a.key.cmp(&b.key));
    findings.dedup_by(|later, earlier| later.key == earlier.key);
    findings
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;
    use crate::domain::Condition;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 10, 8, 0, 0).unwrap()
    }

    fn failed() -> SourceError {
        SourceError::Status(500)
    }

    fn empty() -> Observations {
        Observations {
            pods: Ok(vec![]),
            nodes: Ok(vec![]),
            disk_percent: Ok(10),
            certificates: Ok(vec![]),
            pg_cluster: Ok(Some(PgCluster {
                name: "pg".into(),
                conditions: vec![],
            })),
            backups: Ok(vec![Backup {
                name: "b".into(),
                phase: Some("completed".into()),
                stopped_at: Some(now() - chrono::Duration::hours(3)),
            }]),
            argo_apps: Ok(vec![]),
            probes: vec![],
            alerts: Ok(vec![]),
        }
    }

    #[test]
    fn healthy_cluster_has_no_findings_and_all_facts() {
        let evaluation = evaluate(&empty(), &["outegro".into()], now());
        assert!(evaluation.findings.is_empty(), "{evaluation:?}");
        assert_eq!(
            evaluation.facts,
            Facts {
                pods_running: Some(0),
                backup_age_hours: Some(3),
                certificate_days_left: None,
                disk_percent: Some(10),
            }
        );
    }

    #[test]
    fn failed_sources_follow_the_script() {
        let obs = Observations {
            pods: Err(failed()),
            nodes: Err(failed()),
            disk_percent: Err(failed()),
            certificates: Err(failed()),
            pg_cluster: Err(failed()),
            backups: Err(failed()),
            argo_apps: Err(failed()),
            probes: vec![],
            alerts: Err(failed()),
        };
        let evaluation = evaluate(&obs, &["outegro".into()], now());
        let keys: Vec<&str> = evaluation.findings.iter().map(|f| f.key.as_str()).collect();
        // Pods, the PG cluster and Prometheus produce findings; nodes,
        // certificates, backups and Argo CD are skipped.
        assert_eq!(keys, ["kube:pods", "pg:cluster", "prom:api"]);
        assert_eq!(evaluation.facts, Facts::default());
    }

    #[test]
    fn findings_are_sorted_and_first_wins() {
        let findings = vec![
            Finding::new("b", "first b"),
            Finding::new("a", "only a"),
            Finding::new("b", "second b"),
        ];
        assert_eq!(
            dedup(findings),
            vec![Finding::new("a", "only a"), Finding::new("b", "first b")]
        );
    }

    #[test]
    fn duplicate_keys_across_checks_keep_the_earlier_check() {
        let mut obs = empty();
        // The same node condition reported twice by the source.
        let condition = Condition {
            kind: "DiskPressure".into(),
            status: "True".into(),
            reason: Some("first".into()),
            ..Condition::default()
        };
        let mut second = condition.clone();
        second.reason = Some("second".into());
        obs.nodes = Ok(vec![Node {
            name: "n1".into(),
            conditions: vec![condition, second],
        }]);
        let evaluation = evaluate(&obs, &[], now());
        assert_eq!(evaluation.findings.len(), 1);
        assert_eq!(
            evaluation.findings[0].message,
            "node n1: DiskPressure=True (first)"
        );
    }
}
