//! Alerting state kept between passes and its JSON format (`state.json`).
//!
//! ```json
//! {
//!   "version": 1,
//!   "digestDay": "20261010",
//!   "entries": {
//!     "pod:outegro/api": { "since": 1760083200, "notified": 1760083200, "message": "..." }
//!   }
//! }
//! ```
//!
//! The same document as the Go implementation writes: either one can take
//! over the other's ConfigMap. `digestDay` is omitted until the first digest.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Current format version; anything else is treated as unreadable.
pub const STATE_VERSION: u32 = 1;

/// What the watchdog remembers about the previous passes.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct State {
    /// Known problems by finding key. A `BTreeMap` keeps keys sorted, which
    /// gives deterministic message lines and a stable JSON diff.
    pub findings: BTreeMap<String, Entry>,
    /// `YYYYMMDD` (UTC) of the last delivered daily digest.
    pub digest_day: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// Unix seconds when the problem was first seen.
    pub since: i64,
    /// Unix seconds of the last delivered alert or reminder; `0` = never.
    pub notified: i64,
    /// The last message of this finding (used for "recovered").
    pub message: String,
}

/// The on-disk shape. Kept separate from [`State`] so the format can evolve
/// (a `version` field, camelCase names) without leaking into the core.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DocumentRef<'a> {
    version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    digest_day: Option<&'a str>,
    #[serde(rename = "entries")]
    findings: &'a BTreeMap<String, Entry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Document {
    #[serde(default)]
    digest_day: Option<String>,
    #[serde(default, rename = "entries")]
    findings: BTreeMap<String, Entry>,
}

#[derive(Deserialize)]
struct Versioned {
    version: u32,
}

#[derive(Debug, Error)]
pub enum DecodeError {
    #[error("invalid state JSON")]
    Json(#[from] serde_json::Error),
    #[error("unsupported state version {found} (expected {STATE_VERSION})")]
    Version { found: u32 },
}

/// Serializes the state as pretty JSON (readable in `kubectl get cm -o yaml`).
pub fn encode(state: &State) -> Result<String, serde_json::Error> {
    serde_json::to_string_pretty(&DocumentRef {
        version: STATE_VERSION,
        digest_day: state.digest_day.as_deref(),
        findings: &state.findings,
    })
}

/// Parses `state.json`, rejecting other versions before looking at the body.
pub fn decode(json: &str) -> Result<State, DecodeError> {
    let Versioned { version } = serde_json::from_str(json)?;
    if version != STATE_VERSION {
        return Err(DecodeError::Version { found: version });
    }
    let doc: Document = serde_json::from_str(json)?;
    Ok(State {
        findings: doc.findings,
        digest_day: doc.digest_day,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> State {
        State {
            findings: BTreeMap::from([(
                "disk".to_owned(),
                Entry {
                    since: 100,
                    notified: 0,
                    message: "server disk 91% used".to_owned(),
                },
            )]),
            digest_day: Some("20261010".to_owned()),
        }
    }

    #[test]
    fn round_trips() {
        let state = sample();
        let json = encode(&state).expect("encode");
        assert_eq!(decode(&json).expect("decode"), state);
    }

    #[test]
    fn writes_version_and_camel_case() {
        let json = encode(&sample()).expect("encode");
        let value: serde_json::Value = serde_json::from_str(&json).expect("json");
        assert_eq!(value["version"], 1);
        assert_eq!(value["digestDay"], "20261010");
        assert_eq!(value["entries"]["disk"]["since"], 100);
    }

    #[test]
    fn empty_state_omits_digest_day() {
        let json = encode(&State::default()).expect("encode");
        let value: serde_json::Value = serde_json::from_str(&json).expect("json");
        assert!(value.get("digestDay").is_none());
        assert_eq!(decode(&json).expect("decode"), State::default());
    }

    #[test]
    fn rejects_other_versions() {
        let err = decode(r#"{"version":2,"entries":{}}"#).expect_err("version 2");
        assert!(matches!(err, DecodeError::Version { found: 2 }));
    }

    #[test]
    fn rejects_garbage_and_missing_version() {
        assert!(matches!(decode("not json"), Err(DecodeError::Json(_))));
        assert!(matches!(
            decode(r#"{"entries":{}}"#),
            Err(DecodeError::Json(_))
        ));
    }

    #[test]
    fn reads_the_go_implementation_state() {
        // Written by go/internal/domain/state.go.
        let json = r#"{"version":1,"digestDay":"20261010","entries":{"disk":{"since":100,"notified":200,"message":"server disk 85% used"}}}"#;
        let state = decode(json).expect("decode");
        assert_eq!(state.digest_day.as_deref(), Some("20261010"));
        assert_eq!(state.findings["disk"].notified, 200);
    }
}
