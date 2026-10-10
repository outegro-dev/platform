//! Disk usage of the node, seen through a small local-path volume.

use crate::domain::Finding;

/// Usage at or above this percentage is reported.
pub const THRESHOLD_PERCENT: u8 = 80;

/// `disk · server disk <P>% used` when usage is at or above the threshold.
pub fn evaluate(percent: u8) -> Option<Finding> {
    (percent >= THRESHOLD_PERCENT)
        .then(|| Finding::new("disk", format!("server disk {percent}% used")))
}

/// Usage the way `df` prints it: `used / (used + available)`, rounded up.
///
/// `available` is what unprivileged users may still write (it excludes the
/// blocks reserved for root), which is why `df` does not use the total size.
/// Returns `None` for an empty filesystem.
pub fn percent_used(used: u64, available: u64) -> Option<u8> {
    let total = u128::from(used) + u128::from(available);
    if total == 0 {
        return None;
    }
    let percent = (u128::from(used) * 100).div_ceil(total);
    u8::try_from(percent).ok()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;

    use super::*;

    #[rstest]
    #[case::below(79, false)]
    #[case::exactly_80(80, true)]
    #[case::above(95, true)]
    fn threshold(#[case] percent: u8, #[case] fires: bool) {
        let finding = evaluate(percent);
        assert_eq!(finding.is_some(), fires);
        if let Some(f) = finding {
            assert_eq!(f.key, "disk");
            assert_eq!(f.message, format!("server disk {percent}% used"));
        }
    }

    #[rstest]
    #[case::exact(80, 20, Some(80))]
    #[case::rounds_up(791, 209, Some(80))]
    #[case::tiny_usage_is_one_percent(1, 999_999, Some(1))]
    #[case::empty_disk(0, 100, Some(0))]
    #[case::full(100, 0, Some(100))]
    #[case::no_blocks(0, 0, None)]
    #[case::huge_values(u64::MAX, u64::MAX, Some(50))]
    fn df_percentage(#[case] used: u64, #[case] available: u64, #[case] expected: Option<u8>) {
        assert_eq!(percent_used(used, available), expected);
    }
}
