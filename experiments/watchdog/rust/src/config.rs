//! Configuration: environment variables (the same names work as flags).
//!
//! Two steps, like `@nestjs/config` + a Zod schema:
//! 1. [`Cli`] (clap derive) gathers raw values from flags, env and defaults.
//! 2. [`Config::try_from`] validates them into typed values and cross-field
//!    rules. Every error names the variable; the bot token is never echoed.

use std::collections::BTreeSet;
use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;
use std::time::Duration;

use clap::Parser;
use clap::builder::BoolishValueParser;
use thiserror::Error;
use tracing_subscriber::EnvFilter;
use url::Url;

use crate::domain::Probe;

/// The eleven HTTP checks of the shell script.
pub const DEFAULT_PROBES: &str = "landing=https://outegro.dev/,\
id=https://id.outegro.dev/health,\
auth=http://auth-backend.outegro.svc:4001/health/deep,\
notifications=http://notifications-backend.outegro.svc:4002/health/deep,\
payments=http://payments-backend.outegro.svc:4003/health/deep,\
battleship-backend=http://battleship-backend.outegro.svc:4004/health/deep,\
battleship=https://battleship.outegro.dev/health,\
edu-backend=http://edu-backend.outegro.svc:4005/health/deep,\
edu=https://edu.outegro.dev/health,\
pay=https://pay.outegro.dev/health,\
admin=https://admin.outegro.dev/health";

pub const DEFAULT_WATCHED_NAMESPACES: &str =
    "outegro,agents,argocd,cert-manager,cnpg-system,kube-system";

/// Raw settings as clap reads them. Only parsing happens here; validation is
/// in [`Config::try_from`].
#[derive(Debug, Clone, Parser)]
#[command(
    name = "watchdog",
    version,
    about = "One pass of outegro.dev cluster checks with Telegram alerts"
)]
pub struct Cli {
    /// Namespace of the PostgreSQL cluster, its backups and the state ConfigMap.
    #[arg(long, env = "NAMESPACE", default_value = "outegro")]
    pub namespace: String,

    /// Comma-separated namespaces whose pods are checked.
    #[arg(long, env = "WATCHED_NAMESPACES", default_value = DEFAULT_WATCHED_NAMESPACES)]
    pub watched_namespaces: String,

    /// Name of the ConfigMap that keeps the alerting state.
    #[arg(long, env = "STATE_CONFIGMAP", default_value = "watchdog-state-v2")]
    pub state_configmap: String,

    /// Prometheus base URL (alerts are read from /api/v1/alerts).
    #[arg(
        long,
        env = "PROMETHEUS_URL",
        default_value = "http://monitoring-prometheus.monitoring.svc:9090"
    )]
    pub prometheus_url: String,

    /// Comma-separated HTTP checks, `name=URL`.
    #[arg(long, env = "PROBES", default_value = DEFAULT_PROBES, hide_default_value = true)]
    pub probes: String,

    /// Path whose filesystem usage is checked (statvfs).
    #[arg(long, env = "DISK_PATH", default_value = "/probe")]
    pub disk_path: PathBuf,

    /// Telegram bot token; required unless this is a dry run.
    #[arg(long, env = "TELEGRAM_BOT_TOKEN", hide_env_values = true)]
    pub telegram_bot_token: Option<Secret>,

    /// Telegram chat id; required unless this is a dry run.
    #[arg(long, env = "TELEGRAM_CHAT_ID", hide_env_values = true)]
    pub telegram_chat_id: Option<String>,

    /// Telegram Bot API base URL (overridden in tests).
    #[arg(
        long,
        env = "TELEGRAM_API_URL",
        default_value = "https://api.telegram.org"
    )]
    pub telegram_api_url: String,

    /// Print messages to stdout and do not write the state.
    #[arg(
        long,
        env = "DRY_RUN",
        default_value = "false",
        value_parser = BoolishValueParser::new(),
        action = clap::ArgAction::Set
    )]
    pub dry_run: bool,

    /// Deadline for all checks of one pass (e.g. 120s, 2m).
    #[arg(long, env = "RUN_TIMEOUT", default_value = "120s")]
    pub run_timeout: String,

    /// Timeout of one HTTP check and of the Prometheus request.
    #[arg(long, env = "HTTP_TIMEOUT", default_value = "10s")]
    pub http_timeout: String,

    /// Log filter: a level (info, debug) or EnvFilter directives.
    #[arg(long, env = "LOG_LEVEL", default_value = "info")]
    pub log_level: String,
}

/// A string that must not be printed: `Debug` shows `Secret(***)` and there
/// is no `Display`, so it cannot end up in a log line or an error by accident.
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The raw value, for the one place that needs it (the Telegram URL).
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

impl FromStr for Secret {
    type Err = std::convert::Infallible;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        Ok(Self::new(s))
    }
}

/// Where messages go. An enum instead of `dry_run: bool` + optional token:
/// "send to Telegram without a token" cannot be represented.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Delivery {
    /// `DRY_RUN=true`: print to stdout, keep the state untouched.
    DryRun,
    Telegram(TelegramConfig),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TelegramConfig {
    pub api_url: Url,
    pub token: Secret,
    pub chat_id: String,
}

/// Validated configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub namespace: String,
    pub watched_namespaces: Vec<String>,
    pub state_configmap: String,
    pub prometheus_url: Url,
    pub probes: Vec<Probe>,
    pub disk_path: PathBuf,
    pub delivery: Delivery,
    pub run_timeout: Duration,
    pub http_timeout: Duration,
    pub log_filter: String,
}

impl Config {
    pub fn dry_run(&self) -> bool {
        matches!(self.delivery, Delivery::DryRun)
    }
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("{var} must not be empty")]
    Empty { var: &'static str },
    #[error("{var}: invalid URL {value:?}")]
    Url {
        var: &'static str,
        value: String,
        #[source]
        source: url::ParseError,
    },
    #[error("{var}: URL must use http or https: {value:?}")]
    Scheme { var: &'static str, value: String },
    #[error("{var}: invalid duration {value:?} (examples: 10s, 2m, 1m30s)")]
    Duration {
        var: &'static str,
        value: String,
        #[source]
        source: humantime::DurationError,
    },
    #[error("{var} must be greater than zero")]
    ZeroDuration { var: &'static str },
    #[error("PROBES: entry {entry:?} must look like name=URL")]
    ProbeFormat { entry: String },
    #[error("PROBES: duplicate name {name:?}")]
    DuplicateProbe { name: String },
    #[error("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required unless DRY_RUN=true")]
    MissingTelegram,
    #[error("LOG_LEVEL: invalid filter {value:?}")]
    LogLevel {
        value: String,
        #[source]
        source: tracing_subscriber::filter::ParseError,
    },
}

impl TryFrom<Cli> for Config {
    type Error = ConfigError;

    fn try_from(cli: Cli) -> Result<Self, Self::Error> {
        let delivery = if cli.dry_run {
            Delivery::DryRun
        } else {
            let token = cli
                .telegram_bot_token
                .filter(|t| !t.expose().trim().is_empty());
            let chat_id = cli.telegram_chat_id.filter(|c| !c.trim().is_empty());
            let (Some(token), Some(chat_id)) = (token, chat_id) else {
                return Err(ConfigError::MissingTelegram);
            };
            Delivery::Telegram(TelegramConfig {
                api_url: http_url("TELEGRAM_API_URL", &cli.telegram_api_url)?,
                token,
                chat_id,
            })
        };

        Ok(Self {
            namespace: non_blank("NAMESPACE", cli.namespace)?,
            watched_namespaces: namespaces(&cli.watched_namespaces)?,
            state_configmap: non_blank("STATE_CONFIGMAP", cli.state_configmap)?,
            prometheus_url: http_url("PROMETHEUS_URL", &cli.prometheus_url)?,
            probes: parse_probes(&cli.probes)?,
            disk_path: cli.disk_path,
            delivery,
            run_timeout: duration("RUN_TIMEOUT", &cli.run_timeout)?,
            http_timeout: duration("HTTP_TIMEOUT", &cli.http_timeout)?,
            log_filter: log_filter(cli.log_level)?,
        })
    }
}

fn non_blank(var: &'static str, value: String) -> Result<String, ConfigError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        Err(ConfigError::Empty { var })
    } else if trimmed.len() == value.len() {
        Ok(value)
    } else {
        Ok(trimmed.to_owned())
    }
}

fn namespaces(raw: &str) -> Result<Vec<String>, ConfigError> {
    let list: Vec<String> = raw
        .split(',')
        .map(str::trim)
        .filter(|ns| !ns.is_empty())
        .map(str::to_owned)
        .collect();
    if list.is_empty() {
        Err(ConfigError::Empty {
            var: "WATCHED_NAMESPACES",
        })
    } else {
        Ok(list)
    }
}

fn http_url(var: &'static str, value: &str) -> Result<Url, ConfigError> {
    let url = Url::parse(value.trim()).map_err(|source| ConfigError::Url {
        var,
        value: value.to_owned(),
        source,
    })?;
    match url.scheme() {
        "http" | "https" => Ok(url),
        _ => Err(ConfigError::Scheme {
            var,
            value: value.to_owned(),
        }),
    }
}

fn duration(var: &'static str, value: &str) -> Result<Duration, ConfigError> {
    let parsed =
        humantime::parse_duration(value.trim()).map_err(|source| ConfigError::Duration {
            var,
            value: value.to_owned(),
            source,
        })?;
    if parsed.is_zero() {
        Err(ConfigError::ZeroDuration { var })
    } else {
        Ok(parsed)
    }
}

/// `name=URL,name=URL`; names must be unique (they become finding keys).
pub fn parse_probes(raw: &str) -> Result<Vec<Probe>, ConfigError> {
    let mut seen = BTreeSet::new();
    raw.split(',')
        .map(str::trim)
        .filter(|entry| !entry.is_empty())
        .map(|entry| {
            let (name, url) = entry
                .split_once('=')
                .map(|(n, u)| (n.trim(), u.trim()))
                .filter(|(n, u)| !n.is_empty() && !u.is_empty())
                .ok_or_else(|| ConfigError::ProbeFormat {
                    entry: entry.to_owned(),
                })?;
            if !seen.insert(name.to_owned()) {
                return Err(ConfigError::DuplicateProbe {
                    name: name.to_owned(),
                });
            }
            Ok(Probe {
                name: name.to_owned(),
                url: http_url("PROBES", url)?,
            })
        })
        .collect()
}

fn log_filter(value: String) -> Result<String, ConfigError> {
    match EnvFilter::try_new(&value) {
        Ok(_) => Ok(value),
        Err(source) => Err(ConfigError::LogLevel { value, source }),
    }
}

#[cfg(test)]
mod tests {
    use clap::CommandFactory;
    use rstest::rstest;

    use super::*;

    const TOKEN: &str = "123456:SECRET-token-value";

    fn parse(args: &[&str]) -> Result<Config, ConfigError> {
        let mut command_line = vec!["watchdog"];
        command_line.extend_from_slice(args);
        Config::try_from(Cli::try_parse_from(command_line).expect("clap parse"))
    }

    fn telegram_args() -> Vec<&'static str> {
        vec!["--telegram-bot-token", TOKEN, "--telegram-chat-id", "42"]
    }

    #[test]
    fn defaults_match_the_specification() {
        let config = parse(&telegram_args()).expect("valid");
        assert_eq!(config.namespace, "outegro");
        assert_eq!(
            config.watched_namespaces,
            [
                "outegro",
                "agents",
                "argocd",
                "cert-manager",
                "cnpg-system",
                "kube-system"
            ]
        );
        assert_eq!(config.state_configmap, "watchdog-state-v2");
        assert_eq!(
            config.prometheus_url.as_str(),
            "http://monitoring-prometheus.monitoring.svc:9090/"
        );
        assert_eq!(config.disk_path, PathBuf::from("/probe"));
        assert_eq!(config.run_timeout, Duration::from_secs(120));
        assert_eq!(config.http_timeout, Duration::from_secs(10));
        assert_eq!(config.log_filter, "info");
        assert!(!config.dry_run());
        let Delivery::Telegram(telegram) = &config.delivery else {
            panic!("telegram expected");
        };
        assert_eq!(telegram.api_url.as_str(), "https://api.telegram.org/");
        assert_eq!(telegram.chat_id, "42");
        assert_eq!(telegram.token.expose(), TOKEN);

        let probes: Vec<String> = config.probes.iter().map(ToString::to_string).collect();
        assert_eq!(
            probes,
            [
                "landing=https://outegro.dev/",
                "id=https://id.outegro.dev/health",
                "auth=http://auth-backend.outegro.svc:4001/health/deep",
                "notifications=http://notifications-backend.outegro.svc:4002/health/deep",
                "payments=http://payments-backend.outegro.svc:4003/health/deep",
                "battleship-backend=http://battleship-backend.outegro.svc:4004/health/deep",
                "battleship=https://battleship.outegro.dev/health",
                "edu-backend=http://edu-backend.outegro.svc:4005/health/deep",
                "edu=https://edu.outegro.dev/health",
                "pay=https://pay.outegro.dev/health",
                "admin=https://admin.outegro.dev/health",
            ]
        );
    }

    #[test]
    fn every_setting_has_its_environment_variable() {
        let command = Cli::command();
        let envs: Vec<(String, String)> = command
            .get_arguments()
            .filter_map(|arg| {
                let env = arg.get_env()?.to_str()?.to_owned();
                Some((arg.get_id().to_string(), env))
            })
            .collect();
        let expected = [
            ("namespace", "NAMESPACE"),
            ("watched_namespaces", "WATCHED_NAMESPACES"),
            ("state_configmap", "STATE_CONFIGMAP"),
            ("prometheus_url", "PROMETHEUS_URL"),
            ("probes", "PROBES"),
            ("disk_path", "DISK_PATH"),
            ("telegram_bot_token", "TELEGRAM_BOT_TOKEN"),
            ("telegram_chat_id", "TELEGRAM_CHAT_ID"),
            ("telegram_api_url", "TELEGRAM_API_URL"),
            ("dry_run", "DRY_RUN"),
            ("run_timeout", "RUN_TIMEOUT"),
            ("http_timeout", "HTTP_TIMEOUT"),
            ("log_level", "LOG_LEVEL"),
        ];
        let expected: Vec<(String, String)> = expected
            .iter()
            .map(|(id, env)| ((*id).to_owned(), (*env).to_owned()))
            .collect();
        assert_eq!(envs, expected);
        command.debug_assert();
    }

    #[rstest]
    #[case::true_word("true", true)]
    #[case::one("1", true)]
    #[case::yes("yes", true)]
    #[case::false_word("false", false)]
    #[case::zero("0", false)]
    fn dry_run_values(#[case] value: &str, #[case] dry: bool) {
        let mut args = telegram_args();
        args.extend(["--dry-run", value]);
        assert_eq!(parse(&args).expect("valid").dry_run(), dry);
    }

    #[test]
    fn dry_run_rejects_nonsense() {
        assert!(Cli::try_parse_from(["watchdog", "--dry-run", "maybe"]).is_err());
    }

    #[test]
    fn dry_run_does_not_need_telegram() {
        let config = parse(&["--dry-run", "true"]).expect("valid");
        assert_eq!(config.delivery, Delivery::DryRun);
    }

    #[rstest]
    #[case::nothing(&[])]
    #[case::token_only(&["--telegram-bot-token", TOKEN])]
    #[case::chat_only(&["--telegram-chat-id", "42"])]
    #[case::blank_token(&["--telegram-bot-token", " ", "--telegram-chat-id", "42"])]
    fn telegram_is_required_without_dry_run(#[case] args: &[&str]) {
        assert!(matches!(parse(args), Err(ConfigError::MissingTelegram)));
    }

    #[rstest]
    #[case::bad_prometheus_url(&["--prometheus-url", "not a url"], "PROMETHEUS_URL: invalid URL \"not a url\"")]
    #[case::ftp_prometheus(&["--prometheus-url", "ftp://prom:21"], "PROMETHEUS_URL: URL must use http or https: \"ftp://prom:21\"")]
    #[case::bad_telegram_url(&["--telegram-api-url", "telegram"], "TELEGRAM_API_URL: invalid URL \"telegram\"")]
    #[case::bad_duration(&["--run-timeout", "soon"], "RUN_TIMEOUT: invalid duration \"soon\" (examples: 10s, 2m, 1m30s)")]
    #[case::zero_duration(&["--http-timeout", "0s"], "HTTP_TIMEOUT must be greater than zero")]
    #[case::probe_without_url(&["--probes", "landing"], "PROBES: entry \"landing\" must look like name=URL")]
    #[case::probe_without_name(&["--probes", "=https://x"], "PROBES: entry \"=https://x\" must look like name=URL")]
    #[case::probe_bad_url(&["--probes", "x=nope"], "PROBES: invalid URL \"nope\"")]
    #[case::duplicate_probe(&["--probes", "a=http://a,a=http://b"], "PROBES: duplicate name \"a\"")]
    #[case::no_namespaces(&["--watched-namespaces", " , "], "WATCHED_NAMESPACES must not be empty")]
    #[case::blank_namespace(&["--namespace", " "], "NAMESPACE must not be empty")]
    #[case::blank_configmap(&["--state-configmap", ""], "STATE_CONFIGMAP must not be empty")]
    #[case::bad_log_level(&["--log-level", "loud=[["], "LOG_LEVEL: invalid filter \"loud=[[\"")]
    fn invalid_values(#[case] args: &[&str], #[case] message: &str) {
        let mut all = telegram_args();
        all.extend_from_slice(args);
        let err = parse(&all).expect_err("invalid");
        assert_eq!(err.to_string(), message);
    }

    #[test]
    fn lists_are_trimmed() {
        let mut args = telegram_args();
        args.extend([
            "--watched-namespaces",
            " outegro , agents,,",
            "--probes",
            " a = http://a.svc:1/health , ",
            "--namespace",
            " outegro ",
        ]);
        let config = parse(&args).expect("valid");
        assert_eq!(config.watched_namespaces, ["outegro", "agents"]);
        assert_eq!(config.probes.len(), 1);
        assert_eq!(config.probes[0].to_string(), "a=http://a.svc:1/health");
        assert_eq!(config.namespace, "outegro");
    }

    #[test]
    fn durations_accept_humantime() {
        let mut args = telegram_args();
        args.extend(["--run-timeout", "1m30s", "--http-timeout", "500ms"]);
        let config = parse(&args).expect("valid");
        assert_eq!(config.run_timeout, Duration::from_secs(90));
        assert_eq!(config.http_timeout, Duration::from_millis(500));
    }

    #[test]
    fn token_is_masked_in_debug_output() {
        let config = parse(&telegram_args()).expect("valid");
        let debug = format!("{config:?}");
        assert!(!debug.contains("SECRET"), "{debug}");
        assert!(debug.contains("Secret(***)"));

        let cli = Cli::try_parse_from(["watchdog", "--telegram-bot-token", TOKEN]).expect("clap");
        assert!(!format!("{cli:?}").contains("SECRET"));
    }

    #[test]
    fn errors_never_contain_the_token() {
        let cases: [&[&str]; 3] = [
            &["--telegram-api-url", "::"],
            &["--probes", "x"],
            &["--run-timeout", "x"],
        ];
        for args in cases {
            let mut all = telegram_args();
            all.extend_from_slice(args);
            let err = parse(&all).expect_err("invalid");
            assert!(!err.to_string().contains("SECRET"));
            assert!(!format!("{err:?}").contains("SECRET"));
        }
    }
}
