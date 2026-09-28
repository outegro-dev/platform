# Инварианты, которые нельзя ослаблять ради прохождения теста

| ID | Правило | Основные задачи |
|---|---|---|
| INV-01 | EN первый визит, RU явный выбор | L-06, R-01 |
| INV-02 | DOM-текст/CTA работают без WebGL | L-04, L-07, L-10 |
| INV-03 | Нет фиктивных кейсов/метрик/тарифов | L-02, L-08, PAY-02 |
| INV-04 | Старая DB не переносится, old production не меняется | BOOT-02, OPS-01 |
| INV-05 | Login code одноразовый и ограничен TTL/attempts | ID-01 |
| INV-06 | Email совпадение не даёт account linking | ID-02 |
| INV-07 | Code привязан client/redirect/PKCE и одноразовый | ID-04 |
| INV-08 | Paid grant не даёт admin permission | ID-06 |
| INV-09 | Последний owner не может исчезнуть обычной mutation | ID-07 |
| INV-10 | Чужой resource не доступен по guessed ID | ID-09, N-05, PAY-11 |
| INV-11 | Stale grant version не восстанавливает revoked | ID-08 |
| INV-12 | Истёкшее право проверяется без cron | PAY-06/07, ID-08 |
| INV-13 | Commit domain change и outbox атомарны | BE-05 |
| INV-14 | Повтор event не удваивает effect | BE-06, PAY-05 |
| INV-15 | Деньги exact, валюты не смешиваются | PAY-02, A-03 |
| INV-16 | Checkout timeout не запускает blind второй POST | PAY-03 |
| INV-17 | Return URL не выдаёт доступ | PAY-11 |
| INV-18 | Webhook ack только после durable receive | PAY-04 |
| INV-19 | Refund без source не угадывается | PAY-09 |
| INV-20 | Cancel не равен refund | PAY-08 |
| INV-21 | Ошибка email не откатывает payment | N-03, R-02 |
| INV-22 | Admin mutation выполняет domain API с audit | A-05…07 |
| INV-23 | Runtime DB role не делает DDL/чужой SELECT | BE-07 |
| INV-24 | Только один VPS; рост вертикальный | OPS-01/08 |
| INV-25 | Backup хранится вне узла, restore проверен | OPS-06/07 |
| INV-26 | Hermes owner AND chat gate до tools | H-04 |
| INV-27 | Topic name не ключ, /new не удаляет каталог | H-07 |
| INV-28 | Фото сохраняется до model processing | H-08/09 |
| INV-29 | Purchase price остаётся private | H-10 |
| INV-30 | Unknown publish не ведёт к слепому repost | H-10/11 |
| INV-31 | Quota не переключает на платный API/tools | H-05/11 |
| INV-32 | Wallet journal zero-sum и no double spend | W-01…06 при включении |

Если задача конфликтует с инвариантом, менять нужно реализацию либо явно пересматривать проектное решение с владельцем. Не удалять отрицательный тест и не увеличивать разрешения просто ради зелёного CI.
