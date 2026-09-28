# Checkpoint H-08/09: фото в каталог

## Пример входа

Owner в теме «Вещи»: «Покупал за 100 USD, хочу 80 USD, состояние хорошее», затем три фотографии одного mediaGroup. Значения synthetic. Требуемый результат — одна карточка Item, три private media, purchase и asking отдельно, ответ в той же теме.

## Обработка до модели

1. Проверить sender ownerId, chatId и registered threadId. Anonymous sender отклонить.
2. Извлечь source keys bot/chat/thread/message/update/mediaGroup и проверить durable duplicate.
3. Проверить media count/type/size. Создать source record с ingest state, чтобы retries продолжали один workflow.
4. Скачать допустимые media в private storage со streaming/size limit. Записать object key/hash/state; не загружать безлимитный blob в память.
5. Закрыть album по bounded debounce с правилами позднего дополнения. Не считать два отдельных сообщения одним album без mediaGroup/reply context.
6. Создать Item draft и связь media/source в transaction. Двухфазный object storage workflow учитывает orphan objects и retry; cleanup удаляет только доказанно неиспользуемые objects после grace.
7. Ответить «сохранено, item ID …» после commit. До commit допустим статус «получаю», но не ложное подтверждение сохранности.

## Обработка моделью

8. Проверить subscription route/quota и запустить только разрешённый vision tool.
9. Сохранить предположения модели отдельно от owner-supplied values. Невидимую характеристику не подтверждать автоматически.
10. Применить явные цена/валюта/состояние из текста владельца по structured validation. Если валюта отсутствует, спросить либо использовать ранее явно установленный owner default, не геолокационную догадку.
11. Дать короткую карточку и список недостающего. Следующее reply редактирует itemId исходного сообщения.
12. При quota/auth error оставить analysis_pending и сохранённые исходники, не запускать paid model.

## Идемпотентность и восстановление

Repeat update не создаёт новый item. Album arrival после restart продолжает тот же ingest. Source и item linkage durable. Telegram acknowledgement policy конкретного adapter проверяется отдельно: in-memory dedup недостаточен. Если framework забирает updates раньше custom durable hook, нужен adapter change до обещания сохранения при crash.

## Приёмка

Проверить один album, два разных предмета подряд, duplicate update, crash после source до media, crash после media до Item transaction, quota exhaustion, wrong owner, wrong topic и concurrent edit version. Считать не только replies, но и DB counts/object references. Публичный draft не содержит purchaseAmount.
