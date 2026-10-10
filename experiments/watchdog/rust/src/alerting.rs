//! The alerting state machine, as pure functions.
//!
//! [`plan`] compares the findings of this pass with the previous state and
//! returns the messages to send plus everything needed to compute the next
//! state. [`Plan::apply`] then takes the delivery results: `notified`,
//! `digestDay` and "recovered" only change for messages Telegram accepted, so a
//! failed send is retried by the next pass.

use std::collections::BTreeMap;
use std::fmt::Display;

use chrono::{DateTime, Timelike, Utc};

use crate::domain::{Facts, Finding};
use crate::state::{Entry, State};

/// Reminders for a still failing problem are sent this often.
pub const REMIND_AFTER_SECS: i64 = 6 * 3600;
/// The daily digest is sent on the first pass at or after this UTC hour.
pub const DIGEST_HOUR_UTC: u32 = 7;

pub const GREETING: &str = "👋 outegro.dev watchdog is on duty: pods, nodes, disk, certificates, backups, Argo CD and health checks every 5 minutes.";
pub const PROBLEM_HEADER: &str = "🔴 outegro.dev: problem";
pub const STILL_FAILING_HEADER: &str = "🟠 outegro.dev: still failing";
pub const RECOVERED_HEADER: &str = "🟢 outegro.dev: recovered";
pub const DIGEST_HEADER: &str = "☀️ outegro.dev daily:";

/// How long a finding must persist before it is reported, by key prefix.
/// Deploys make Argo CD and HTTP checks flap for a few minutes.
pub fn grace_secs(key: &str) -> i64 {
    match key {
        "prom:api" => 900,
        k if k.starts_with("argo:") => 900,
        k if k.starts_with("http:") => 240,
        _ => 0,
    }
}

/// The kinds of messages, in sending order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum MessageKind {
    Greeting,
    Problem,
    StillFailing,
    Recovered,
    Digest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Message {
    pub kind: MessageKind,
    pub text: String,
}

/// What to send now and how the state changes depending on delivery.
#[derive(Debug, Clone, PartialEq, Eq)]
#[must_use = "a plan does nothing until its messages are sent and `apply` is called"]
pub struct Plan {
    /// Messages in sending order (at most one per kind).
    pub messages: Vec<Message>,
    /// The next state if nothing is delivered.
    undelivered: State,
    problem_keys: Vec<String>,
    reminder_keys: Vec<String>,
    recovered: BTreeMap<String, Entry>,
    today: String,
    now: i64,
}

/// Decides what to send. `previous` is `None` on the first run.
pub fn plan(
    previous: Option<&State>,
    findings: &[Finding],
    facts: &Facts,
    now: DateTime<Utc>,
) -> Plan {
    let ts = now.timestamp();
    let empty = State::default();
    let prev = previous.unwrap_or(&empty);

    // First finding per key wins; iteration is in key order.
    let mut current: BTreeMap<&str, &Finding> = BTreeMap::new();
    for finding in findings {
        current.entry(finding.key.as_str()).or_insert(finding);
    }

    let mut next = State {
        findings: BTreeMap::new(),
        digest_day: prev.digest_day.clone(),
    };
    let mut problems = Vec::new();
    let mut reminders = Vec::new();
    for (&key, finding) in &current {
        let (since, notified) = prev
            .findings
            .get(key)
            .map_or((ts, 0), |entry| (entry.since, entry.notified));
        if ts - since >= grace_secs(key) {
            if notified == 0 {
                problems.push(*finding);
            } else if ts - notified >= REMIND_AFTER_SECS {
                reminders.push(*finding);
            }
        }
        next.findings.insert(
            key.to_owned(),
            Entry {
                since,
                notified,
                message: finding.message.clone(),
            },
        );
    }

    // Gone and reported → recovered. Gone before the grace ran out → silent.
    let recovered: BTreeMap<String, Entry> = prev
        .findings
        .iter()
        .filter(|(key, entry)| entry.notified != 0 && !current.contains_key(key.as_str()))
        .map(|(key, entry)| (key.clone(), entry.clone()))
        .collect();

    let mut messages = Vec::new();
    if previous.is_none() {
        messages.push(Message {
            kind: MessageKind::Greeting,
            text: GREETING.to_owned(),
        });
    }
    if !problems.is_empty() {
        messages.push(Message {
            kind: MessageKind::Problem,
            text: bulleted(PROBLEM_HEADER, problems.iter().map(|f| f.message.as_str())),
        });
    }
    if !reminders.is_empty() {
        messages.push(Message {
            kind: MessageKind::StillFailing,
            text: bulleted(
                STILL_FAILING_HEADER,
                reminders.iter().map(|f| f.message.as_str()),
            ),
        });
    }
    if !recovered.is_empty() {
        messages.push(Message {
            kind: MessageKind::Recovered,
            text: bulleted(
                RECOVERED_HEADER,
                recovered.values().map(|e| e.message.as_str()),
            ),
        });
    }
    let today = now.format("%Y%m%d").to_string();
    if now.hour() >= DIGEST_HOUR_UTC && prev.digest_day.as_deref() != Some(today.as_str()) {
        messages.push(Message {
            kind: MessageKind::Digest,
            text: digest(current.len(), facts),
        });
    }

    Plan {
        messages,
        undelivered: next,
        problem_keys: problems.iter().map(|f| f.key.clone()).collect(),
        reminder_keys: reminders.iter().map(|f| f.key.clone()).collect(),
        recovered,
        today,
        now: ts,
    }
}

impl Plan {
    /// The next state, given which messages were delivered.
    pub fn apply(self, delivered: &[MessageKind]) -> State {
        let Self {
            mut undelivered,
            problem_keys,
            reminder_keys,
            recovered,
            today,
            now,
            ..
        } = self;
        let was_delivered = |kind| delivered.contains(&kind);

        if was_delivered(MessageKind::Problem) {
            mark_notified(&mut undelivered, &problem_keys, now);
        }
        if was_delivered(MessageKind::StillFailing) {
            mark_notified(&mut undelivered, &reminder_keys, now);
        }
        if !was_delivered(MessageKind::Recovered) {
            // Keep them, so the next pass reports the recovery again. If the
            // problem comes back first, it simply continues as before.
            undelivered.findings.extend(recovered);
        }
        if was_delivered(MessageKind::Digest) {
            undelivered.digest_day = Some(today);
        }
        undelivered
    }
}

fn mark_notified(state: &mut State, keys: &[String], now: i64) {
    for key in keys {
        if let Some(entry) = state.findings.get_mut(key) {
            entry.notified = now;
        }
    }
}

/// `header` followed by `• line` rows.
fn bulleted<'a>(header: &str, lines: impl Iterator<Item = &'a str>) -> String {
    lines.fold(header.to_owned(), |mut text, line| {
        text.push_str("\n• ");
        text.push_str(line);
        text
    })
}

fn digest(failing: usize, facts: &Facts) -> String {
    let status = if failing == 0 {
        "All checks pass.".to_owned()
    } else {
        format!("Failing checks: {failing}.")
    };
    format!(
        "{DIGEST_HEADER} {status}\nPods running: {}\nLast backup: {} h ago\nCertificate: {} days left\nDisk: {}% used",
        or_unknown(facts.pods_running),
        or_unknown(facts.backup_age_hours),
        or_unknown(facts.certificate_days_left),
        or_unknown(facts.disk_percent),
    )
}

fn or_unknown<T: Display>(value: Option<T>) -> String {
    value.map_or_else(|| "?".to_owned(), |v| v.to_string())
}

#[cfg(test)]
mod tests {
    use chrono::{Duration, TimeZone};
    use rstest::rstest;

    use super::*;

    /// 06:00 UTC: before the digest hour, so digests stay out of the way.
    fn early() -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 10, 6, 0, 0).unwrap()
    }

    fn state(entries: &[(&str, i64, i64, &str)], digest_day: Option<&str>) -> State {
        State {
            findings: entries
                .iter()
                .map(|(key, since, notified, message)| {
                    (
                        (*key).to_owned(),
                        Entry {
                            since: *since,
                            notified: *notified,
                            message: (*message).to_owned(),
                        },
                    )
                })
                .collect(),
            digest_day: digest_day.map(str::to_owned),
        }
    }

    fn kinds(plan: &Plan) -> Vec<MessageKind> {
        plan.messages.iter().map(|m| m.kind).collect()
    }

    fn all_delivered(plan: Plan) -> State {
        let delivered = kinds(&plan);
        plan.apply(&delivered)
    }

    #[test]
    fn first_run_greets_and_reports() {
        let now = early();
        let findings = [Finding::new("disk", "server disk 91% used")];
        let plan = plan(None, &findings, &Facts::default(), now);
        assert_eq!(
            plan.messages,
            [
                Message {
                    kind: MessageKind::Greeting,
                    text: GREETING.to_owned()
                },
                Message {
                    kind: MessageKind::Problem,
                    text: "🔴 outegro.dev: problem\n• server disk 91% used".to_owned()
                },
            ]
        );
        let ts = now.timestamp();
        assert_eq!(
            all_delivered(plan),
            state(&[("disk", ts, ts, "server disk 91% used")], None)
        );
    }

    #[test]
    fn empty_state_is_not_a_first_run() {
        let plan = plan(Some(&State::default()), &[], &Facts::default(), early());
        assert_eq!(plan.messages, []);
    }

    #[rstest]
    #[case::argo_waits("argo:landing", 899, false)]
    #[case::argo_after_grace("argo:landing", 900, true)]
    #[case::http_waits("http:id", 239, false)]
    #[case::http_after_grace("http:id", 240, true)]
    #[case::prom_api_waits("prom:api", 899, false)]
    #[case::prom_api_after_grace("prom:api", 900, true)]
    #[case::prom_alert_named_api_has_no_grace("prom:api:outegro", 0, true)]
    #[case::pods_immediately("pod:outegro/api", 0, true)]
    fn grace_by_prefix(#[case] key: &str, #[case] age: i64, #[case] reported: bool) {
        let now = early();
        let since = now.timestamp() - age;
        let previous = state(&[(key, since, 0, "msg")], None);
        let plan = plan(
            Some(&previous),
            &[Finding::new(key, "msg")],
            &Facts::default(),
            now,
        );
        assert_eq!(
            kinds(&plan) == [MessageKind::Problem],
            reported,
            "{key} after {age}s"
        );
        let next = all_delivered(plan);
        let entry = &next.findings[key];
        assert_eq!(entry.since, since, "since is kept while failing");
        assert_eq!(entry.notified, if reported { now.timestamp() } else { 0 });
    }

    #[test]
    fn grace_values() {
        assert_eq!(grace_secs("argo:x"), 900);
        assert_eq!(grace_secs("http:x"), 240);
        assert_eq!(grace_secs("prom:api"), 900);
        assert_eq!(grace_secs("prom:Foo:bar"), 0);
        assert_eq!(grace_secs("cert:x"), 0);
    }

    #[rstest]
    #[case::too_early(REMIND_AFTER_SECS - 1, false)]
    #[case::exactly_six_hours(REMIND_AFTER_SECS, true)]
    #[case::much_later(REMIND_AFTER_SECS * 3, true)]
    fn reminder_every_six_hours(#[case] since_notified: i64, #[case] reminded: bool) {
        let now = early();
        let notified = now.timestamp() - since_notified;
        let previous = state(
            &[("disk", notified - 60, notified, "server disk 85% used")],
            None,
        );
        let findings = [Finding::new("disk", "server disk 90% used")];
        let plan = plan(Some(&previous), &findings, &Facts::default(), now);
        if reminded {
            assert_eq!(
                plan.messages,
                [Message {
                    kind: MessageKind::StillFailing,
                    text: "🟠 outegro.dev: still failing\n• server disk 90% used".to_owned()
                }]
            );
        } else {
            assert_eq!(plan.messages, []);
        }
        let next = all_delivered(plan);
        assert_eq!(
            next.findings["disk"].notified,
            if reminded { now.timestamp() } else { notified }
        );
        assert_eq!(next.findings["disk"].message, "server disk 90% used");
    }

    #[test]
    fn recovery_only_for_reported_problems() {
        let now = early();
        let ts = now.timestamp();
        let previous = state(
            &[
                (
                    "pod:outegro/api",
                    ts - 600,
                    ts - 600,
                    "outegro/api-1: CrashLoopBackOff",
                ),
                (
                    "http:id",
                    ts - 120,
                    0,
                    "https://id.outegro.dev/health answered 502",
                ),
            ],
            Some("20261009"),
        );
        let plan = plan(Some(&previous), &[], &Facts::default(), now);
        assert_eq!(
            plan.messages,
            [Message {
                kind: MessageKind::Recovered,
                text: "🟢 outegro.dev: recovered\n• outegro/api-1: CrashLoopBackOff".to_owned()
            }]
        );
        // The unreported http flap disappears silently; the recovered entry is gone.
        assert_eq!(all_delivered(plan), state(&[], Some("20261009")));
    }

    #[rstest]
    #[case::before_seven(6, 59, None, false)]
    #[case::at_seven(7, 0, None, true)]
    #[case::evening(22, 0, Some("20261009"), true)]
    #[case::already_sent_today(9, 0, Some("20261010"), false)]
    fn digest_once_a_day_after_seven(
        #[case] hour: u32,
        #[case] minute: u32,
        #[case] last: Option<&str>,
        #[case] sent: bool,
    ) {
        let now = Utc.with_ymd_and_hms(2026, 10, 10, hour, minute, 0).unwrap();
        let previous = state(&[], last);
        let plan = plan(Some(&previous), &[], &Facts::default(), now);
        assert_eq!(kinds(&plan) == [MessageKind::Digest], sent);
        let next = all_delivered(plan);
        let expected = if sent { Some("20261010") } else { last };
        assert_eq!(next.digest_day.as_deref(), expected);
    }

    #[test]
    fn digest_text_with_facts_and_failures() {
        let now = Utc.with_ymd_and_hms(2026, 10, 10, 7, 5, 0).unwrap();
        let facts = Facts {
            pods_running: Some(42),
            backup_age_hours: Some(5),
            certificate_days_left: Some(61),
            disk_percent: Some(47),
        };
        let findings = [
            Finding::new("http:id", "https://id.outegro.dev/health answered 502"),
            Finding::new("argo:landing", "Argo CD landing: OutOfSync / Healthy"),
        ];
        let previous = state(&[], Some("20261009"));
        let plan = plan(Some(&previous), &findings, &facts, now);
        let digest = plan.messages.last().expect("digest");
        assert_eq!(digest.kind, MessageKind::Digest);
        assert_eq!(
            digest.text,
            "☀️ outegro.dev daily: Failing checks: 2.\nPods running: 42\nLast backup: 5 h ago\nCertificate: 61 days left\nDisk: 47% used"
        );
    }

    #[test]
    fn digest_text_with_unknown_facts() {
        let now = Utc.with_ymd_and_hms(2026, 10, 10, 7, 5, 0).unwrap();
        let plan = plan(Some(&State::default()), &[], &Facts::default(), now);
        assert_eq!(
            plan.messages[0].text,
            "☀️ outegro.dev daily: All checks pass.\nPods running: ?\nLast backup: ? h ago\nCertificate: ? days left\nDisk: ?% used"
        );
    }

    #[test]
    fn failed_sends_change_nothing_and_are_retried() {
        let now = Utc.with_ymd_and_hms(2026, 10, 10, 8, 0, 0).unwrap();
        let ts = now.timestamp();
        let previous = state(
            &[
                (
                    "disk",
                    ts - REMIND_AFTER_SECS - 10,
                    ts - REMIND_AFTER_SECS,
                    "server disk 90% used",
                ),
                (
                    "cert:old",
                    ts - 999,
                    ts - 999,
                    "certificate old expires in 3 days",
                ),
            ],
            Some("20261009"),
        );
        let findings = [
            Finding::new("disk", "server disk 90% used"),
            Finding::new("node:srv1:Ready", "node srv1: Ready=False ()"),
        ];
        let first = plan(Some(&previous), &findings, &Facts::default(), now);
        assert_eq!(
            kinds(&first),
            [
                MessageKind::Problem,
                MessageKind::StillFailing,
                MessageKind::Recovered,
                MessageKind::Digest
            ]
        );
        let messages = first.messages.clone();

        // Telegram is down: nothing is delivered.
        let next = first.apply(&[]);
        assert_eq!(next.findings["node:srv1:Ready"].notified, 0);
        assert_eq!(next.findings["disk"].notified, ts - REMIND_AFTER_SECS);
        assert!(
            next.findings.contains_key("cert:old"),
            "recovery kept for retry"
        );
        assert_eq!(next.digest_day.as_deref(), Some("20261009"));

        // Five minutes later the same messages are planned again.
        let later = now + Duration::minutes(5);
        let retry = plan(Some(&next), &findings, &Facts::default(), later);
        assert_eq!(retry.messages, messages);
        let delivered = all_delivered(retry);
        assert_eq!(
            delivered.findings["node:srv1:Ready"].notified,
            later.timestamp()
        );
        assert!(!delivered.findings.contains_key("cert:old"));
        assert_eq!(delivered.digest_day.as_deref(), Some("20261010"));
    }

    #[test]
    fn partial_delivery_only_updates_delivered_kinds() {
        let now = early();
        let ts = now.timestamp();
        let previous = state(
            &[("cert:old", ts - 999, ts - 999, "certificate old ok")],
            None,
        );
        let findings = [Finding::new("disk", "server disk 91% used")];
        let plan = plan(Some(&previous), &findings, &Facts::default(), now);
        let next = plan.apply(&[MessageKind::Recovered]);
        assert_eq!(next.findings["disk"].notified, 0, "problem not delivered");
        assert!(
            !next.findings.contains_key("cert:old"),
            "recovery delivered"
        );
    }

    #[test]
    fn duplicate_keys_keep_first_message_once() {
        let findings = [
            Finding::new("pod:outegro/api", "outegro/api-1: CrashLoopBackOff"),
            Finding::new("pod:outegro/api", "outegro/api-2: CrashLoopBackOff"),
        ];
        let plan = plan(
            Some(&State::default()),
            &findings,
            &Facts::default(),
            early(),
        );
        assert_eq!(
            plan.messages[0].text,
            "🔴 outegro.dev: problem\n• outegro/api-1: CrashLoopBackOff"
        );
        let next = all_delivered(plan);
        assert_eq!(next.findings.len(), 1);
        assert_eq!(
            next.findings["pod:outegro/api"].message,
            "outegro/api-1: CrashLoopBackOff"
        );
    }

    #[test]
    fn lines_are_sorted_by_key_and_kinds_keep_order() {
        let now = early();
        let ts = now.timestamp();
        let previous = state(&[("b:old", ts - 60, ts - 60, "b recovered")], None);
        let findings = [Finding::new("z:new", "z"), Finding::new("a:new", "a")];
        let plan = plan(Some(&previous), &findings, &Facts::default(), now);
        assert_eq!(
            plan.messages
                .iter()
                .map(|m| m.text.as_str())
                .collect::<Vec<_>>(),
            [
                "🔴 outegro.dev: problem\n• a\n• z",
                "🟢 outegro.dev: recovered\n• b recovered"
            ]
        );
    }

    #[test]
    fn unchanged_second_pass_sends_nothing() {
        let now = Utc.with_ymd_and_hms(2026, 10, 10, 8, 0, 0).unwrap();
        let findings = [Finding::new("disk", "server disk 91% used")];
        let first = all_delivered(plan(None, &findings, &Facts::default(), now));
        let second = plan(
            Some(&first),
            &findings,
            &Facts::default(),
            now + Duration::minutes(5),
        );
        assert_eq!(second.messages, []);
        assert_eq!(all_delivered(second), first);
    }
}
