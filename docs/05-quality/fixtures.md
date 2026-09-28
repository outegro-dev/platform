# Набор воспроизводимых фикстур

## Пользователи

`owner` verified, strong authentication; `user-a` обычный EN; `user-b` обычный RU; `support` с ограниченными permissions; `auditor` read-only; `blocked-user`; `expired-role-user`. В данных реальные UUID с постоянным alias map. Emails только example.test; реальные addresses в CI отсутствуют.

## Деньги и продукты

Закрытый `fixture-product`, price v1 = USD 1000 minor, v2 = USD 1500. Второй продукт той же цены для проверки неоднозначного match. Отдельные EUR операции, которые никогда не суммируются с USD. Decimal edge cases 0.10+0.20, значения за Number.MAX_SAFE_INTEGER для DTO, неподдержанный scale, negative amount. Negative допустим только определённой signed posting модели, не checkout price.

Два одинаковых заказа одного user/email — обязательная fixture refund matching. Provider IDs synthetic и помечены env=test. Fixture payloads по Lava snapshots не содержат реальных buyer data/API keys.

## Время

Управляемый Clock с T0. Проверки expiry до T, ровно T и после T. Subscription `[start,end)`; тест на DST/timezone display не меняет UTC validity. Token/code tests не ждут реальные 10 минут. Production runtime использует системное время, подмена только через dependency injection в test harness.

## События и сбои

Каждое event fixture имеет eventId, aggregateVersion и correlationId. Варианты: exact duplicate; тот же business fact с другим transport ID; out-of-order v3→v2; unknown schema; broker down; commit-before-ack; webhook-before-mapping; provider accepted-before-timeout. Fake provider хранит call log для assertions «второй create не выполнен».

## Hermes

Синтетические Telegram IDs owner/outsider/chat-A/chat-B/topic-items/topic-other. Одно фото вещи без персональных данных, album из трёх фото, два похожих отдельных предмета. Purchase price=100, asking=80 в одной валюте; public listing никогда не содержит 100. Fake model предоставляет vision suggestion и quota error. Fake Telegram может принять send и потерять response; assert отсутствие автоматического второго send.

## Reset

Reset разрешён только явно помеченной ephemeral test DB с проверкой environment/hostname. Test runner отказывается подключаться к production DSN. Не использовать production dump для fixture. Restore rehearsal отключает egress реальным получателям до запуска workers.
