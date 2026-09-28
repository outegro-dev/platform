# Hermes и личный каталог

## Routing и authorization

Ключ: botId/chatId/threadId. Topic displayName не служит ключом. До model/tool dispatch проверять exact owner userId и chatId, затем known topic binding. Не считать любого участника разрешённого chat владельцем. Anonymous sender не проходит owner check. Prompt инструкции — UX, backend tools всё равно проверяют owner/scope/version.

TopicBinding содержит topicKey, promptVersion, skill, allowedTools, storageScope. Первая тема — вещи на продажу. General — справка/status. Новая тема не наследует mutating tools автоматически. `/new` сбрасывает разговор, сохраняет rules/items. Общая memory/session search может пересекать темы: strict isolation требует scope enforcement или отдельного profile, а не одной строки в prompt.

## Typed tool contract

| Tool | Input | Output | Guard |
|---|---|---|---|
| create_item | source IDs, owner-supplied fields | itemId/version/state | owner+topic, unique source |
| attach_media | itemId, private object ref, source | mediaId/version | type/size/ownership |
| update_item | itemId, expectedVersion, field patch | saved version | allowed fields, conflict detection |
| find_items | bounded query/status | paginated own items | scope+owner |
| create_listing_draft | itemId/version, selected fields/media | draftId/version | private fields excluded |
| mark_reserved/sold | itemId/version, actual price optional | state/version | owner command |
| request_publish | draftId/version, target, commandId | intentId/state | allowed target + confirmation/rule |

Arbitrary SQL/shell не нужен для этих tools. Assistant-store API хранит данные в собственной logical PostgreSQL DB. Hermes memory/sessions остаются на своём PVC. Media — private storage; Telegram file reference не является вечным backup.

## Item state

Draft → needs_details → ready → listed → reserved → sold/archived. Разрешены ready→archived и reserved→listed при отмене договорённости. Автоматический sold по предположению модели запрещён. Item version увеличивается при каждом accepted mutation. Цена покупки, asking price и actual sale price отдельные значения/currencies. Unknown характеристики остаются suggestions до подтверждения.

## Durable ingest

Входящий update проверяется и сохраняется до model call. Source keys фиксируются durable; mediaGroup объединяет один album с ограниченным debounce. Два независимых сообщения не склеиваются в одну вещь только по близкому времени. При quota exhaustion сохраняются source/media/draft и `analysis_pending`. Сообщение «сохранено» только после commit. Проверить restart backlog policy конкретного Hermes adapter; если ack происходит до durable hook, доработать adapter либо честно ограничить гарантию.

## Publication state

Draft, approved, sending, sent, failed, unknown. Approval связан с draftVersion и destination. После lost send response `unknown` не превращается в blind retry. Если destination запрещает ботов, результат manual-ready с текстом и фото; userbot не входит в P0. Цена покупки и private notes не входят в public DTO.

## Subscription-only execution

Фиксированный openai-codex OAuth route после account spike; API-key route и paid fallback отсутствуют. Проверить vision, compression/title/review и tool calls. Не обещать, что все инструменты включены в Plus. 429/rate limit отличается от permanent quota: backoff bounded, quota_exhausted pause. Account credits/extra usage должны быть проверены отдельно. Если no-spend нельзя подтвердить, unattended execution остаётся выключен.
