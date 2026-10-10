//! [`Notifier`] for `DRY_RUN`: one JSON line per message on stdout.
//!
//! JSON rather than plain text, so the output stays one event per line next
//! to the JSON logs (`kubectl logs | jq 'select(.dryRun)'`).

use std::io::Write;
use std::sync::{Mutex, PoisonError};

use async_trait::async_trait;
use serde::Serialize;

use crate::ports::{Notifier, NotifyError};

/// Generic over the writer so tests can capture the output in a `Vec<u8>`.
#[derive(Debug)]
pub struct StdoutNotifier<W> {
    out: Mutex<W>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Line<'a> {
    dry_run: bool,
    message: &'a str,
}

impl StdoutNotifier<std::io::Stdout> {
    pub fn stdout() -> Self {
        Self::new(std::io::stdout())
    }
}

impl<W> StdoutNotifier<W> {
    pub fn new(out: W) -> Self {
        Self {
            out: Mutex::new(out),
        }
    }

    pub fn into_inner(self) -> W {
        self.out
            .into_inner()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

#[async_trait]
impl<W: Write + Send> Notifier for StdoutNotifier<W> {
    async fn send(&self, text: &str) -> Result<(), NotifyError> {
        let line = serde_json::to_string(&Line {
            dry_run: true,
            message: text,
        })
        .map_err(std::io::Error::other)?;
        let mut out = self.out.lock().unwrap_or_else(PoisonError::into_inner);
        writeln!(out, "{line}")?;
        out.flush()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn writes_one_json_line_per_message() {
        let notifier = StdoutNotifier::new(Vec::new());
        notifier
            .send("🔴 outegro.dev: problem\n• disk")
            .await
            .expect("first");
        notifier.send("second").await.expect("second");
        let output = String::from_utf8(notifier.into_inner()).expect("utf8");
        let lines: Vec<serde_json::Value> = output
            .lines()
            .map(|line| serde_json::from_str(line).expect("json line"))
            .collect();
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0]["dryRun"], true);
        assert_eq!(lines[0]["message"], "🔴 outegro.dev: problem\n• disk");
        assert_eq!(lines[1]["message"], "second");
    }

    struct Broken;

    impl Write for Broken {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
            Err(std::io::Error::other("closed"))
        }

        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    #[tokio::test]
    async fn write_errors_are_reported() {
        let err = StdoutNotifier::new(Broken)
            .send("x")
            .await
            .expect_err("broken");
        assert!(matches!(err, NotifyError::Io(_)));
    }
}
