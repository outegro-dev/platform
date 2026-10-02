#!/usr/bin/env bash
# Stepped read-only load on the origin (OPS-08 TC-OPS-08-01): N parallel
# clients loop over public pages for SECONDS per step, through Traefik with
# the real Host and TLS, bypassing Cloudflare (its protection drops a flood
# from one address, and a home connection saturates first). No sign-in, no
# purchases. Run on the server; the curl loops share its CPU, so the numbers
# are a floor.
#   ssh outegro-prod 'sudo bash -s "4 8 16 32 64" 60' < tools/ops/load-origin.sh
set -u
steps=${1:-"4 8 16"}; secs=${2:-60}
traefik=$(k3s kubectl -n kube-system get svc traefik -o jsonpath='{.spec.clusterIP}')
R=""; for h in outegro.dev id.outegro.dev battleship.outegro.dev pay.outegro.dev; do R="$R --resolve $h:443:$traefik"; done
pages="https://outegro.dev/ https://outegro.dev/stack https://id.outegro.dev/login https://id.outegro.dev/health/deep https://battleship.outegro.dev/ https://pay.outegro.dev/signed-out"
for n in $steps; do
  out=$(mktemp); end=$(( $(date +%s) + secs ))
  for c in $(seq 1 $n); do
    ( while [ $(date +%s) -lt $end ]; do for p in $pages; do curl -sk -o /dev/null $R -A outegro-load/1 -m 10 -w "%{http_code} %{time_total}\n" "$p"; done; done >> $out ) &
  done
  wait
  total=$(wc -l < $out); bad=$(awk '$1!=200' $out | wc -l)
  sort -k2 -n $out | awk -v t=$total -v n=$n -v s=$secs -v b=$bad '{a[NR]=$2} END {printf "{\"clients\":%d,\"requests\":%d,\"rps\":%.1f,\"p50\":%d,\"p95\":%d,\"p99\":%d,\"max\":%d,\"errors\":%d}\n", n, t, t/s, a[int(t*0.5)]*1000, a[int(t*0.95)]*1000, a[int(t*0.99)]*1000, a[t]*1000, b}'
  rm -f $out
  sleep 5
done
