# ADR-004: центральный вход и refresh

Status: proposed, ID-03/04 должны заполнить технический выбор до реализации wire protocol.

Цель: id.outegro.dev, registered clients, exact redirects, short-lived one-time code, state/PKCE, BFF exchange, host-only cookies. Не хранить refresh в localStorage. Платформа использует один account с отдельными app sessions.

Сравнить проверенную protocol library с ограниченным собственным flow. Критерии: Nest/Node совместимость, session revocation, passkeys integration, maintenance и complexity. Не называть ограниченный flow OIDC без соответствия.

Refresh spike обязан задать атомарную ротацию, повтор потерянного ответа, concurrent callers, допустимое окно и настоящий reuse. Выбранная реализация должна пройти TC-ID-03-01…04 и TC-ID-04-01…04. До выбора не расширять grace timeout наугад и не отключать reuse detection.
