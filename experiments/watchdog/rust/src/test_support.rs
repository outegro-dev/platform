//! Helpers shared by unit tests.

/// A local URL nobody listens on: bind an ephemeral port, then release it.
pub(crate) fn closed_port_url() -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
    let port = listener.local_addr().expect("addr").port();
    drop(listener);
    format!("http://127.0.0.1:{port}")
}
