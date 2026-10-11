# Evidence будущей реализации

Структура: `<TASK-ID>/<YYYYMMDD-HHMM>-<run>/report.md`, рядом только относящиеся к проверке screenshots/logs/fixtures с удалёнными секретами. Commit/image/environment обязательны. Файлы реализации здесь не хранятся.

Отчёты есть не у каждой задачи: большинство карточек закрыто на доске по слитым PR и CI без отдельного отчёта (список — поле `done_without_report` в выводе `validate.py`). Сводные отчёты — `landing-build/` и `edu-build/`. Проверка структуры самой документации сохраняется отдельно в `_documentation/` и не закрывает ни одну implementation task.
