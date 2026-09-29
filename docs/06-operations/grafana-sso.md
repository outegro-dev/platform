# Вход в Grafana через админку

Состояние на 29.09.2026. Сторона admin-web готова и проверена тестами: `apps/admin-web/src/lib/grafana-gate.test.ts`, `apps/admin-web/src/lib/monitoring.test.ts` и e2e `apps/admin-web/e2e/monitoring.spec.ts` (реальная сборка против fake platform). Grafana, маршрут Traefik и middleware разворачиваются в gitops; пока их нет, `admin.outegro.dev/grafana` отвечает 404 самой админки.

## Как устроено

- Grafana работает под подпутём `/grafana/` на хосте админки `admin.outegro.dev`. Traefik отправляет `/grafana` туда, всё остальное на хосте — в admin-web.
- Перед каждым запросом к Grafana Traefik (ForwardAuth) делает `GET /api/grafana/auth` в admin-web с заголовками исходного запроса (в том числе `Cookie`) и своими `X-Forwarded-Method`, `X-Forwarded-Proto`, `X-Forwarded-Host`, `X-Forwarded-Uri`.
- admin-web узнаёт оператора так же, как страницы консоли: по cookie сессии спрашивает Identity `GET /v1/me` (свежие роли, права и статус аккаунта из БД). Ответ 2xx пропускает запрос в Grafana с заголовками `X-WEBAUTH-*` из ответа; любой другой ответ Traefik отдаёт браузеру как есть.
- Grafana включает auth proxy и доверяет этим заголовкам: создаёт пользователя при первом входе и синхронизирует имя, email и роль.

## Контракт `GET /api/grafana/auth`

| Ситуация | Ответ |
|---|---|
| Роль `owner` | `200`, пустое тело, `Cache-Control: no-store`, `X-WEBAUTH-ROLE: Admin` и остальные заголовки ниже |
| Право `monitoring.read` без роли `owner` (по умолчанию auditor и service_operator) | `200`, то же, `X-WEBAUTH-ROLE: Viewer` |
| Вошёл, но нет ни `owner`, ни `monitoring.read`; или аккаунт не `active` | `403`, страница EN/RU «Нет доступа к мониторингу» с email аккаунта и ссылкой в консоль |
| Нет ни `og_at`, ни `og_rt` | `302` на `/auth/sign-in?returnTo=<путь в Grafana>` |
| Остался только `og_rt`, или до истечения `og_at` ≤ 30 с; сессия простаивала дольше лимита консоли (32 минуты) | `302` (GET, HEAD) или `307` (запросы с телом) на `/monitoring?to=<путь в Grafana>` |
| Identity отказал в непросроченном токене (сессия отозвана, аккаунт заблокирован) | то же перенаправление на `/monitoring?to=…`: там сессия удаляется и начинается новый вход |
| Identity не ответил | `503`, страница EN/RU «Не удалось проверить доступ» со ссылками «Повторить» и «Вернуться в консоль» |

Язык страниц — по общей cookie `og_locale` (по умолчанию EN). Страницы без скриптов, с `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'`.

### Заголовки ответа 200

| Заголовок | Значение |
|---|---|
| `X-WEBAUTH-USER` | email в нижнем регистре — стабильный логин пользователя в Grafana |
| `X-WEBAUTH-EMAIL` | тот же email |
| `X-WEBAUTH-NAME` | отображаемое имя из Identity, без него — email |
| `X-WEBAUTH-ROLE` | `Admin` или `Viewer` |

- Все четыре есть и непусты в каждом `200` и только в нём: остальные ответы не несут `X-WEBAUTH-*`.
- Заголовки `X-WEBAUTH-*`, пришедшие в запросе, обработчик не читает: имя и роль берутся только из Identity.
- Значения — ASCII. Байты вне печатного ASCII и знак `=` кодируются quoted-printable (`Николай` → `=D0=9D=D0=B8…`), управляющие символы в имени заменяются пробелом. Grafana раскодирует их при `headers_encoded = true`; для ASCII-имён и email кодирование ничего не меняет.
- Смена email в Identity даёт в Grafana нового пользователя (логин — email).

### Куда возвращаться

- Путь берётся из `X-Forwarded-Uri` (для `/monitoring` — из `?to=`). Принимается только путь этого хоста под `/grafana/` длиной до 2000 символов; `/grafana` становится `/grafana/`.
- Всё остальное заменяется на `/grafana/`: абсолютные и protocol-relative адреса, обратные слэши, управляющие символы (в том числе табуляция, которую парсер URL выбросил бы), закодированные `/`, `\` и `.` (`%2F`, `%5C`, `%2E`), точки-сегменты, выводящие из `/grafana/`.
- `Location` всегда абсолютный на `APP_URL` (`https://admin.outegro.dev/…`): относительный Traefik разрешил бы от адреса auth-сервиса внутри кластера.

## Обновление сессии: маршрут `/monitoring`

Ответ ForwardAuth с кодом 2xx не передаёт браузеру `Set-Cookie`. Ротация refresh-токена без доставки нового cookie сломала бы сессию: браузер предъявил бы уже использованный токен. Поэтому:

- proxy admin-web для `/api/grafana/auth` ничего не обновляет и cookie не ставит; обработчик только читает `og_at`, `og_rt`, `og_admin_seen` и `og_locale`.
- Когда нужен refresh или проверка простоя, браузер идёт на `/monitoring?to=/grafana/…` — обычный маршрут консоли. Его proxy обновляет сессию и записывает cookie, отправляет вышедшего на вход (возврат снова через `/monitoring`) или завершает простаивающую сессию (`/sign-in?reason=idle`). Затем обработчик возвращает браузер в Grafana: `303` для GET и HEAD, `307` для запросов с телом — например, `POST /grafana/api/ds/query` панели повторяется с тем же телом.
- Если Identity отказывает в сессии, `/monitoring` удаляет cookie `og_at`, `og_rt`, `og_admin_seen` и отправляет на `/auth/sign-in?returnTo=<путь>`. Если refresh не состоялся, потому что Identity не ответил, — страница `503` со ссылкой «Повторить». Петли редиректов нет ни в одном случае.
- Активность: каждый проход через `/monitoring` (при работе в Grafana — примерно раз в 5 минут, срок access-токена) обновляет `og_admin_seen`, поэтому работа в Grafana не приводит к выходу из консоли по простою. Запросы автообновления дашборда тоже считаются активностью.
- WebSocket Grafana Live при нужном refresh получает редирект вместо upgrade и переподключается после ближайшего обычного запроса.

## Нагрузка на Identity

Экран Grafana — десятки запросов, и каждый проходит ForwardAuth, а Identity пропускает 120 запросов в минуту с одного IP посетителя (глобальный throttler auth-backend). Поэтому обработчик запоминает ответ `/v1/me` для access-токена на 10 секунд (не дольше срока токена; в памяти процесса admin-web, ключ — SHA-256 токена). Запоминаются только успешные ответы. Следствие: отзыв сессии, блокировка или потеря права закрывают Grafana не позже чем через 10 секунд, новая роль попадает в заголовок в тот же срок. `/monitoring` спрашивает Identity всегда заново.

## Права

- `monitoring.read` в `packages/contracts` ([identity-access](../02-contracts/identity-access.md#admin-permissions)): у owner (все права), auditor и service_operator. Другим людям доступ открывает роль с этим правом.
- Роль `owner` → `Admin` в Grafana (дашборды, источники данных, алерты). Любой другой с `monitoring.read` → `Viewer`. Аккаунт не в статусе `active` не проходит, какие бы роли у него ни были.
- Пункт «Мониторинг» (группа «Инфраструктура») в меню консоли виден всем с `monitoring.read` и открывает `/grafana/` в той же вкладке.

## Что настроить в gitops

### Traefik

```yaml
apiVersion: traefik.io/v1alpha1
kind: Middleware
metadata:
  name: grafana-auth
  namespace: monitoring
spec:
  forwardAuth:
    # Service admin-web; контейнер слушает 3004.
    address: http://admin-web.outegro.svc.cluster.local:<порт Service>/api/grafana/auth
    trustForwardHeader: false
    authResponseHeaders:
      - X-WEBAUTH-USER
      - X-WEBAUTH-EMAIL
      - X-WEBAUTH-NAME
      - X-WEBAUTH-ROLE
```

- Маршрут: ``Host(`admin.outegro.dev`) && PathPrefix(`/grafana`)`` → Service Grafana, middlewares `grafana-auth` (и при желании второй, см. ниже). Без завершающего слэша в `PathPrefix`, чтобы `/grafana` тоже попадал в Grafana. Путей, начинающихся с `/grafana`, у admin-web нет; ForwardAuth-адрес `/api/grafana/auth` и `/monitoring` под это правило не подпадают и должны остаться в admin-web.
- `authRequestHeaders` не задавать (передаются все заголовки). Если задать, обязательно оставить `Cookie`, `User-Agent` и `CF-Connecting-IP` (или `X-Forwarded-For` — по `CLIENT_IP_SOURCE` admin-web). До обработчика должны доходить cookie `og_at`, `og_rt`, `og_admin_seen` (host-only, `Path=/`) и `og_locale` (домен `.outegro.dev`); браузер отправляет их и на `/grafana/…`.
- `authResponseHeaders` заменяет одноимённые заголовки клиента: подделанный `X-WEBAUTH-*` до Grafana не доходит. Если Grafana будет читать ещё какой-то заголовок (например, `X-WEBAUTH-GROUPS`), его нужно добавить в этот список, иначе клиент сможет прислать его сам.
- `trustForwardHeader: false`: `X-Forwarded-*` для обработчика выставляет сам Traefik, клиент их не подменит.
- Рекомендуется вторым middleware после `grafana-auth` убрать `Cookie` из запроса к Grafana (`headers.customRequestHeaders: {Cookie: ""}`): с auth proxy Grafana cookie не нужны, а `og_at` и `og_rt` консоли тогда не попадают в Grafana. Проверить после включения.
- По желанию: отдельный маршрут без `grafana-auth` для `/grafana/public/` (сборка фронтенда Grafana, одинаковая для всех) снимет с ForwardAuth большую часть запросов первой загрузки. Цена — версия Grafana и её статика видны без входа.

### Grafana

```ini
[server]
root_url = https://admin.outegro.dev/grafana/
serve_from_sub_path = true

[auth.proxy]
enabled = true
header_name = X-WEBAUTH-USER
header_property = username
auto_sign_up = true
headers = Email:X-WEBAUTH-EMAIL Name:X-WEBAUTH-NAME Role:X-WEBAUTH-ROLE
headers_encoded = true
enable_login_token = false
# IP-адреса, с которых принимаются заголовки: поды Traefik (в K3s — сеть подов).
whitelist = 10.42.0.0/16

[users]
allow_sign_up = false

[auth]
disable_login_form = true
```

- `headers_encoded = true` обязателен для имён не на латинице.
- `enable_login_token = false`: Grafana не заводит свою сессию; каждый запрос проходит ForwardAuth и несёт текущую роль в заголовке.
- `whitelist` по сети подов не отличает Traefik от других подов; надёжнее NetworkPolicy, разрешающая вход в Grafana только из Traefik (NetworkPolicy в кластере пока нет — [production](production.md#чего-ещё-нет)).

## Проверка после выкатки

1. Без входа открыть `https://admin.outegro.dev/grafana/d/<uid>` → вход через id.outegro.dev → тот же дашборд.
2. Владелец: в Grafana профиль с email и ролью Admin; auditor — Viewer; support — страница «Нет доступа к мониторингу».
3. `curl -s -o /dev/null -w '%{http_code}' -H 'X-WEBAUTH-USER: x@evil.test' https://admin.outegro.dev/grafana/api/user` → `302` на вход, а не `200`.
4. Через 5–6 минут работы в Grafana (истёк access-токен) запросы продолжают проходить: в логах admin-web видны проходы через `/monitoring`.
