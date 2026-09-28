# Hermes: quota, OAuth, intake и публикация

## Quota exhausted

Зафиксировать provider route и status, остановить новые model turns. Проверить, что media/source/item drafts уже durable. Отправить status владельцу без LLM. Проверить reset/available usage только через достоверный account signal. Возобновить по принятой policy; не добавлять API key/другой платный provider. Вспомогательные вызовы тоже остаются выключенными/ограниченными.

## Auth required

Проверить private auth state permissions/PVC и отсутствие второго gateway. Владелец повторяет официальный device/browser login. Не пересылать refresh token в чат. При restore старый token может быть отозван; повторный OAuth нормален.

## Фото не попало в карточку

Найти exact updateId/chatId/threadId/messageId/mediaGroupId. Проверить durable source и media status до model logs. Проверить owner/topic gate и backlog policy. Если source сохранён, повторить обработку с тем же command key. Если сохранения не было, не утверждать, что фото получено; попросить повтор только после установления факта потери. Цена/характеристики не восстанавливаются из догадки.

## Publication unknown

Проверить draftVersion/target, saved Telegram message IDs и фактическое состояние канала доступным read path. Пока результат неизвестен, не повторять send автоматически. Если бот не имеет доступа destination, сохранить manual-ready draft. Не подключать userbot как скрытый обход.

## Возврат к работе

Контрольный item workflow в исходном topic, owner gate, no-spend routing, media и report. Не раскрывать содержимое всех личных topics в общие observability logs.
