//! Nodes: readiness and kubelet pressure conditions.

use crate::domain::{Condition, Finding, Node};

/// `Ready` not `True`, or any other condition `True` (memory, disk or PID
/// pressure, network unavailable).
pub fn evaluate(nodes: &[Node]) -> Vec<Finding> {
    nodes
        .iter()
        .flat_map(|node| {
            node.conditions
                .iter()
                .filter(|c| is_problem(c))
                .map(move |c| {
                    Finding::new(
                        format!("node:{}:{}", node.name, c.kind),
                        format!(
                            "node {}: {}={} ({})",
                            node.name,
                            c.kind,
                            c.status,
                            c.reason.as_deref().unwrap_or_default()
                        ),
                    )
                })
        })
        .collect()
}

fn is_problem(condition: &Condition) -> bool {
    if condition.kind == "Ready" {
        !condition.is_true()
    } else {
        condition.is_true()
    }
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    fn node(kind: &str, status: &str, reason: Option<&str>) -> Node {
        Node {
            name: "srv1".into(),
            conditions: vec![Condition {
                kind: kind.into(),
                status: status.into(),
                reason: reason.map(str::to_owned),
                ..Condition::default()
            }],
        }
    }

    #[rstest]
    #[case::ready("Ready", "True", None, None)]
    #[case::not_ready(
        "Ready",
        "False",
        Some("KubeletNotReady"),
        Some("node:srv1:Ready · node srv1: Ready=False (KubeletNotReady)")
    )]
    #[case::ready_unknown(
        "Ready",
        "Unknown",
        None,
        Some("node:srv1:Ready · node srv1: Ready=Unknown ()")
    )]
    #[case::memory_ok("MemoryPressure", "False", None, None)]
    #[case::memory_pressure(
        "MemoryPressure",
        "True",
        Some("KubeletHasInsufficientMemory"),
        Some(
            "node:srv1:MemoryPressure · node srv1: MemoryPressure=True (KubeletHasInsufficientMemory)"
        )
    )]
    #[case::disk_pressure(
        "DiskPressure",
        "True",
        None,
        Some("node:srv1:DiskPressure · node srv1: DiskPressure=True ()")
    )]
    #[case::pid_unknown("PIDPressure", "Unknown", None, None)]
    fn conditions(
        #[case] kind: &str,
        #[case] status: &str,
        #[case] reason: Option<&str>,
        #[case] expected: Option<&str>,
    ) {
        let findings: Vec<String> = evaluate(&[node(kind, status, reason)])
            .into_iter()
            .map(|f| format!("{} · {}", f.key, f.message))
            .collect();
        assert_eq!(
            findings,
            expected.map(str::to_owned).into_iter().collect::<Vec<_>>()
        );
    }
}
