# Identity и доступ

## Политика

Identity отвечает за человека, способы входа, sessions и административные roles. Payments отвечает за коммерческие grants. Resource owner проверяет `resource.userId === authenticatedUserId` либо отдельное разрешённое admin действие. Paid/pro никогда не означает admin.

## Defaults и точки проверки

| Параметр | Проектный начальный вариант | Где подтвердить |
|---|---|---|
| Passkey RP | `id.outegro.dev`, единственный origin `https://id.outegro.dev` (`WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, проверяются при старте); user verification обязательна при регистрации и входе; challenge одноразовый, 5 минут ([runbook](../06-operations/passkeys.md)) | ID-05 |
| Добавление passkey | Только сессия id.outegro.dev с входом не старше 5 минут (окно admin step-up), иначе 403 `session: reauthentication_required` и повторный вход `/login?reauth=1`; новая сессия заменяет прежнюю | ID-05 |
| Последний способ входа | Удаление Google или passkey отклоняется (409 `last_method`), если не остаётся пригодного способа: подтверждённый email (код приходит на этот адрес), привязанная identity, passkey текущего RP | ID-02, ID-05 |
| Cookies | Host-only, Secure, HttpOnly; SameSite по выбранному redirect flow | ID-04 browser tests |
| Email code TTL | 10 минут, resend cooldown 60 секунд | ID-01 threat/rate-limit tests |
| Code attempts | 5 на challenge; account/IP budget отдельно | ID-01 abuse simulation |
| Access TTL | 5 минут как кандидат | ID-03 latency/revoke policy |
| Admin step-up | 5 минут и привязка к action/resource | ID-07 |
| Refresh retry window | Не задан числом до rotation threat model | ID-03: не увеличивать наугад |
| Protocol library | Открытый технический ADR, не самописный OIDC по умолчанию | ID-04 |
| Ключ подписи access | ES256, `kid` — отпечаток RFC 7638, проверяющие требуют `typ: at+jwt`; ротация: анонс, переключение, изъятие ([runbook](../06-operations/signing-keys.md)) | ID-10 |

Defaults — не утверждение о текущих runtime settings. Один список config keys и tests должны использовать одинаковые значения; не дублировать TTL литералы в UI и server.

## Admin permissions

Owner имеет системные административные полномочия, но проходит sensitivity/step-up/audit. Support по умолчанию users.read(redacted), sessions.revoke, notifications.read/retry обычных сообщений. Billing operator billing.read, subscriptions.cancel; refunds.request отдельное назначение. Ручные коммерческие grants (выдать или отозвать доступ без оплаты) — grants.assign, по умолчанию только owner. Auditor только чтение audit/финансов в scope. Service operator services.read/allowlisted flags и operational replay без произвольного финансового command. Мониторинг (Grafana на `admin.outegro.dev/grafana/`) — monitoring.read, по умолчанию у owner, auditor и service operator: роль owner входит в Grafana как Admin, остальные с monitoring.read — как Viewer ([контракт входа](../06-operations/grafana-sso.md)).

У unknown permission отказ. RoleBinding включает scope/expiry; последнее owner binding защищено транзакционно. Критичный доступ перепроверяется свежо, stale JWT role не основание для возврата или назначения owner. Самопроизвольный impersonation отсутствует.

## Сложные решения для отдельного checkpoint

Перед ID-03 зафиксировать: как отличаем повтор потерянного ответа от нового replay, где хранится результат ротации, что случается после окна, как два backend процесса согласуют ротацию. Перед ID-04: library, issuer/client registry, code flow, точный logout contract и уровень OIDC соответствия. Перед ID-07: recovery владельца при потере authenticator. Модель не закрывает эти пункты фразой «использовать best practices»: нужны выбранное поведение и негативный тест.
