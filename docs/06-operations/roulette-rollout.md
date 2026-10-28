# Рулетка: первая выкатка roulette.outegro.dev

## Шаги и порядок

| Шаг | Где | Что |
|---|---|---|
| 0 | вне репозиториев | DNS и секреты на сервере |
| 1 | gitops | базы, роли, Valkey рулетки, вход |
| 2 | platform | образы |
| 3 | gitops | коммит сезона, публичный сид, приложения |

**Почему порядок важен.** Job миграций — PreSync-хук общего приложения Argo `outegro`. Если он упадёт (нет образа, секрета или базы), встанут выкатки всех сервисов ([production.md](production.md#выпуск)).

**Кошелёк — раньше всех шагов.** Ставки идут настоящими грамблсами. wallet-backend (ADR-011) выкачен 28.10.2026 ([его выкатка](wallet-rollout.md)). Без него в production roulette-backend и daily-bonus-backend не стартуют: конфиг требует `WALLET_MODE=http`.

**Ветки:**
- gitops — `feat/roulette-deploy`: приложения в ней закомментированы до шага 3;
- platform — `feat/roulette`.

## Шаг 0. Вне репозиториев

1. **DNS.** Запись `A roulette → IPv4 сервера`, Proxied. Владелец создал её 28.10.2026. Сертификат не нужен: origin закрыт wildcard `*.outegro.dev`.
2. **Секреты на сервере.** Из корня gitops ветки `feat/roulette-deploy`: её `node/secrets.sh` создаёт недостающие секреты и ничего не перезаписывает.

   ```text
   scp node/secrets.sh outegro-prod:/tmp/
   ssh outegro-prod 'sudo bash /tmp/secrets.sh; rm /tmp/secrets.sh' < /dev/null
   for s in pg-roulette pg-fair-roll pg-daily valkey-roulette fair-roll daily-bonus; do
     ssh outegro-prod "sudo bash -s -- outegro/$s" < node/seal.sh > apps/production/secrets/$s.yaml
   done
   ```

   Затем шесть файлов добавить в `apps/production/secrets/kustomization.yaml`. Открытые значения сервер не покидают.
   - `fair-roll` — корень цепочки сидов: кто его прочтёт, знает все исходы сезона. Секрет нельзя печатать, копировать с сервера и показывать в чате.

## Шаг 1. gitops: базы, роли, вход

В `feat/roulette-deploy` уже есть:
- роли и базы `roulette`, `fair_roll`, `daily` в `postgres.yaml`;
- `valkey-roulette.yaml`;
- OAuth-клиент `roulette-web` в `apps.yaml`;
- записи `images` для четырёх образов с тегом `pending`;
- сетевая политика и цели мониторинга.

Вместе с запечатанными секретами из шага 0 — merge в `master` gitops. Проверка:

```text
ssh outegro-prod 'sudo k3s kubectl -n outegro get database roulette fair-roll daily'
ssh outegro-prod 'sudo k3s kubectl -n outegro rollout status statefulset/valkey-roulette'
ssh outegro-prod 'sudo k3s kubectl -n outegro rollout restart deploy/auth-backend'
```

auth-backend читает `OAUTH_CLIENTS` только при старте. Без перезапуска вход в roulette-web ответит «неизвестный клиент».

## Шаг 2. platform: образы

Слить PR `feat/roulette` в `master` после кошелька. CI соберёт всё (изменён Dockerfile) и запишет digest четырёх образов в записи `images` из шага 1.

## Шаг 3. Сезон и приложения

**Зачем публичный сид.** Он должен появиться после того, как опубликован коммит цепочки. Иначе можно было бы подобрать «удобный» корень под известный сид (ADR-012). Поэтому сначала объявляем коммит и будущий раунд маяка drand, потом берём его значение.

1. **Коммит сезона.** Корень остаётся на сервере. Образ — тот, что CI записал в `kustomization.yaml` (`ghcr.io/outegro-dev/fair-roll-backend:<тег>@sha256:…`):

   ```text
   IMAGE=ghcr.io/outegro-dev/fair-roll-backend:<тег>@sha256:<digest>
   ssh outegro-prod "sudo k3s kubectl -n outegro run fair-roll-commit --rm -i --restart=Never \
     --image=$IMAGE --overrides='{\"spec\":{\"imagePullSecrets\":[{\"name\":\"ghcr-pull\"}],\"containers\":[{\"name\":\"fair-roll-commit\",\"image\":\"$IMAGE\",\"command\":[\"node\",\"dist/cli/commit.js\"],\"envFrom\":[{\"secretRef\":{\"name\":\"fair-roll\"}}]}]}}'"
   ```

   Ответ — `{"commit":"…","chainLength":1000000}`.

2. **Объявление.** Выбрать раунд маяка drand quicknet минут на десять вперёд:
   - параметры сети — `https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/info` (`period` 3 с, `genesis_time`);
   - номер раунда = `floor((время − genesis_time) / period) + 1`.

   Записать коммит, номер раунда и время в [журнал сезонов](roulette-seasons.md) и запушить в `master` platform **до** этого раунда. Коммит в публичном репозитории с меткой времени и есть объявление.

3. **Публичный сид.** Когда раунд наступит, взять его `randomness`:

   ```text
   curl -s https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971/public/<раунд>
   ```

   В `roulette.yaml` раскомментировать `FAIR_ROLL_PUBLIC_SEED` со значением `drand-quicknet:<раунд>:<randomness>` и дописать сид в журнал сезонов. После первого старта сменить его для этой цепочки нельзя: fair-roll не запустится.

4. **Включение.** Раскомментировать:
   - `- roulette.yaml` в `apps/production/kustomization.yaml`;
   - `ROULETTE_API_URL` и `DAILY_API_URL` в `apps/production/admin.yaml`;
   - пробы рулетки в `apps/production/watchdog.yaml`.

   Коммит в `master` gitops. Argo выполнит `roulette-migrate` (три базы) и поднимет четыре приложения и Ingress `roulette`.

## Проверка

```text
curl -s https://roulette.outegro.dev/health
ssh outegro-prod 'sudo k3s kubectl -n outegro logs job/roulette-migrate --all-containers'
ssh outegro-prod 'sudo k3s kubectl -n outegro logs deploy/roulette-backend --since=2m' | grep -E "Engine leader|Round opened"
node tools/ops/smoke.mjs
```

- **`/fair`.** Коммит и публичный сид совпадают с журналом сезонов. Проверка раунда в браузере: «звено верно», номер совпадает.
- **Игра.** Вход, ставка, выплата после раунда; баланс в шапке совпадает с кошельком. Бонус дня у аккаунта старше суток с подтверждённым email.
- **Админка → «Рулетка».**
  - Live идёт.
  - «Сервисы»: все четыре сервиса `up`, кошелёк `http`, есть лидер.
  - Пауза ставок и её снятие видны в аудите.

## Ресурсы

| Под | Запрос | Лимит |
|---|---|---|
| fair-roll-backend | 25m / 96Mi | 192Mi |
| roulette-backend | 100m / 192Mi | 384Mi |
| daily-bonus-backend | 25m / 128Mi | 256Mi |
| roulette-web | 50m / 128Mi | 320Mi |
| valkey-roulette | 25m / 32Mi | 96Mi |
| **Итого** | **+225m / +576Mi** | |

Вместе с кошельком узел подходит к пределу (8 ГБ). После выкатки посмотреть MemAvailable и вытеснения по [resource-pressure.md](resource-pressure.md). Если запаса меньше 300 МиБ, предложить владельцу вертикальное увеличение VPS.

## Откат

- **Шаг 3:** `git revert` коммита. Поды и Ingress уходят, базы и данные остаются, сезон (коммит и раскрытые раунды) сохраняется.
- **Шаг 1:** откатывать только вместе с шагом 3. Базы удаляются отдельно и вручную, если владелец откажется от рулетки.
- **Деньги игроков.** Ставки и выигрыши — операции кошелька с ref `roulette:bet:…` и `roulette:win:…`. Откат рулетки их не трогает.
- **Если надо закрыть стол быстро** — админка → «Рулетка» → «Стол» → «Режим обслуживания»: текущий раунд доиграется, новый не откроется.
