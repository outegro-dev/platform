//! PostgreSQL (CNPG): cluster conditions and the age of the last backup.

use chrono::{DateTime, Utc};

use crate::domain::{Backup, Finding, PgCluster};

/// Cluster conditions that must be `True`.
pub const WATCHED_CONDITIONS: [&str; 3] = ["Ready", "ContinuousArchiving", "LastBackupSucceeded"];
/// A last completed backup this old (in whole hours) is reported.
pub const BACKUP_MAX_AGE_HOURS: i64 = 26;

/// `pg:<type> · PostgreSQL <type>: <reason> <message>` for every watched
/// condition that is not `True`; `pg:cluster` if the cluster is missing.
pub fn cluster(name: &str, cluster: Option<&PgCluster>) -> Vec<Finding> {
    let Some(cluster) = cluster else {
        return vec![Finding::new(
            "pg:cluster",
            format!("PostgreSQL cluster {name} is missing"),
        )];
    };
    cluster
        .conditions
        .iter()
        .filter(|c| WATCHED_CONDITIONS.contains(&c.kind.as_str()) && !c.is_true())
        .map(|c| {
            Finding::new(
                format!("pg:{}", c.kind),
                format!(
                    "PostgreSQL {}: {} {}",
                    c.kind,
                    c.reason.as_deref().unwrap_or_default(),
                    c.message.as_deref().unwrap_or_default()
                ),
            )
        })
        .collect()
}

/// What the backup check found: maybe a finding, and the age for the digest.
#[derive(Debug, PartialEq, Eq)]
pub struct BackupStatus {
    pub finding: Option<Finding>,
    pub age_hours: Option<i64>,
}

/// Looks at the newest `completed` backup by `stoppedAt`.
pub fn backups(backups: &[Backup], now: DateTime<Utc>) -> BackupStatus {
    let last = backups
        .iter()
        .filter(|b| b.phase.as_deref() == Some("completed"))
        .filter_map(|b| b.stopped_at)
        .max();
    match last {
        None => BackupStatus {
            finding: Some(Finding::new("pg:backup-age", "no completed backup found")),
            age_hours: None,
        },
        Some(stopped) => {
            // Integer division truncates like the script's `$(( ... / 3600 ))`.
            let hours = (now - stopped).num_seconds() / 3600;
            BackupStatus {
                finding: (hours >= BACKUP_MAX_AGE_HOURS).then(|| {
                    Finding::new(
                        "pg:backup-age",
                        format!("last completed backup is {hours} h old"),
                    )
                }),
                age_hours: Some(hours),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone};
    use rstest::rstest;

    use super::*;
    use crate::domain::Condition;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 10, 8, 0, 0).unwrap()
    }

    fn condition(
        kind: &str,
        status: &str,
        reason: Option<&str>,
        message: Option<&str>,
    ) -> Condition {
        Condition {
            kind: kind.into(),
            status: status.into(),
            reason: reason.map(str::to_owned),
            message: message.map(str::to_owned),
            ..Condition::default()
        }
    }

    #[test]
    fn missing_cluster() {
        assert_eq!(
            cluster("pg", None),
            [Finding::new(
                "pg:cluster",
                "PostgreSQL cluster pg is missing"
            )]
        );
    }

    #[rstest]
    #[case::ready_ok("Ready", "True", None)]
    #[case::ready_false(
        "Ready",
        "False",
        Some("pg:Ready · PostgreSQL Ready: ClusterIsNotReady Cluster is not ready")
    )]
    #[case::archiving(
        "ContinuousArchiving",
        "False",
        Some(
            "pg:ContinuousArchiving · PostgreSQL ContinuousArchiving: ClusterIsNotReady Cluster is not ready"
        )
    )]
    #[case::last_backup(
        "LastBackupSucceeded",
        "Unknown",
        Some(
            "pg:LastBackupSucceeded · PostgreSQL LastBackupSucceeded: ClusterIsNotReady Cluster is not ready"
        )
    )]
    #[case::unwatched("PhysicalReplicationSlots", "False", None)]
    fn conditions(#[case] kind: &str, #[case] status: &str, #[case] expected: Option<&str>) {
        let pg = PgCluster {
            name: "pg".into(),
            conditions: vec![condition(
                kind,
                status,
                Some("ClusterIsNotReady"),
                Some("Cluster is not ready"),
            )],
        };
        let found: Vec<String> = cluster("pg", Some(&pg))
            .into_iter()
            .map(|f| format!("{} · {}", f.key, f.message))
            .collect();
        assert_eq!(
            found,
            expected.map(str::to_owned).into_iter().collect::<Vec<_>>()
        );
    }

    #[test]
    fn condition_without_reason_keeps_script_spacing() {
        let pg = PgCluster {
            name: "pg".into(),
            conditions: vec![condition("Ready", "False", None, None)],
        };
        assert_eq!(cluster("pg", Some(&pg))[0].message, "PostgreSQL Ready:  ");
    }

    fn backup(phase: &str, hours_ago: Option<i64>) -> Backup {
        Backup {
            name: "b".into(),
            phase: Some(phase.into()),
            stopped_at: hours_ago.map(|h| now() - Duration::hours(h)),
        }
    }

    #[rstest]
    #[case::fresh(Duration::hours(3), 3, false)]
    #[case::just_under(Duration::hours(26) - Duration::seconds(1), 25, false)]
    #[case::exactly_26h(Duration::hours(26), 26, true)]
    #[case::two_days(Duration::hours(48), 48, true)]
    fn backup_age_boundary(#[case] age: Duration, #[case] hours: i64, #[case] fires: bool) {
        let status = backups(
            &[Backup {
                name: "b".into(),
                phase: Some("completed".into()),
                stopped_at: Some(now() - age),
            }],
            now(),
        );
        assert_eq!(status.age_hours, Some(hours));
        assert_eq!(
            status.finding,
            fires.then(|| Finding::new(
                "pg:backup-age",
                format!("last completed backup is {hours} h old")
            ))
        );
    }

    #[test]
    fn newest_completed_backup_wins() {
        let list = [
            backup("completed", Some(50)),
            backup("failed", Some(1)),
            backup("completed", Some(4)),
            backup("completed", None),
        ];
        let status = backups(&list, now());
        assert_eq!(status.age_hours, Some(4));
        assert_eq!(status.finding, None);
    }

    #[rstest]
    #[case::none(&[])]
    #[case::only_failed(&[("failed", Some(1))])]
    #[case::completed_without_time(&[("completed", None)])]
    fn no_completed_backup(#[case] list: &[(&str, Option<i64>)]) {
        let list: Vec<Backup> = list.iter().map(|(p, h)| backup(p, *h)).collect();
        assert_eq!(
            backups(&list, now()),
            BackupStatus {
                finding: Some(Finding::new("pg:backup-age", "no completed backup found")),
                age_hours: None,
            }
        );
    }
}
