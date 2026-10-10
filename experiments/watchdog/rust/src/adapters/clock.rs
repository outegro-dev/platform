//! [`Clock`] backed by the system time.

use chrono::{DateTime, Utc};

use crate::ports::Clock;

#[derive(Debug, Clone, Copy, Default)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now(&self) -> DateTime<Utc> {
        Utc::now()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_close_to_utc_now() {
        let delta = (Utc::now() - SystemClock.now()).num_seconds().abs();
        assert!(delta < 5);
    }
}
