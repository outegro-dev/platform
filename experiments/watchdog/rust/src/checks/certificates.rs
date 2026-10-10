//! cert-manager certificates: ready and not close to expiry.

use chrono::{DateTime, Utc};

use crate::domain::{Certificate, Finding, find_condition};

/// Certificates expiring in fewer days than this are reported.
pub const EXPIRY_WARNING_DAYS: i64 = 14;

const SECS_PER_DAY: i64 = 86_400;

/// Whole days until `not_after`, rounded down (negative once expired), like
/// `jq '(... - now) / 86400 | floor'`.
pub fn days_left(not_after: DateTime<Utc>, now: DateTime<Utc>) -> i64 {
    (not_after - now).num_seconds().div_euclid(SECS_PER_DAY)
}

/// Not ready → `certificate <name> not ready: <message>`; otherwise fewer than
/// 14 days left → `certificate <name> expires in <D> days`.
pub fn evaluate(certs: &[Certificate], now: DateTime<Utc>) -> Vec<Finding> {
    certs.iter().filter_map(|cert| check(cert, now)).collect()
}

fn check(cert: &Certificate, now: DateTime<Utc>) -> Option<Finding> {
    let key = format!("cert:{}", cert.name);
    match find_condition(&cert.conditions, "Ready") {
        Some(ready) if ready.is_true() => {}
        ready => {
            let message = ready
                .and_then(|c| c.message.as_deref())
                .filter(|m| !m.is_empty())
                .unwrap_or("unknown");
            return Some(Finding::new(
                key,
                format!("certificate {} not ready: {message}", cert.name),
            ));
        }
    }
    // A ready certificate always has `notAfter`; without it there is nothing
    // to compare (the script would report an absurd negative number).
    let days = days_left(cert.not_after?, now);
    (days < EXPIRY_WARNING_DAYS).then(|| {
        Finding::new(
            key,
            format!("certificate {} expires in {days} days", cert.name),
        )
    })
}

/// The smallest number of days left among certificates that know `notAfter`.
pub fn min_days_left(certs: &[Certificate], now: DateTime<Utc>) -> Option<i64> {
    certs
        .iter()
        .filter_map(|cert| cert.not_after)
        .map(|not_after| days_left(not_after, now))
        .min()
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

    fn cert(ready: Option<(&str, Option<&str>)>, not_after: Option<Duration>) -> Certificate {
        Certificate {
            namespace: "outegro".into(),
            name: "outegro-dev-tls".into(),
            conditions: ready
                .map(|(status, message)| Condition {
                    kind: "Ready".into(),
                    status: status.into(),
                    message: message.map(str::to_owned),
                    ..Condition::default()
                })
                .into_iter()
                .collect(),
            not_after: not_after.map(|d| now() + d),
        }
    }

    fn messages(certs: &[Certificate]) -> Vec<String> {
        evaluate(certs, now())
            .into_iter()
            .map(|f| format!("{} · {}", f.key, f.message))
            .collect()
    }

    #[rstest]
    #[case::fifteen_days(Duration::days(15), None)]
    #[case::exactly_14_days(Duration::days(14), None)]
    #[case::one_second_short(Duration::days(14) - Duration::seconds(1), Some(13))]
    #[case::one_day(Duration::days(1), Some(1))]
    #[case::hours_left(Duration::hours(5), Some(0))]
    #[case::expired(Duration::hours(-5), Some(-1))]
    fn expiry_boundary(#[case] left: Duration, #[case] days: Option<i64>) {
        let expected: Vec<String> = days
            .map(|d| {
                format!("cert:outegro-dev-tls · certificate outegro-dev-tls expires in {d} days")
            })
            .into_iter()
            .collect();
        assert_eq!(
            messages(&[cert(Some(("True", None)), Some(left))]),
            expected
        );
    }

    #[rstest]
    #[case::not_ready_with_message(Some(("False", Some("Issuing certificate"))), "Issuing certificate")]
    #[case::not_ready_without_message(Some(("False", None)), "unknown")]
    #[case::not_ready_blank_message(Some(("Unknown", Some(""))), "unknown")]
    #[case::no_ready_condition(None, "unknown")]
    fn not_ready(#[case] ready: Option<(&str, Option<&str>)>, #[case] reason: &str) {
        // Not ready wins even when the certificate is also close to expiry.
        assert_eq!(
            messages(&[cert(ready, Some(Duration::days(2)))]),
            [format!(
                "cert:outegro-dev-tls · certificate outegro-dev-tls not ready: {reason}"
            )]
        );
    }

    #[test]
    fn ready_without_not_after_is_fine() {
        assert_eq!(
            messages(&[cert(Some(("True", None)), None)]),
            Vec::<String>::new()
        );
    }

    #[test]
    fn min_days_left_ignores_unknown_expiry() {
        let certs = [
            cert(Some(("True", None)), Some(Duration::days(60))),
            cert(
                Some(("True", None)),
                Some(Duration::days(20) + Duration::hours(3)),
            ),
            cert(Some(("False", None)), None),
        ];
        assert_eq!(min_days_left(&certs, now()), Some(20));
        assert_eq!(min_days_left(&[], now()), None);
    }
}
