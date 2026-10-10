//! Structured JSON logs (`tracing` + `tracing-subscriber`) and error chains.

use std::error::Error;
use std::fmt;

use tracing_subscriber::EnvFilter;

/// Installs the global JSON logger on stdout. `filter` is a level (`info`) or
/// `EnvFilter` directives (`info,watchdog=debug`); it was validated by the
/// configuration, `info` is the fallback.
///
/// One line per event: `{"timestamp":…,"level":"INFO","message":…,<fields>,"target":…}`.
pub fn init(filter: &str) {
    let filter = EnvFilter::try_new(filter).unwrap_or_else(|_| EnvFilter::new("info"));
    // `try_init` fails only if a logger is already installed (tests); the
    // existing one is fine then.
    let _ = tracing_subscriber::fmt()
        .json()
        .flatten_event(true)
        .with_current_span(false)
        .with_span_list(false)
        .with_env_filter(filter)
        .with_writer(std::io::stdout)
        .try_init();
}

/// Displays an error with all its sources: `outer: inner: root cause`.
///
/// `thiserror` messages do not repeat their `#[source]`, so logging only
/// `{err}` would lose the cause; this walks `Error::source()` instead. Some
/// library errors already include their cause in the message; a cause that
/// the previous message ends with is not printed twice.
#[derive(Debug, Clone, Copy)]
pub struct Chain<'a>(pub &'a (dyn Error + 'static));

impl fmt::Display for Chain<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut previous = self.0.to_string();
        f.write_str(&previous)?;
        let mut source = self.0.source();
        while let Some(cause) = source {
            let message = cause.to_string();
            if !previous.ends_with(&message) {
                write!(f, ": {message}")?;
            }
            previous = message;
            source = cause.source();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ports::SourceError;

    #[test]
    fn chain_prints_every_cause() {
        let io = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "connection refused");
        let err = SourceError::Request(Box::new(io));
        assert_eq!(
            Chain(&err).to_string(),
            "request failed: connection refused"
        );
        assert_eq!(
            Chain(&SourceError::Deadline).to_string(),
            "deadline exceeded"
        );
    }

    /// An error whose message already contains its source, like many
    /// library errors do.
    #[derive(Debug, thiserror::Error)]
    #[error("cannot read kubeconfig: {0}")]
    struct Verbose(#[source] std::io::Error);

    #[test]
    fn chain_does_not_repeat_a_cause_already_in_the_message() {
        let err = SourceError::Request(Box::new(Verbose(std::io::Error::other("no such file"))));
        assert_eq!(
            Chain(&err).to_string(),
            "request failed: cannot read kubeconfig: no such file"
        );
    }

    #[test]
    fn init_twice_does_not_panic() {
        // "off" keeps the test output clean; the second call is a no-op.
        init("off");
        init("not a [valid filter");
    }
}
