# Выпуск и откат

## До действия

Проверить новый target/context, candidate commit+digests, readiness report, fresh backup и совместимость DB N/N-1. Записать исходные release refs. Установить необходимые maintenance/checkout flags, не останавливая приём существующих webhook. Подтверждение применения к production определяется действующим поручением владельца, а не наличием документа.

## Шаги

1. Render/diff manifests выбранного release. Проверить namespace/hostnames/PVC/Secrets references.
2. Применить migration job с lock/deadline и migration role.
3. При nonzero остановить зависимый rollout, сохранить redacted logs, определить forward-fix. Не выполнять destructive down автоматически.
4. Выпустить immutable images. Наблюдать readiness/restart/resources и worker progress.
5. Выполнить smoke: landing EN/RU, login, own profile, pay empty/history, admin permission, health/metrics/alerts, webhook credential rejection. Реальное списание не входит в routine smoke без согласованного сценария.
6. Записать release result. Sales feature flag включать только для validated product/merchant.

## Откат

Если проблема только в совместимом image — вернуть предыдущий digest и повторить smoke. Если схема несовместима — forward-fix либо согласованное восстановление; не откатывать financial data ради старого UI. При остановке payments запретить новые checkout, сохранить durable webhook receive и последующий reconcile.

## Критерий восстановления

Основные routes/worker progress функционируют, инварианты оплаты/доступа соблюдены, alert resolved, candidate/rollback refs сохранены. Просто Ready pod не закрывает инцидент.
