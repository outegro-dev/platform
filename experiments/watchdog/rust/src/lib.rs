//! outegro.dev watchdog: one pass of cluster checks with Telegram alerts.
//!
//! Ports and adapters:
//! - [`domain`], [`state`]: plain data.
//! - [`checks`], [`alerting`]: the pure core, `(data, now) → findings` and
//!   `plan(previous state, findings, facts, now) → messages + next state`.
//! - [`ports`]: traits for everything with side effects.
//! - [`adapters`]: Kubernetes, HTTP, Prometheus, statvfs, ConfigMap,
//!   Telegram, stdout.
//! - [`run`]: one pass, wiring the core to the ports with deadlines.
//! - [`config`], [`telemetry`]: environment and logs for the binary.
#![forbid(unsafe_code)]

pub mod adapters;
pub mod alerting;
pub mod checks;
pub mod config;
pub mod domain;
pub mod ports;
pub mod run;
pub mod state;
pub mod telemetry;

#[cfg(test)]
mod test_support;
