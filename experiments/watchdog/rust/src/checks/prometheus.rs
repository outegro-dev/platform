//! Prometheus: firing alerts from its rules. The watchdog is their messenger.

use std::collections::{BTreeMap, BTreeSet};

use crate::domain::{Alert, Finding, non_empty};
use crate::ports::SourceError;

/// Alerts that are never forwarded: the meta alerts, and pod problems the
/// pod check already reports with better keys.
pub const IGNORED_ALERTS: [&str; 5] = [
    "Watchdog",
    "InfoInhibitor",
    "KubePodCrashLooping",
    "KubePodNotReady",
    "ContainerOOMKilled",
];
/// Severities that are informational only.
pub const IGNORED_SEVERITIES: [&str; 2] = ["info", "none"];
/// Labels whose values form the scope of an alert.
pub const SCOPE_LABELS: [&str; 9] = [
    "namespace",
    "pod",
    "service",
    "queue",
    "name",
    "job_name",
    "deployment",
    "statefulset",
    "persistentvolumeclaim",
];

/// Firing, not ignored alerts → `prom:<alertname>:<scope>`; an API that does
/// not answer → `prom:api`.
pub fn evaluate(alerts: Result<&[Alert], &SourceError>) -> Vec<Finding> {
    let Ok(alerts) = alerts else {
        return vec![Finding::new(
            "prom:api",
            "Prometheus alerts API does not answer",
        )];
    };
    alerts
        .iter()
        .filter(|alert| alert.state == "firing")
        .filter_map(finding)
        .collect()
}

fn finding(alert: &Alert) -> Option<Finding> {
    let name = non_empty(alert.labels.get("alertname"))?;
    if IGNORED_ALERTS.contains(&name) {
        return None;
    }
    let severity = non_empty(alert.labels.get("severity")).unwrap_or("warning");
    if IGNORED_SEVERITIES.contains(&severity) {
        return None;
    }
    let scope = scope(&alert.labels);
    let summary = non_empty(alert.annotations.get("summary")).unwrap_or(&scope);
    Some(Finding::new(
        format!("prom:{name}:{scope}"),
        format!("{name} ({severity}): {summary}"),
    ))
}

/// Unique non-empty values of [`SCOPE_LABELS`], sorted, joined with `/`
/// (`jq 'map(select(. != null)) | unique | join("/")'`).
pub fn scope(labels: &BTreeMap<String, String>) -> String {
    SCOPE_LABELS
        .iter()
        .filter_map(|label| non_empty(labels.get(*label)))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn alert(state: &str, labels: &[(&str, &str)], summary: Option<&str>) -> Alert {
        Alert {
            state: state.into(),
            labels: labels
                .iter()
                .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
                .collect(),
            annotations: summary
                .map(|s| BTreeMap::from([("summary".to_owned(), s.to_owned())]))
                .unwrap_or_default(),
        }
    }

    fn keyed(alerts: &[Alert]) -> Vec<String> {
        evaluate(Ok(alerts))
            .into_iter()
            .map(|f| format!("{} · {}", f.key, f.message))
            .collect()
    }

    #[test]
    fn api_down() {
        assert_eq!(
            evaluate(Err(&SourceError::Status(503))),
            [Finding::new(
                "prom:api",
                "Prometheus alerts API does not answer"
            )]
        );
    }

    #[rstest]
    #[case::firing_with_summary(
        "firing",
        &[("alertname", "RabbitmqQueueBacklog"), ("severity", "critical"), ("namespace", "outegro"), ("queue", "mail")],
        Some("Queue mail is growing"),
        Some("prom:RabbitmqQueueBacklog:mail/outegro · RabbitmqQueueBacklog (critical): Queue mail is growing")
    )]
    #[case::summary_falls_back_to_scope(
        "firing",
        &[("alertname", "PVCAlmostFull"), ("namespace", "outegro"), ("persistentvolumeclaim", "data-pg-1")],
        None,
        Some("prom:PVCAlmostFull:data-pg-1/outegro · PVCAlmostFull (warning): data-pg-1/outegro")
    )]
    #[case::pending_is_ignored("pending", &[("alertname", "HighLatency")], None, None)]
    #[case::inactive_is_ignored("inactive", &[("alertname", "HighLatency")], None, None)]
    #[case::watchdog("firing", &[("alertname", "Watchdog"), ("severity", "none")], None, None)]
    #[case::info_inhibitor("firing", &[("alertname", "InfoInhibitor")], None, None)]
    #[case::crash_looping("firing", &[("alertname", "KubePodCrashLooping")], None, None)]
    #[case::not_ready("firing", &[("alertname", "KubePodNotReady")], None, None)]
    #[case::oom("firing", &[("alertname", "ContainerOOMKilled")], None, None)]
    #[case::info_severity("firing", &[("alertname", "CPUThrottling"), ("severity", "info")], None, None)]
    #[case::none_severity("firing", &[("alertname", "Something"), ("severity", "none")], None, None)]
    #[case::no_scope(
        "firing",
        &[("alertname", "NodeClockSkew")],
        None,
        Some("prom:NodeClockSkew: · NodeClockSkew (warning): ")
    )]
    #[case::no_alertname("firing", &[("severity", "critical")], None, None)]
    fn filters_and_formats(
        #[case] state: &str,
        #[case] labels: &[(&str, &str)],
        #[case] summary: Option<&str>,
        #[case] expected: Option<&str>,
    ) {
        assert_eq!(
            keyed(&[alert(state, labels, summary)]),
            expected.map(str::to_owned).into_iter().collect::<Vec<_>>()
        );
    }

    #[rstest]
    #[case::sorted_unique(&[("pod", "b"), ("namespace", "a"), ("name", "b")], "a/b")]
    #[case::skips_empty_and_foreign(&[("namespace", ""), ("job_name", "backup"), ("instance", "x")], "backup")]
    #[case::all_labels(
        &[("namespace", "1"), ("pod", "2"), ("service", "3"), ("queue", "4"), ("name", "5"),
          ("job_name", "6"), ("deployment", "7"), ("statefulset", "8"), ("persistentvolumeclaim", "9")],
        "1/2/3/4/5/6/7/8/9"
    )]
    #[case::empty(&[], "")]
    fn scope_rules(#[case] labels: &[(&str, &str)], #[case] expected: &str) {
        let labels = labels
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        assert_eq!(scope(&labels), expected);
    }
}
