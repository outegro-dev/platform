# Утилиты документации

- `validate.py` — проверка local links, карточек, статусов, TC IDs и графа зависимостей. Read-only, stdout JSON, exit 0 при успехе.
- `task_context.py TASK-ID [--bundle]` — context packet одной задачи. Read-only; лимит размера останавливает вывод, а не обрезает инструкции молча.
- `sync_specification.py` — пересобирает только derived полный документ из canonical chapters.
- `build_initial_plan.py` и `seed_*.py` — одноразовый источник первичной генерации v0.3. Повторный запуск блокируется при существующем task-index. Не использовать для обновления карточек после начала работ.

Canonical sources: task Markdown для текста, task-index.json для metadata/dependencies/status; менять связанные поля вместе. Сводный test-catalog — индекс, подробный scenario в карточке. Stage README содержит navigation/status snapshot: при смене статуса обновить строку. Spec chapters — canonical предметный текст, portfolio-plan.md derived.

Рабочие команды из корня:

```text
python tools/documentation/validate.py
python tools/documentation/task_context.py PAY-03 --bundle
python tools/documentation/sync_specification.py
```

Python 3.10+ и стандартная библиотека. Это не application test suite и не task executor. Скрипты не устанавливают зависимости и не подключаются к внешним сервисам.
