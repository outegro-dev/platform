# Открытые входные данные

Они не мешают подготовке документации. При реализации блокируют только перечисленные проверки. Секреты передавать через выбранное защищённое хранилище/локальную авторизацию, не вставлять в task report.

| ID | Что нужно | Default до получения | Зависимые задачи |
|---|---|---|---|
| DEVICE-MATRIX | Компьютер/телефон/браузеры для 60-FPS приёмки | Prototype/lab допустим, real-device pass не ставить | L-05/10 |
| PUBLIC-CONTACTS | Email/GitHub/LinkedIn/Telegram для сайта | Content placeholders только internal | L-09 |
| GOOGLE-OAUTH | Новый OAuth client/redirect registration | Fake provider в tests | ID-02 |
| EMAIL-PROVIDER | Provider/domain sender/test mailbox | Local test inbox | N-02 |
| PLATFORM-TELEGRAM | Bot для уведомлений пользователей | Fake Telegram adapter | N-04 |
| LAVA-MERCHANT | Merchant capabilities/test scenario/валюты | Продажи выключены | PAY-12 |
| VPS-DNS | Новый VPS, SSH fingerprint/key, DNS zone | Local rehearsal | OPS-01 |
| BACKUP-STORAGE | Private bucket/credentials/recovery key custody | Только test bucket | OPS-06 |
| OPS-ALERTS | Owner alert channel + external uptime | Local alert sink, не production acceptance | OPS-05 |
| CHATGPT-OAUTH | Личный вход Plus и billing controls | Никаких paid API keys | H-01/03/05 |
| HERMES-TELEGRAM | Bot token, owner userId, chat/topic IDs | Не регистрировать неизвестного owner автоматически | H-04/07 |
| MARKETPLACE-TARGET | Destination и разрешение bot posting | Draft/manual-ready | H-10 |
| WALLET-DECISION | Нужен ли кошелёк в первом выпуске, merchant support | Wallet выключен, W deferred | W-01…06 |
| DEPLOYMENT-AUTHORIZATION | Конкретное поручение выпустить готовый candidate на новый target | Только manifests/rehearsal | R-04 |

Подписка ChatGPT Plus, личный характер Hermes, group topics и сценарий вещей уже подтверждены. Не спрашивать их заново. Не нужны сейчас подробная биография, перенос старых баз и ТЗ игры.

Тарифы/товары можно определить позднее: механизм subscriptions строится, публичный каталог остаётся закрытым. Отдельное решение о sales activation фиксируется до реальной продажи, не выдумывается моделью.
