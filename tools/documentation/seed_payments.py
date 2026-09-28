from seed_task_details import t

t('PAY-01','BE-04', 'Lava payment/subscription и refund/chargeback имеют разные payload. Свежий сохранённый контракт важнее старого README.',
'Прочитать snapshot OpenAPI и provider-unknowns register § Создать sanitized fixtures для каждого подтверждённого типа и отметить synthetic поля § Написать discriminated parser в adapter, сохраняющий raw reference отдельно § Зафиксировать mapping ID/amount/currency/period и неизвестные поля без guessed semantics',[
'Два формата | CamelCase payment и snake_case envelope refund | Parse оба fixtures | Правильные normalized types без потери source IDs',
'Unknown | Авторизованный новый event type | Parse | Unknown результат для quarantine, не crash/paid',
'Повреждённый | Amount/ID неверного типа | Parse | Явная schema error, финансового effect нет'])
t('PAY-02','BE-03 PAY-01', 'Цена берётся с сервера и сохраняется в заказе. После смены каталога история неизменна.',
'Создать Product/PriceVersion/Order/CheckoutAttempt/Payment и journal foundation § Реализовать exact minor-unit Money и currency metadata § Добавить уникальные provider/source keys и immutable price snapshot § Создать закрытый synthetic product для тестов; не публиковать выдуманный тариф',[
'Snapshot | Заказ по цене v1 | Создать v2 и прочитать старый заказ | Старый amount/currency/version не изменён',
'Деньги | Значения 0.10 и 0.20 как decimal strings | Нормализовать/суммировать | Exact 0.30, binary float не участвует',
'Constraints | Дублированный provider payment ID | Insert конкурентно | Уникальность на БД, не только pre-check'])
t('PAY-03','PAY-02 ID-04', 'Потерянный create-invoice response может скрывать успешно созданную внешнюю операцию.',
'Реализовать idempotency(user/action/key)+input fingerprint и state machine checkout § Создать order/attempt транзакционно; вызвать Lava вне DB transaction § Проверить returned URL origin и сохранить invoice mapping § При timeout записать unknown, запретить blind recreate и дать reconciliation path',[
'Повтор | Один user/price/key | Выполнить 2 параллельных checkout | Одна логическая attempt и согласованный ответ',
'Конфликт | Уже использованный key | Передать другой priceId | 409 IDEMPOTENCY_CONFLICT, provider не вызван',
'Timeout | Fake provider создал invoice и оборвал ответ | Повторить request | Состояние unknown, второго invoice нет',
'Подмена цены | Клиент прислал amount дешевле | Checkout | Backend использует PriceVersion либо отклоняет лишнее поле'])
t('PAY-04','PAY-01 BE-06', 'Webhook подтверждается только после надёжного приёма; неизвестное событие не следует молча выбрасывать.',
'Реализовать webhook auth configured Basic/X-Api-Key и body limits § Сохранить authorized raw/normalized inbox с transport/business dedupe keys § Вернуть 2xx после commit; worker обрабатывает отдельно § Unknown schema/type поместить в controlled quarantine, DB failure вернуть non2xx',[
'Auth | Неверный secret | Отправить valid-looking paid payload | Non2xx и zero financial effect',
'Durability | DB недоступна | Отправить авторизованное событие | Non2xx, ложного acknowledgement нет',
'Дубли | Payload меняет whitespace/property order | Отправить повторно | Business effect не дублируется независимо от raw hash',
'Unknown | Auth valid, новый type | Отправить | Durable quarantine и 2xx после записи'])
t('PAY-05','PAY-02 PAY-04 BE-05', 'Оплата, журнал и событие должны отражать один подтверждённый факт, даже при повторных webhooks.',
'Сопоставить invoice/payment с Order по trusted mapping § Проверить amount/currency и допустимый transition с version/lock § В одной транзакции сохранить Payment, immutable journal и outbox § Если mapping ещё нет, оставить unmatched для повторного сопоставления без выдачи прав',[
'Повтор | Paid fixture отправлен 10 раз | Process concurrently | Одна Payment confirmation и одна запись финансового effect',
'Mismatch | Order USD 1000, provider USD 900 или EUR 1000 | Process | Reconciliation issue, автоматического grant нет',
'Ранний webhook | Событие до create response mapping | Process и затем сохранить mapping | Событие не потеряно, применяется один раз после match',
'Старый failed | Paid уже подтверждён | Доставить поздний failed | Paid не отменён без проверенного нового факта'])
t('PAY-06','PAY-05 BE-04', 'Покупка и подписка дают отдельные источники доступа. Отмена одного не должна удалять остальные.',
'Создать CommercialGrant(sourceType/sourceId/feature) и authoritative access query § Привязать grant mutation к confirmed financial use case § Выпускать billing.grant.changed.v1 с aggregateVersion в той же transaction § Добавить revoke/expiry/rebuild без знания Identity DB',[
'Источники | Purchase и manual grant одного feature | Отозвать purchase grant | Manual source остаётся active',
'Idempotency | Один payment event повторяется | Create grant повторно | Один grant на source+feature, срок не растёт',
'Ordering | Grant active v1 затем revoked v2 | Replay v1 на authoritative command | v2 сохраняется, событие не откатывает state'])
t('PAY-07','PAY-05 PAY-06', 'Subscription, Payment и BillingPeriod различаются. Повтор recurrent webhook не означает ещё один месяц.',
'Создать Subscription root/child mapping, BillingPeriod и paidUntil derivation § Реализовать first/renew success и failed/past_due согласно state table § Источник периода брать из подтверждённого provider contract, не now+30 § Обновлять только источник соответствующего периода, сохраняя историю и версии',[
'Renew дубль | Один recurrent contract ID | Process дважды | Один BillingPeriod, paidUntil не продлён дважды',
'Поздний event | Period 2 подтверждён раньше старого failed | Process старый failed | Оплаченный period 2 не потерян',
'Root missing | Recurrent event без известного parent | Process | Unmatched issue, не новая случайная подписка',
'Expiry | Оплаченный срок закончился без renewal | Access check | Источник не даёт доступ независимо от cron'])
t('PAY-08','PAY-07 ID-04', 'Отмена продления не возвращает деньги и не стирает уже оплаченный срок.',
'Создать authenticated owner cancel command с idempotency и reason § Записать cancel_requested до provider вызова и отразить pending в UI model § Подтвердить cancelling по достоверному ответу/status и сохранить paidUntil § Timeout оставить проверяемым через reconcile, не показывать ложный success',[
'Cancel | Active subscription paidUntil в будущем | Подтвердить отмену | Auto-renew off, оплаченный доступ сохраняется',
'Повтор | Та же cancel command | Выполнить снова | Нет новой финансовой операции и повторного эффекта',
'Чужая | User A пытается отменить subscription B | Вызвать API | 403/404 по политике, provider не вызван',
'Timeout | Provider ответ потерян | Cancel и открыть UI | Pending cancellation и возможность сверки'])
t('PAY-09','PAY-04 PAY-05 PAY-06', 'Refund примеры не гарантируют однозначный invoice mapping; нельзя угадывать покупку по email+сумме.',
'Создать Refund/Dispute records с verified source или unmatched § Применять full/partial policy только к доказанной покупке/периоду § Сохранить компенсирующий journal и versioned source grant change § Для ручного match требовать evidence/reason/permission; API возврата не выдумывать',[
'Неоднозначность | Две одинаковые покупки одного email | Получить refund без invoice ID | Unmatched, ни одна покупка не выбрана случайно',
'Full refund | Refund точно связан с purchase A | Process дважды | Одна корректировка, отменён только grant A',
'Partial | Часть суммы без правила item mapping | Process | Review-required, нет массового отзыва всех прав',
'Dispute | Новый chargeback | Process | Case state отдельно от окончательного проигрыша/возврата'])
t('PAY-10','PAY-07 PAY-08 PAY-09', 'Reconciliation восстанавливает пропущенные факты и выявляет конфликт, а не просто ставит paid по кнопке.',
'Реализовать run/window/cursor/issue с resumable pagination и overlap § Запрашивать все нужные provider states явно и соблюдать rate limit § Сравнить invoices/periods/grants/journal; классифицировать расхождения § Автокоррекцию выполнять только через idempotent domain commands с evidence',[
'Пропуск webhook | Provider paid, local pending | Run reconcile | Подтверждённый факт обработан через обычный use case один раз',
'Pagination | 3 страницы, crash после второй | Resume job | Все записи пройдены, повтор overlap не даёт дублей',
'Конфликт | Amount/currency mismatch | Run | Issue открыт; деньги не исправлены произвольным UPDATE',
'Ограничение | Provider 429 | Run | Backoff/resume, нет busy loop и потери cursor'])
t('PAY-11','DS-05 PAY-03 PAY-07 PAY-08 PAY-09 ID-08', 'Pay web должен честно различать статус платежа, подписки и доступность функции.',
'Подключить checkout/result/history/subscriptions typed API § Показывать pending/unknown/paid/failed и отдельно grant activating § Реализовать cancel confirmation и refund case status без неподтверждённой кнопки automatic refund § Добавить empty catalog, EN/RU, ownership и polling с прекращением после terminal state',[
'Return spoof | URL success=true, payment pending | Открыть result | Доступ не выдан, показан backend pending',
'Пусто | Нет товаров и покупок | Открыть pay | Честный empty state без придуманного pricing',
'Чужой order | Подменён URL ID | Открыть страницу/API | Чужие суммы/данные не показаны',
'Grant lag | Payment paid, Identity ещё не обновлён | Открыть result | Отображается активация, после projection статус обновлён'])
t('PAY-12','PAY-10 PAY-11', 'Fixtures не доказывают поведение merchant. Эта задача отдельно подтверждает real-provider contract без скрытых трат.',
'Получить merchant capabilities/test mode и утверждённый сценарий проверки § Проверить create/read/events/cancel и реальные currency/period mappings § Зафиксировать redacted request/response IDs и расхождения с fixture § Разрешить sales flag только после закрытых критичных неизвестностей; при отсутствии sandbox реальные расходы требуют действующей авторизации',[
'Provider contract | Настроенный merchant/test scenario | Выполнить согласованную контрольную операцию | Provider IDs и локальная цепочка совпадают, evidence не содержит secrets',
'Отличие | Реальный payload отличается от fixture | Повторить parser test | Fixture исправлен с датой/источником, интеграционный тест проходит',
'Нет доступа | Merchant/test mode отсутствует | Проверить readiness | Статус blocked с точным input, fake не засчитан как real validation'],['LAVA-MERCHANT'])
