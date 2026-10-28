ALTER TABLE "orders" ADD COLUMN "grumbles" bigint;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "grumbles" bigint;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_pack_grumbles" CHECK (("orders"."kind" = 'grumble_pack') = ("orders"."grumbles" is not null and "orders"."grumbles" > 0));--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_pack_grumbles" CHECK (("products"."kind" = 'grumble_pack') = ("products"."grumbles" is not null and "products"."grumbles" > 0));