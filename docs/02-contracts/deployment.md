# Deployment contract

Один K3s server node, SQLite datastore при отсутствии доказанной причины менять. Один PostgreSQL через CNPG, отдельные logical DB identity/notifications/payments/admin/assistant. Redis/RabbitMQ по одному persistent экземпляру. Argo CD non-HA, Traefik/cert-manager, Sealed Secrets, bounded metrics/logs/alerts. Новый environment и новые secrets; старый VPS не меняется.

| Группа | Working set hypothesis, MiB |
|---|---:|
| ОС/K3s/runtime | 1024 |
| GitOps/ingress/controllers | 850 |
| Observability | 1000 |
| PostgreSQL | 900 |
| Redis | 256 |
| RabbitMQ | 550 |
| Core apps | 1400 |
| Hermes + assistant-store | 768 |
| Итого | 6748 |

Это около 6.59 GiB, не 6.75 GiB. При MemTotal 8192 MiB запас 1444; фактическая allocatable ниже и проверяется OPS-08. Эти числа не готовые container limits. Memory limits включают native overhead, concurrency и rollout. CI build не выполняется на VPS. Тяжёлые Hermes browser/build/local-LLM workloads выключены. Agent уступает ресурсный приоритет core сервисам.

## Release invariants

Images immutable by digest/commit. Migration Job получает отдельную role, lock и deadline. Failed migration блокирует соответствующий rollout. App readiness и migration success различаются. Secrets не хранятся plaintext в Git. Network policies проверены реальными запросами. Liveness не рестартует app только из-за временного provider outage.

## Адрес клиента

От него зависят лимиты входа (`login:ip`) и список сеансов. Production работает за прокси Cloudflare (решение владельца 29.09.2026), поэтому цепочка такая:

1. DNS-записи `@`, `www`, `id`, `pay`, `admin`, `hooks` — Proxied. SSL/TLS — Full (strict), на сервере — сертификат Let's Encrypt от cert-manager (DNS-01).
2. На 80/443 сервер пускает только [диапазоны Cloudflare](https://www.cloudflare.com/ips/). Правило должно срабатывать до DNAT K3s: firewall провайдера или nftables в prerouting. Обычные INPUT-правила ufw трафик, который K3s перенаправляет в поды, не видят. Второй слой — Traefik `ipAllowList` с теми же диапазонами; чтобы Traefik видел адрес узла Cloudflare, его Service — `externalTrafficPolicy: Local`. При OPS-01 проверить: запрос на IP сервера в обход Cloudflare не проходит, диапазоны обновляются скриптом.
3. Cloudflare кладёт адрес посетителя в `CF-Connecting-IP`. BFF (`clientHeaders` из `@outegro/bff`, `CLIENT_IP_SOURCE=cf-connecting-ip`) передаёт сервисам его и `User-Agent`; сервисы доверяют одному hop (`trust proxy` = 1). Без правила из п. 2 этот заголовок подделывается любым клиентом.
4. Функции Cloudflare, которые меняют HTML, выключены: Rocket Loader, Email Address Obfuscation, Web Analytics (RUM) ломают CSP с nonce. Bot Fight Mode выключен: он блокирует вебхуки.
5. SSH (22) идёт мимо Cloudflare: вход только по ключу, без пароля, с ограничением попыток.

Без прокси (записи DNS only) — `CLIENT_IP_SOURCE=x-forwarded-for`: Traefik не доверяет входящему `X-Forwarded-For` и дописывает адрес клиента последним, BFF берёт эту запись. Этот режим проверяет e2e `TC-ID-09-01`, режим Cloudflare — unit-тест `clientHeaders`.

## Backup

PG base backup/WAL вне VPS; consistent K3s SQLite/token backup и отдельные recovery keys. Hermes SQLite/memory плюс assistant DB/media восстанавливаются согласованно. Backup success не означает restore success. Цели RPO 15 минут и RTO 4 часа после предоставления заменяющего сервера проверяются rehearsal. Дубли notification/payment после restore предотвращаются idempotency и reconciliation; внешние деньги не откатываются вместе с PG.
