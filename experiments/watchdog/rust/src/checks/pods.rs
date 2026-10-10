//! Pods: failing containers, long "not ready", recent OOM kills.

use chrono::{DateTime, Utc};

use crate::domain::{Condition, ContainerStatus, Finding, Pod, find_condition, non_empty};

/// Waiting reasons that mean the container will not start by itself.
pub const BAD_WAITING_REASONS: [&str; 4] = [
    "CrashLoopBackOff",
    "ImagePullBackOff",
    "ErrImagePull",
    "CreateContainerConfigError",
];
/// A pod must be not ready for longer than this to be reported.
pub const NOT_READY_AFTER_SECS: i64 = 600;
/// OOM kills younger than this are reported.
pub const OOM_WINDOW_SECS: i64 = 900;

const APP_LABELS: [&str; 3] = ["app", "app.kubernetes.io/name", "k8s-app"];

/// `<app>` of a pod: label `app`, else `app.kubernetes.io/name`, else
/// `k8s-app`, else the pod name.
pub fn app_name(pod: &Pod) -> &str {
    APP_LABELS
        .iter()
        .find_map(|label| non_empty(pod.labels.get(*label)))
        .unwrap_or(&pod.name)
}

fn is_watched(pod: &Pod, watched: &[String]) -> bool {
    watched.contains(&pod.namespace)
}

fn is_job_pod(pod: &Pod) -> bool {
    pod.owner_kinds.iter().any(|kind| kind == "Job")
}

/// Crash loops, image pull errors and pods not ready for over 10 minutes in
/// watched namespaces. Completed pods and pods of Jobs are ignored.
pub fn evaluate(pods: &[Pod], watched: &[String], now: DateTime<Utc>) -> Vec<Finding> {
    pods.iter()
        .filter(|pod| is_watched(pod, watched))
        .filter(|pod| pod.phase.as_deref() != Some("Succeeded"))
        .filter(|pod| !is_job_pod(pod))
        .filter_map(|pod| problem(pod, now))
        .collect()
}

fn problem(pod: &Pod, now: DateTime<Utc>) -> Option<Finding> {
    let key = format!("pod:{}/{}", pod.namespace, app_name(pod));
    let bad_reason = pod
        .containers
        .iter()
        .filter_map(|c| c.waiting_reason.as_deref())
        .find(|reason| BAD_WAITING_REASONS.contains(reason));
    if let Some(reason) = bad_reason {
        return Some(Finding::new(
            key,
            format!("{}/{}: {reason}", pod.namespace, pod.name),
        ));
    }

    let ready = find_condition(&pod.conditions, "Ready");
    if ready.is_some_and(Condition::is_true) {
        return None;
    }
    let since = ready.and_then(|c| c.last_transition).or(pod.created)?;
    let age = (now - since).num_seconds();
    (age > NOT_READY_AFTER_SECS).then(|| {
        Finding::new(
            key,
            format!(
                "{}/{} not ready for {} min",
                pod.namespace,
                pod.name,
                age / 60
            ),
        )
    })
}

/// Containers killed for running out of memory in the last 15 minutes. All
/// pods of watched namespaces count, including completed ones and Jobs.
pub fn oom(pods: &[Pod], watched: &[String], now: DateTime<Utc>) -> Vec<Finding> {
    pods.iter()
        .filter(|pod| is_watched(pod, watched))
        .flat_map(|pod| {
            pod.containers
                .iter()
                .filter(move |c| recently_oom_killed(c, now))
                .map(move |c| {
                    Finding::new(
                        format!("oom:{}/{}", pod.namespace, c.name),
                        format!(
                            "{}/{}: container {} ran out of memory",
                            pod.namespace, pod.name, c.name
                        ),
                    )
                })
        })
        .collect()
}

fn recently_oom_killed(container: &ContainerStatus, now: DateTime<Utc>) -> bool {
    container.last_terminated.as_ref().is_some_and(|t| {
        t.reason.as_deref() == Some("OOMKilled")
            && t.finished_at
                .is_some_and(|at| (now - at).num_seconds() < OOM_WINDOW_SECS)
    })
}

/// Pods in phase `Running`, all namespaces (a digest fact).
pub fn running(pods: &[Pod]) -> usize {
    pods.iter()
        .filter(|pod| pod.phase.as_deref() == Some("Running"))
        .count()
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use chrono::{Duration, TimeZone};
    use rstest::rstest;

    use super::*;
    use crate::domain::Terminated;

    fn now() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 10, 8, 0, 0).unwrap()
    }

    fn watched() -> Vec<String> {
        vec!["outegro".to_owned(), "kube-system".to_owned()]
    }

    fn pod(name: &str) -> Pod {
        Pod {
            namespace: "outegro".into(),
            name: name.into(),
            labels: BTreeMap::from([("app".into(), "api".into())]),
            phase: Some("Running".into()),
            created: Some(now() - Duration::days(1)),
            conditions: vec![ready(true, None)],
            containers: vec![ContainerStatus {
                name: "main".into(),
                ..ContainerStatus::default()
            }],
            ..Pod::default()
        }
    }

    fn ready(ok: bool, changed: Option<DateTime<Utc>>) -> Condition {
        Condition {
            kind: "Ready".into(),
            status: if ok { "True" } else { "False" }.into(),
            last_transition: changed,
            ..Condition::default()
        }
    }

    fn waiting(reason: &str) -> Pod {
        let mut p = pod("api-1");
        p.containers[0].waiting_reason = Some(reason.into());
        p.conditions = vec![ready(false, Some(now()))];
        p
    }

    fn messages(findings: &[Finding]) -> Vec<String> {
        findings
            .iter()
            .map(|f| format!("{} · {}", f.key, f.message))
            .collect()
    }

    #[rstest]
    #[case::crash_loop("CrashLoopBackOff", true)]
    #[case::image_pull("ImagePullBackOff", true)]
    #[case::err_image_pull("ErrImagePull", true)]
    #[case::config_error("CreateContainerConfigError", true)]
    #[case::creating("ContainerCreating", false)]
    #[case::pod_initializing("PodInitializing", false)]
    fn waiting_reasons(#[case] reason: &str, #[case] fires: bool) {
        let findings = evaluate(&[waiting(reason)], &watched(), now());
        let expected = if fires {
            vec![format!("pod:outegro/api · outegro/api-1: {reason}")]
        } else {
            vec![]
        };
        assert_eq!(messages(&findings), expected);
    }

    #[rstest]
    #[case::just_changed(0, None)]
    #[case::exactly_600s(600, None)]
    #[case::over_600s(601, Some("outegro/api-1 not ready for 10 min"))]
    #[case::one_hour(3600, Some("outegro/api-1 not ready for 60 min"))]
    fn not_ready_boundary(#[case] age_secs: i64, #[case] expected: Option<&str>) {
        let mut p = pod("api-1");
        p.conditions = vec![ready(false, Some(now() - Duration::seconds(age_secs)))];
        let findings = evaluate(&[p], &watched(), now());
        assert_eq!(
            findings
                .iter()
                .map(|f| f.message.as_str())
                .collect::<Vec<_>>(),
            expected.into_iter().collect::<Vec<_>>()
        );
    }

    #[test]
    fn not_ready_without_condition_counts_from_creation() {
        let mut p = pod("api-1");
        p.conditions = vec![];
        p.created = Some(now() - Duration::seconds(601));
        let findings = evaluate(&[p], &watched(), now());
        assert_eq!(
            messages(&findings),
            ["pod:outegro/api · outegro/api-1 not ready for 10 min"]
        );
    }

    #[test]
    fn not_ready_with_unknown_status_counts_as_not_ready() {
        let mut p = pod("api-1");
        p.conditions = vec![Condition {
            kind: "Ready".into(),
            status: "Unknown".into(),
            last_transition: Some(now() - Duration::minutes(20)),
            ..Condition::default()
        }];
        assert_eq!(evaluate(&[p], &watched(), now()).len(), 1);
    }

    #[test]
    fn crash_wins_over_not_ready() {
        let mut p = waiting("CrashLoopBackOff");
        p.conditions = vec![ready(false, Some(now() - Duration::hours(1)))];
        let findings = evaluate(&[p], &watched(), now());
        assert_eq!(
            messages(&findings),
            ["pod:outegro/api · outegro/api-1: CrashLoopBackOff"]
        );
    }

    #[rstest]
    #[case::succeeded_phase(Some("Succeeded"), "ReplicaSet", false)]
    #[case::job_owner(Some("Failed"), "Job", false)]
    #[case::failed_replica(Some("Failed"), "ReplicaSet", true)]
    #[case::pending_without_phase(None, "StatefulSet", true)]
    fn skips_completed_and_job_pods(
        #[case] phase: Option<&str>,
        #[case] owner: &str,
        #[case] fires: bool,
    ) {
        let mut p = waiting("CrashLoopBackOff");
        p.phase = phase.map(str::to_owned);
        p.owner_kinds = vec![owner.to_owned()];
        assert_eq!(!evaluate(&[p], &watched(), now()).is_empty(), fires);
    }

    #[test]
    fn ignores_unwatched_namespaces() {
        let mut p = waiting("CrashLoopBackOff");
        p.namespace = "monitoring".into();
        assert_eq!(evaluate(&[p], &watched(), now()), []);
    }

    #[rstest]
    #[case::app(&[("app", "web"), ("app.kubernetes.io/name", "x"), ("k8s-app", "y")], "web")]
    #[case::kubernetes_name(&[("app.kubernetes.io/name", "x"), ("k8s-app", "y")], "x")]
    #[case::k8s_app(&[("k8s-app", "kube-dns")], "kube-dns")]
    #[case::empty_app_falls_through(&[("app", ""), ("k8s-app", "y")], "y")]
    #[case::pod_name(&[], "api-1")]
    fn app_name_choice(#[case] labels: &[(&str, &str)], #[case] expected: &str) {
        let mut p = pod("api-1");
        p.labels = labels
            .iter()
            .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
            .collect();
        assert_eq!(app_name(&p), expected);
    }

    fn oom_pod(finished_secs_ago: Option<i64>, reason: &str) -> Pod {
        let mut p = pod("worker-1");
        p.containers[0].last_terminated = Some(Terminated {
            reason: Some(reason.into()),
            finished_at: finished_secs_ago.map(|s| now() - Duration::seconds(s)),
        });
        p
    }

    #[rstest]
    #[case::fresh(60, "OOMKilled", true)]
    #[case::just_inside(899, "OOMKilled", true)]
    #[case::exactly_900s(900, "OOMKilled", false)]
    #[case::old(3600, "OOMKilled", false)]
    #[case::other_reason(60, "Error", false)]
    fn oom_window(#[case] secs_ago: i64, #[case] reason: &str, #[case] fires: bool) {
        let findings = oom(&[oom_pod(Some(secs_ago), reason)], &watched(), now());
        let expected = if fires {
            vec!["oom:outegro/main · outegro/worker-1: container main ran out of memory".to_owned()]
        } else {
            vec![]
        };
        assert_eq!(messages(&findings), expected);
    }

    #[test]
    fn oom_counts_completed_job_pods_but_not_unknown_time() {
        let mut job = oom_pod(Some(30), "OOMKilled");
        job.phase = Some("Succeeded".into());
        job.owner_kinds = vec!["Job".into()];
        assert_eq!(oom(&[job], &watched(), now()).len(), 1);
        assert_eq!(oom(&[oom_pod(None, "OOMKilled")], &watched(), now()), []);
    }

    #[test]
    fn running_counts_all_namespaces() {
        let mut other = pod("x");
        other.namespace = "monitoring".into();
        let mut pending = pod("y");
        pending.phase = Some("Pending".into());
        assert_eq!(running(&[pod("a"), other, pending]), 2);
    }
}
