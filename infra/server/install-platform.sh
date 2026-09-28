#!/usr/bin/env bash
# Cluster controllers (OPS-01), pinned versions. Idempotent:
#   ssh outegro-prod 'sudo bash -s' < infra/server/install-platform.sh
set -euo pipefail
CERT_MANAGER=v1.21.2
CNPG=1.30.1
BARMAN_PLUGIN=v0.15.0

k() { k3s kubectl "$@"; }
wait_deployments() {
  for d in $(k -n "$1" get deploy -o name); do
    k -n "$1" rollout status "$d" --timeout=300s
  done
}

# Certificates: Let's Encrypt through Cloudflare DNS-01.
k apply -f "https://github.com/cert-manager/cert-manager/releases/download/${CERT_MANAGER}/cert-manager.yaml"
wait_deployments cert-manager

# PostgreSQL operator; its CRDs need server-side apply.
k apply --server-side -f "https://github.com/cloudnative-pg/cloudnative-pg/releases/download/v${CNPG}/cnpg-${CNPG}.yaml"
wait_deployments cnpg-system

# Backups to object storage (R2) through the Barman Cloud plugin (needs cert-manager).
k apply -f "https://github.com/cloudnative-pg/plugin-barman-cloud/releases/download/${BARMAN_PLUGIN}/manifest.yaml"
wait_deployments cnpg-system
