# Passkeys: RP id.outegro.dev

Состояние на 30.09.2026 (ID-05). Поведение проверено тестами: `apps/auth-backend/src/passkeys.test.ts`, блок ID-05 в `apps/auth-backend/src/adversarial.test.ts`, e2e `apps/id-web/e2e/passkeys.spec.ts`; прогоны и снимки — `docs/09-evidence/ID-05/20260930-0310-local/`.

## Как устроено

- **RP.** RP ID `id.outegro.dev`, единственный origin ceremonies — `https://id.outegro.dev`. Переменные auth-backend `WEBAUTHN_RP_ID` и `WEBAUTHN_ORIGIN`; production-значения — значения по умолчанию, в gitops их задавать не нужно. При старте auth-backend проверяет: origin без пути, HTTPS (HTTP только для `localhost`), RP ID равен хосту origin или его родительскому домену; иначе сервис не стартует. Локально `localhost` и `http://localhost:3002` (`apps/auth-backend/.env.example`).
- **Старый домен.** Credentials outegro.com не переносятся: новый RP и чистая БД. Каждый passkey хранит `rp_id`; passkey другого RP показывается как непригодный, не входит и не считается способом входа.
- **Ceremonies.** `@simplewebauthn/server` 14 в auth-backend, `@simplewebauthn/browser` 14 в id-web. User verification обязательна в регистрации и во входе; attestation `none`; discoverable credentials, вход без ввода email (usernameless) и через автозаполнение поля email (conditional mediation). User handle — 16 байт UUID аккаунта, без email и имени; он должен совпасть с владельцем credential.
- **Challenge.** Случайный, одноразовый, в Valkey (`wa:reg:<id>`, `wa:auth:<id>`) на 5 минут; забирается атомарно (`GETDEL`), поэтому повтор и гонка двух проверок получают отказ. Challenge регистрации привязан к пользователю и сессии, которые его начали.
- **Свежесть.** Добавить passkey может только сессия id.outegro.dev (не сессия приложения по SSO), вход в которую был не больше 5 минут назад — то же окно, что у admin step-up. Иначе id-web ведёт на `/login?reauth=1`: повторный вход любым способом (код, passkey, Google), новая сессия заменяет прежнюю.
- **Вход.** Passkey создаёт обычную сессию `auth_method = passkey`; SSO приложений через `/authorize` не меняется.
- **Счётчик подписи.** Сравнивается после проверки подписи и продвигается compare-and-set. Не выросший счётчик (кроме аутентификаторов, которые всегда отдают 0) — отказ и audit `passkey.counter_regression`.
- **Последний способ входа.** Удаление passkey или отвязка Google отклоняются, если не останется пригодного способа: подтверждённый email (код приходит на этот адрес), привязанная identity, passkey текущего RP. Проверка идёт под блокировкой строки пользователя, две параллельные попытки удалить два последних способа не проходят обе.
- **Audit и уведомления.** `passkey.registered`, `passkey.renamed`, `passkey.removed`, `passkey.counter_regression` — без имён passkey. Владельцу через outbox: `security.passkey-added.v1`, `security.passkey-removed.v1`; в данных только время, имя passkey в сообщение не попадает (его набирает тот, у кого сессия).
- **Лимиты.** Options входа — 30 в минуту и 60 за 10 минут на IP; проверка входа — 20 в минуту и 30 за 10 минут на IP; добавление — 10 в минуту на IP и 20 ceremonies в час на аккаунт; не больше 20 passkeys на аккаунт.
- **Signal API.** id-web сообщает устройству об изменениях, если браузер поддерживает метод (иначе ничего не отправляется и интерфейс не ждёт): после удаления passkey — `signalAllAcceptedCredentials` со списком passkeys текущего RP, которые аккаунт ещё принимает, и устройство может скрыть удалённый; после смены отображаемого имени — `signalCurrentUserDetails` (имя — email, отображаемое имя — имя или email, как при регистрации); неизвестный аккаунту passkey при входе — `signalUnknownCredential`. Переименование passkey устройству не передаётся: такого сигнала нет, имя passkey хранится только у нас. RP ID — хост `ID_URL`, user handle — 16 байт UUID аккаунта. Неполный список не отправляется никогда (устройство скрыло бы рабочий passkey), а auth-backend пока не отдаёт `credentialId` в `GET /v1/me/passkeys`: до этого сигнал об удалении уходит, только когда passkeys у аккаунта не осталось (follow-up auth-backend).
- **Заголовки id-web.** `Permissions-Policy: publickey-credentials-get=(self), publickey-credentials-create=(self)`; CSP с nonce без изменений (WebAuthn не требует внешних источников).

## Выкатка

1. notifications-backend: знает шаблоны `security.passkey-*.v1`.
2. auth-backend: миграция `0002_passkeys` (Job перед стартом), затем сервис. Миграция только добавляет таблицу `passkeys`, прежняя версия сервиса её не замечает.
3. id-web.

Если auth-backend выйдет раньше notifications-backend, intents с новыми ключами уйдут в DLQ как `unknown template`; после выката notifications-backend их нужно переиграть ([notification-incident](notification-incident.md)).

Откат приложения — revert без down-миграции: таблица остаётся, прежние версии её игнорируют. Passkeys, созданные до отката, снова работают после повторного выката.

## Пользователь потерял устройство с passkey

1. Войти по коду из письма: подтверждённый email — всегда способ входа.
2. «Безопасность» → удалить потерянный passkey; «Сеансы» → завершить остальные сеансы.
3. Email не подтверждён и passkey был последним способом: удалить его нельзя, автоматического восстановления нет. Восстановление — ручная процедура оператора с проверкой владения вне системы; одного письма для неё недостаточно.

## Администраторы

Роли и права не зависят от passkeys. Admin step-up с passkey (ID-07) пока не реализован: admin-команды проверяют свежие права из БД. Когда step-up появится, потерянный admin passkey восстанавливается по процедуре восстановления владельца (ID-07, C2.4), а не кодом из письма: вход только по email не должен обходить admin assurance.

## Audit `passkey.counter_regression`

Подписанный ответ пришёл со счётчиком, который не вырос: вероятна копия аппаратного ключа. Вход уже отклонён. Сообщить владельцу аккаунта, попросить удалить этот passkey в «Безопасности» и добавить новый; при подозрении на захват — завершить его сеансы.

## Смена RP

Не делать без решения владельца и ADR: после смены `WEBAUTHN_RP_ID` все зарегистрированные passkeys становятся непригодными (браузер подписывает для прежнего RP). Пользователи входят по коду и добавляют новые passkeys.
