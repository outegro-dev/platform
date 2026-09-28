# Критерии перехода между этапами

## Gate 0: документация и workspace

BOOT-01…04 завершены. Новый корень независим, legacy manifest reviewed, frontend skeleton собирается, command map соответствует package.json. Сейчас эти работы только запланированы.

## Gate A: landing и DS

L-01…10, DS-01…05 с evidence. Принятые имя/домен/стиль, EN/RU, реальные контакты, честные projects, WebGL fallback, viewport/a11y и measured 3D. Backend начинается после Gate A по требованию владельца.

## Gate B: продуктовые сервисы

BE, ID, N, PAY, A и H обязательные задачи выполнены. Schema/permissions/payment replay/notification delivery/topic isolation/no-spend проверены. PAY-12 реальный provider contract отдельно. Если внешняя зависимость отсутствует, gate не становится pass молча: владелец может явно изменить release scope с выключенными продажами, при этом implementation report сохраняет unvalidated limitation.

## Gate C: эксплуатация

OPS-01…08. Один узел, реальные limits, внеузловой backup, restore/reconciliation rehearsal, logs/metrics/alerts и независимый uptime. Resource hypothesis заменена measured report. Падение единственного узла означает downtime, HA не обещается.

## Gate D: выпуск

R-01…03 доказаны на конкретном candidate commit/digest. Deployment target явно новый. R-04 release/smoke пройден, R-05 фиксирует baseline. Реальные финансовые операции/публикации выполняются только в авторизованном сценарии. Wallet gate существует отдельно, если владелец включит W scope.

## Gate NEXT

После R-05 можно составлять ТЗ Battleship. Не начинать реализацию игры на основании одной строки из текущего плана.
