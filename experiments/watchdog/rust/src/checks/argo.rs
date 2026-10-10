//! Argo CD: every application synced and healthy.

use crate::domain::{ArgoApp, Finding};

/// `argo:<app> · Argo CD <app>: <sync or ?> / <health or ?>` for every
/// application that is not `Synced` + `Healthy`. Deploys are covered by the
/// 15-minute grace in the alerting plan, not here.
pub fn evaluate(apps: &[ArgoApp]) -> Vec<Finding> {
    apps.iter()
        .filter(|app| {
            app.sync_status.as_deref() != Some("Synced")
                || app.health_status.as_deref() != Some("Healthy")
        })
        .map(|app| {
            Finding::new(
                format!("argo:{}", app.name),
                format!(
                    "Argo CD {}: {} / {}",
                    app.name,
                    app.sync_status.as_deref().unwrap_or("?"),
                    app.health_status.as_deref().unwrap_or("?")
                ),
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case::healthy(Some("Synced"), Some("Healthy"), None)]
    #[case::out_of_sync(
        Some("OutOfSync"),
        Some("Healthy"),
        Some("Argo CD landing: OutOfSync / Healthy")
    )]
    #[case::degraded(
        Some("Synced"),
        Some("Degraded"),
        Some("Argo CD landing: Synced / Degraded")
    )]
    #[case::progressing(
        Some("Synced"),
        Some("Progressing"),
        Some("Argo CD landing: Synced / Progressing")
    )]
    #[case::unknown_status(None, None, Some("Argo CD landing: ? / ?"))]
    fn sync_and_health(
        #[case] sync: Option<&str>,
        #[case] health: Option<&str>,
        #[case] expected: Option<&str>,
    ) {
        let app = ArgoApp {
            name: "landing".into(),
            sync_status: sync.map(str::to_owned),
            health_status: health.map(str::to_owned),
        };
        let findings = evaluate(&[app]);
        assert_eq!(
            findings
                .iter()
                .map(|f| f.message.as_str())
                .collect::<Vec<_>>(),
            expected.into_iter().collect::<Vec<_>>()
        );
        assert!(findings.iter().all(|f| f.key == "argo:landing"));
    }
}
