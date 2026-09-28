# ADR-001: single-node и новые данные

Status: accepted, прямое требование владельца.

Один новый VPS 4 vCPU/8 ГБ/200 ГБ SSD, K3s на одном узле, только вертикальный рост. Старый сервер read-only reference. Новые PostgreSQL DB/users/keys, без миграции старых данных. Offsite bucket не считается вторым K3s node. Потеря узла означает downtime до восстановления.

Проверка: OPS-01 target guard, OPS-08 measured resource profile, OPS-07 restore. Не заменять требование предложением multi-node HA или постоянным staging на отдельном VPS.
