//! HTTP checks from `PROBES`.

use super::ProbeResult;
use crate::domain::Finding;

/// Anything but `200` → `http:<name> · <URL> answered <code or no response>`.
/// Redirects are not followed (like `curl` without `-L`), so a `301` counts.
pub fn evaluate(results: &[ProbeResult]) -> Vec<Finding> {
    results
        .iter()
        .filter_map(|result| {
            let answer = match &result.status {
                Ok(200) => return None,
                Ok(code) => code.to_string(),
                Err(_) => "no response".to_owned(),
            };
            Some(Finding::new(
                format!("http:{}", result.probe.name),
                format!("{} answered {answer}", result.probe.url),
            ))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use rstest::rstest;
    use url::Url;

    use super::*;
    use crate::domain::Probe;
    use crate::ports::SourceError;

    fn result(status: Result<u16, SourceError>) -> ProbeResult {
        ProbeResult {
            probe: Probe {
                name: "id".into(),
                url: Url::parse("https://id.outegro.dev/health").unwrap(),
            },
            status,
        }
    }

    #[rstest]
    #[case::ok(Ok(200), None)]
    #[case::no_content(Ok(204), Some("https://id.outegro.dev/health answered 204"))]
    #[case::redirect(Ok(301), Some("https://id.outegro.dev/health answered 301"))]
    #[case::bad_gateway(Ok(502), Some("https://id.outegro.dev/health answered 502"))]
    #[case::timeout(
        Err(SourceError::Deadline),
        Some("https://id.outegro.dev/health answered no response")
    )]
    fn status_codes(#[case] status: Result<u16, SourceError>, #[case] expected: Option<&str>) {
        let findings = evaluate(&[result(status)]);
        assert_eq!(
            findings
                .iter()
                .map(|f| f.message.as_str())
                .collect::<Vec<_>>(),
            expected.into_iter().collect::<Vec<_>>()
        );
        assert!(findings.iter().all(|f| f.key == "http:id"));
    }
}
