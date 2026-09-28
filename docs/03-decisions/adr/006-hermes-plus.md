# ADR-006: личный Hermes

Status: цель accepted, provider runtime proposed до H-01/05.

Один Hermes gateway в K3s, private group topics, только owner. Default-кандидат Hermes loop + openai-codex OAuth; app-server вариант, если нужные tools совместимы. Выбор не меняется молча при ошибке. Подписка Plus подтверждена владельцем, включённые модели/limits/billing controls конкретного аккаунта ещё проверяются.

Ноль дополнительных AI/tool расходов: paid fallback отсутствует, auxiliary маршруты проверяются, quota stop обязателен, extra credits контролируются отдельно. Каталог структурированный в assistant-store, photos private. Topic prompts не являются security boundary. Никакого production kubeconfig или payment/auth secrets в tools.
