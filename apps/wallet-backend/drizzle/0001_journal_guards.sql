-- The second legs of grumbles operations (ADR-011). With all wallets of
-- the unit they sum to zero; every operation moves one of them.
INSERT INTO "system_accounts" ("code", "unit", "balance", "updated_at") VALUES
	('issued_bonus', 'GRM', 0, now()),
	('issued_purchase', 'GRM', 0, now()),
	('spent', 'GRM', 0, now()),
	('adjust', 'GRM', 0, now()),
	('expired', 'GRM', 0, now())
ON CONFLICT DO NOTHING;
--> statement-breakpoint
-- The journal only grows: a correction is a new operation. The trigger
-- refuses changes for every role, the database owner included.
CREATE FUNCTION "wallet_tx_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
	RAISE EXCEPTION 'wallet_tx is append-only: % refused', TG_OP
		USING ERRCODE = 'insufficient_privilege';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "wallet_tx_no_change" BEFORE UPDATE OR DELETE ON "wallet_tx"
	FOR EACH ROW EXECUTE FUNCTION "wallet_tx_append_only"();
--> statement-breakpoint
CREATE TRIGGER "wallet_tx_no_truncate" BEFORE TRUNCATE ON "wallet_tx"
	FOR EACH STATEMENT EXECUTE FUNCTION "wallet_tx_append_only"();
--> statement-breakpoint
-- The service runs as the owner of its database (one role per service,
-- INV-23), so the privileges come off that role itself. Idempotency keys
-- and the operators' audit are insert-only as well.
REVOKE UPDATE, DELETE, TRUNCATE ON "wallet_tx" FROM CURRENT_USER;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "wallet_refs" FROM CURRENT_USER;
--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_log" FROM CURRENT_USER;
