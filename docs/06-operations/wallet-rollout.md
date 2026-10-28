# Кошелёк: первая выкатка wallet-backend

Как у Обучения: сначала база и секрет, потом образ, потом сервис. Шаги: 0 — владелец на сервере, 1 — gitops (роль, база, запись образа, сеть, мониторинг), 2 — platform (образ), 3 — gitops (сервис, проба watchdog, раздел админки). Порядок важен: Job миграций `wallet-migrate` — PreSync-хук общего приложения Argo `outegro`, и если он упадёт (нет образа, секрета или базы), встанут выкатки всех сервисов ([production.md](production.md#выпуск)). Документирование не разрешает выкатку: каждый шаг запускает владелец.

Кошелёк живёт только внутри кластера: у него нет поддомена, Ingress и OAuth-клиента. Его зовут admin-web (раздел «Кошелёк»), payments (этап 3) и roulette-backend (ставки, выплаты, балансы) по внутреннему адресу `http://wallet-backend:4007` с общим токеном `platform-internal` ([контракт](../02-contracts/wallet.md), [ADR-011](../03-decisions/adr/011-wallet-grumbles.md)).

Изменения подготовлены пулл-реквестами, по одному на шаг:

| Шаг | Что | PR | Состояние на 28.10.2026 |
|---|---|---|---|
| 0 | секрет `pg-wallet` на сервере | — | сделан: создан `node/secrets.sh`, зашифрован в gitops#2 |
| 1 | роль, база, запись образа, сеть, мониторинг | outegro-dev/gitops#2 | готов к слиянию |
| 2 | сервис и образ | outegro-dev/platform#143, затем #144 | готовы; #144 стоит поверх #143 |
| 3 | сервис, проба watchdog, раздел админки | outegro-dev/gitops#3 | сливать последним, поверх #2 |

В ветке gitops#2 третий шаг закомментирован, поэтому её можно сливать раньше образа, ничего не включая. gitops#3 стоит поверх #2 и случайно раньше него в `master` не попадёт.

## Шаг 0. Владелец, на сервере

Сделан 28.10.2026 по поручению владельца: `pg-wallet` создан (остальные секреты не изменились) и зашифрован в `apps/production/secrets/pg-wallet.yaml` ветки gitops#2. Повторять не нужно; ниже — как это делается, на случай нового сервера или ротации.

Секрет базы (из корня gitops ветки `feat/wallet-deploy`: её `node/secrets.sh` уже содержит строку `pg-wallet`; без ключей на stdin скрипт только создаёт недостающие внутренние секреты и ничего не перезаписывает):

```text
scp node/secrets.sh outegro-prod:/tmp/
ssh outegro-prod 'sudo bash /tmp/secrets.sh; rm /tmp/secrets.sh' < /dev/null
ssh outegro-prod 'sudo bash -s -- outegro/pg-wallet' < node/seal.sh > apps/production/secrets/pg-wallet.yaml
```

Затем добавить `- pg-wallet.yaml` в `apps/production/secrets/kustomization.yaml`. Открытое значение пароля сервер не покидает. Других секретов нет: `INTERNAL_API_TOKEN` берётся из существующего `platform-internal`, Valkey и RabbitMQ — из общих секретов.

## Шаг 1. gitops: база, роль, запись образа

В `feat/wallet-deploy` репозитория gitops уже есть:

- `node/secrets.sh` — `pg-wallet` (basic-auth, пользователь `wallet`);
- `apps/production/postgres.yaml` — управляемая роль `wallet` и `Database wallet`;
- `apps/production/kustomization.yaml` — запись `images` для `outegro/wallet-backend` (тег `pending`; CI запишет `<тег>@sha256`, пока на него никто не ссылается) и закомментированный `wallet.yaml`;
- `network-policies.yaml` — порт метрик `wallet-backend` только для Prometheus;
- `platform/monitoring/extra/targets.yaml` — `wallet-backend` в PodMonitor `services`;
- `platform/monitoring/extra/rules.yaml` — алерты `WalletReconciliationIssues`, `WalletReconciliationStale`, `WalletOperationsFailing`;
- `platform/monitoring/extra/dashboards.yaml` — дашборд «outegro — wallet».

Без подов правила и цели ни на что не влияют. Вместе с `pg-wallet.yaml` из шага 0 — коммит в `master` gitops. Проверка:

```text
ssh outegro-prod 'sudo k3s kubectl -n outegro get database wallet'
```

## Шаг 2. platform: образ

Слить #143 (сам сервис) в `master` репозитория platform, затем #144 (стадия Dockerfile, bake, CI scope): после слияния #143 у #144 сменить базу на `master`, если GitHub не сделал этого сам. Dockerfile — корневой файл, поэтому CI проверит и соберёт всё, включая `wallet-backend`, и запишет его digest в запись `images` из шага 1. Остальные приложения выкатятся как обычно (новые контракты: права `wallet.*`, коды 402 и 423, раздел «Кошелёк» в админке, пока без адреса — «не подключён»).

## Шаг 3. gitops: сервис

После того как CI записал digest `wallet-backend` (в `apps/production/kustomization.yaml` вместо `pending` стоит `<тег>@sha256:…`), слить gitops#3 (после слияния #2 сменить его базу на `master`). Он включает:

- `apps/production/kustomization.yaml` — `- wallet.yaml` в `resources`;
- `apps/production/watchdog.yaml` — проба `wallet-backend`;
- `apps/production/admin.yaml` — `WALLET_API_URL` (раздел «Кошелёк» в админке).

Коммит в `master` gitops. Argo выполнит `wallet-migrate` (схема, системные счета `GRM`, запрет изменения журнала), поднимет `wallet-backend` и перезапустит admin-web с новым адресом.

## Проверка

```text
ssh outegro-prod 'sudo k3s kubectl -n outegro logs job/wallet-migrate'
ssh outegro-prod 'sudo k3s kubectl -n outegro exec deploy/wallet-backend -- node -e "fetch(\"http://127.0.0.1:4007/health/deep\").then(r=>r.text()).then(console.log)"'
```

В логе Job — `migrations applied`; health/deep — postgres, valkey и rabbitmq `up`. В админке: «Кошелёк» → обзор с нулём на руках и системными счетами, сумма которых 0; «Сверка» → первый проход через 5 минут после старта, полный — после 02:00 UTC. Начислить себе 1 грамблс с причиной «проверка выкатки» и списать его обратно — в журнале две операции «было → стало», в аудите две записи.

## Ресурсы

wallet-backend 50m / 128Mi (лимит 256Mi): без сокетов и тяжёлых запросов, одна транзакция на операцию. Следить за `resource-pressure` после первой полной выкатки.

## Расхождения сверки

Алерт `WalletReconciliationIssues`: проход сверки нашёл расхождение кэша с журналом. Сверка ничего не чинит, а операции продолжают работать.

1. Админка → «Кошелёк» → «Сверка»: вид и subject (`wallet:<userId>:GRM`, `system:<code>:GRM`, `unit:GRM`) и подробности (`cached` против `journal`).
2. `balance_drift` или `chain_break` одного кошелька — кэш изменили в обход операций (ручной SQL, восстановление из бэкапа до коммита операции). Журнал — источник правды: сравнить с `select sum(amount) from wallet_tx where user_id = …`. Исправлять только новой операцией через админку («Установить баланс» с причиной), а не UPDATE кэша: журнал не меняется, и следующий проход закроет расхождение, когда кэш снова совпадёт с журналом.
3. `system_drift` или `zero_sum` без `balance_drift` — менялся системный счёт. Это ручное вмешательство в базу: найти его по логам PostgreSQL и аудиту, не чинить наугад.

Алерт `WalletReconciliationStale`: сверка не завершалась больше 30 минут при работающем поде. Логи: `ssh outegro-prod 'sudo k3s kubectl -n outegro logs deploy/wallet-backend --since=1h' | grep -i reconciliation`. `SAFE_MODE` останавливает воркер сверки намеренно.

Алерт `WalletOperationsFailing`: операции кошелька падают с внутренней ошибкой (не отказы 402/423/409). Смотреть логи пода по `requestId`; чаще всего недоступна база.

## Откат

Шаг 3 — `git revert` коммита: под уходит, раздел админки возвращается в «не подключён», база и журнал остаются. Шаг 1 — откатывать только вместе с шагом 3; база `wallet` удаляется отдельно и вручную, только если владелец решит отказаться от сервиса: журнал грамблсов — финансовая история.

## Этап 2: включить пакеты грамблсов

Код этапа 2 выключен флагом payments `GRUMBLE_PACKS_ENABLED` ([контракт](../02-contracts/wallet.md), [W-04](../04-delivery/90-optional-wallet/tasks/W-04.md)). Включает владелец, когда есть пакеты, цены и офферы Lava (GRUMBLE-PACKS):

1. Выкатить wallet-backend и payments-backend с кодом этапа 2 при выключенном флаге: миграции wallet 0002 и payments 0003 только добавляют, очередь `wallet.billing-events` появляется при старте wallet-backend.
2. В `apps/production/payments.yaml` gitops задать `GRUMBLE_PACKS` — JSON `[{"key":"grumbles-1000","grumbles":1000,"offerId":"<оффер Lava>","prices":{"RUB":"…"}}]`, у каждого пакета свой оффер, цены как в оффере — и `GRUMBLE_PACKS_ENABLED=true`. Неверный JSON остановит старт payments, а не продаст пакет.
3. Проверка: пакеты в `GET /v1/catalog` и в pay-web группой «Кошелёк»; самый маленький пакет своей картой → в журнале кошелька `purchase` с ref `pack:payment:…`, в «Сверке» чисто; возврат части из кабинета Lava (запрос возврата в админке payments, затем вебхук) → `clawback`.

Выключить: `GRUMBLE_PACKS_ENABLED=false` убирает пакеты из каталога; купленное, лоты и журнал остаются.
