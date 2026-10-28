//! The compiled binary end to end: exit codes, secrets in output, a full
//! `DRY_RUN` pass against a fake Kubernetes API server, and SIGTERM.
//!
//! The environment is cleared for every run, so nothing from the machine
//! (a real kubeconfig, a real token) can leak into the tests.

// Test code: a panic with a clear message is the desired failure mode.
#![allow(clippy::unwrap_used)]

use std::path::PathBuf;
use std::process::{Command, Output, Stdio};
use std::time::{Duration, Instant};

use nix::sys::signal::{Signal, kill};
use nix::unistd::Pid;
use serde_json::{Value, json};
use wiremock::matchers::{any, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const TOKEN: &str = "123456:SECRET-token";

/// The binary with an empty environment and no reachable cluster.
fn watchdog() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_watchdog"));
    command
        .env_clear()
        .env("HOME", "/nonexistent")
        .env("KUBECONFIG", "/nonexistent/kubeconfig");
    // Keep coverage collection working under `cargo llvm-cov`.
    if let Some(profile) = std::env::var_os("LLVM_PROFILE_FILE") {
        command.env("LLVM_PROFILE_FILE", profile);
    }
    command
}

fn output_text(output: &Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn json_lines(output: &Output) -> Vec<Value> {
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(|line| serde_json::from_str(line).unwrap_or_else(|_| panic!("not JSON: {line}")))
        .collect()
}

/// A kubeconfig pointing at the fake API server, unique per test.
fn kubeconfig(server: &MockServer, name: &str) -> PathBuf {
    let file =
        std::env::temp_dir().join(format!("watchdog-{name}-{}.kubeconfig", std::process::id()));
    let yaml = format!(
        "apiVersion: v1\nkind: Config\n\
         clusters:\n- name: fake\n  cluster:\n    server: {}\n\
         users:\n- name: fake\n  user: {{}}\n\
         contexts:\n- name: fake\n  context:\n    cluster: fake\n    user: fake\n\
         current-context: fake\n",
        server.uri()
    );
    std::fs::write(&file, yaml).unwrap();
    file
}

async fn run(mut command: Command) -> Output {
    tokio::task::spawn_blocking(move || command.output().unwrap())
        .await
        .unwrap()
}

#[test]
fn invalid_configuration_exits_2_without_leaking_the_token() {
    let output = watchdog()
        .env("TELEGRAM_BOT_TOKEN", TOKEN)
        .env("TELEGRAM_CHAT_ID", "42")
        .env("PROMETHEUS_URL", "not a url")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    let text = output_text(&output);
    assert!(!text.contains("SECRET"), "{text}");
    let log = json_lines(&output).pop().expect("a log line");
    assert_eq!(log["level"], "ERROR");
    assert_eq!(log["message"], "invalid configuration");
    assert!(
        log["error"]
            .as_str()
            .unwrap()
            .starts_with("PROMETHEUS_URL: invalid URL \"not a url\": ")
    );
}

#[test]
fn missing_telegram_settings_exit_2() {
    let output = watchdog().output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output_text(&output).contains("TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are required"));
}

#[test]
fn malformed_flag_values_exit_2() {
    let output = watchdog().env("DRY_RUN", "maybe").output().unwrap();
    assert_eq!(output.status.code(), Some(2));
}

#[test]
fn help_lists_variables_but_hides_the_token() {
    let output = watchdog()
        .env("TELEGRAM_BOT_TOKEN", TOKEN)
        .arg("--help")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(0));
    let text = output_text(&output);
    assert!(text.contains("TELEGRAM_BOT_TOKEN"), "{text}");
    assert!(text.contains("RUN_TIMEOUT"), "{text}");
    assert!(!text.contains("SECRET"), "{text}");
}

#[test]
fn no_cluster_configuration_exits_1() {
    let output = watchdog().env("DRY_RUN", "true").output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    let log = json_lines(&output).pop().expect("a log line");
    assert_eq!(log["message"], "pass failed");
    assert!(
        log["error"]
            .as_str()
            .unwrap()
            .starts_with("cannot create Kubernetes client")
    );
}

fn list(kind: &str, api_version: &str, items: &Value) -> ResponseTemplate {
    ResponseTemplate::new(200).set_body_json(json!({
        "kind": kind, "apiVersion": api_version, "metadata": {}, "items": items
    }))
}

fn not_found() -> ResponseTemplate {
    ResponseTemplate::new(404).set_body_json(json!({
        "kind": "Status", "apiVersion": "v1", "status": "Failure",
        "reason": "NotFound", "code": 404, "message": "not found"
    }))
}

async fn get(server: &MockServer, route: &str, response: ResponseTemplate) {
    Mock::given(method("GET"))
        .and(path(route))
        .respond_with(response)
        .mount(server)
        .await;
}

/// One server plays the Kubernetes API (a crashing pod, no PG cluster, no
/// backups, no state ConfigMap), Prometheus and the probed service.
async fn fake_world(server: &MockServer) {
    let crashing = json!([{
        "metadata": { "name": "api-1", "namespace": "outegro", "labels": { "app": "api" },
                      "creationTimestamp": "2026-01-01T00:00:00Z" },
        "status": { "phase": "Running",
                    "containerStatuses": [{ "name": "main", "image": "api", "imageID": "", "ready": false,
                                            "restartCount": 9, "state": { "waiting": { "reason": "CrashLoopBackOff" } } }] }
    }]);
    get(server, "/api/v1/pods", list("PodList", "v1", &crashing)).await;
    get(server, "/api/v1/nodes", list("NodeList", "v1", &json!([]))).await;
    get(
        server,
        "/apis/cert-manager.io/v1/certificates",
        list("CertificateList", "cert-manager.io/v1", &json!([])),
    )
    .await;
    get(
        server,
        "/apis/postgresql.cnpg.io/v1/namespaces/outegro/clusters/pg",
        not_found(),
    )
    .await;
    get(
        server,
        "/apis/postgresql.cnpg.io/v1/namespaces/outegro/backups",
        list("BackupList", "postgresql.cnpg.io/v1", &json!([])),
    )
    .await;
    get(
        server,
        "/apis/argoproj.io/v1alpha1/namespaces/argocd/applications",
        list("ApplicationList", "argoproj.io/v1alpha1", &json!([])),
    )
    .await;
    get(
        server,
        "/api/v1/namespaces/outegro/configmaps/watchdog-state-v2",
        not_found(),
    )
    .await;
    get(
        server,
        "/api/v1/alerts",
        ResponseTemplate::new(200)
            .set_body_json(json!({ "status": "success", "data": { "alerts": [] } })),
    )
    .await;
    get(server, "/health", ResponseTemplate::new(200)).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn dry_run_pass_against_a_fake_api_server() {
    // Telegram lives on the same server and must not be called.
    let server = MockServer::start().await;
    fake_world(&server).await;

    let config = kubeconfig(&server, "dry-run");
    let mut command = watchdog();
    command
        .env("KUBECONFIG", &config)
        .env("DRY_RUN", "true")
        .env("PROMETHEUS_URL", server.uri())
        .env("PROBES", format!("svc={}/health", server.uri()))
        .env("DISK_PATH", std::env::temp_dir())
        .env("TELEGRAM_BOT_TOKEN", TOKEN)
        .env("TELEGRAM_CHAT_ID", "42")
        .env("TELEGRAM_API_URL", server.uri());
    let output = run(command).await;
    std::fs::remove_file(&config).ok();

    let text = output_text(&output);
    assert_eq!(output.status.code(), Some(0), "{text}");
    assert!(!text.contains("SECRET"), "{text}");

    let lines = json_lines(&output);
    let printed: Vec<&str> = lines
        .iter()
        .filter(|line| line["dryRun"] == true)
        .map(|line| line["message"].as_str().unwrap())
        .collect();
    assert!(
        printed[0].starts_with("👋 outegro.dev watchdog is on duty"),
        "{printed:?}"
    );
    let problem = printed[1];
    assert!(
        problem.starts_with("🔴 outegro.dev: problem\n"),
        "{problem}"
    );
    for line in [
        "• no completed backup found",
        "• PostgreSQL cluster pg is missing",
        "• outegro/api-1: CrashLoopBackOff",
    ] {
        assert!(problem.contains(line), "{problem}");
    }

    let last = lines.last().unwrap();
    assert_eq!(last["message"], "pass complete", "{text}");
    assert_eq!(last["dry_run"], true);
    assert_eq!(last["state"], "Skipped");
    assert!(last["duration_ms"].is_u64());

    let writes: Vec<String> = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.method.as_str() != "GET")
        .map(|r| format!("{} {}", r.method, r.url.path()))
        .collect();
    assert_eq!(
        writes,
        Vec::<String>::new(),
        "no ConfigMap writes, no Telegram"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn sigterm_cancels_a_running_pass() {
    // Every request hangs, so the pass is still gathering when the signal comes.
    let server = MockServer::start().await;
    Mock::given(any())
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_secs(60)))
        .mount(&server)
        .await;

    let config = kubeconfig(&server, "sigterm");
    let child = watchdog()
        .env("KUBECONFIG", &config)
        .env("DRY_RUN", "true")
        .env("PROMETHEUS_URL", server.uri())
        .env("PROBES", format!("svc={}/health", server.uri()))
        .env("DISK_PATH", std::env::temp_dir())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    let waiting_since = Instant::now();
    while server.received_requests().await.unwrap().len() < 3 {
        assert!(
            waiting_since.elapsed() < Duration::from_secs(20),
            "the pass never started"
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let pid = Pid::from_raw(i32::try_from(child.id()).unwrap());
    kill(pid, Signal::SIGTERM).unwrap();

    let started = Instant::now();
    let output = tokio::task::spawn_blocking(move || child.wait_with_output().unwrap())
        .await
        .unwrap();
    std::fs::remove_file(&config).ok();

    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
    assert_eq!(output.status.code(), Some(143), "{}", output_text(&output));
    let last = json_lines(&output).pop().unwrap();
    assert_eq!(last["level"], "WARN");
    assert_eq!(last["signal"], "SIGTERM");
    assert!(
        last["message"]
            .as_str()
            .unwrap()
            .starts_with("pass cancelled")
    );
    let writes = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|r| r.method.as_str() != "GET")
        .count();
    assert_eq!(writes, 0);
}
