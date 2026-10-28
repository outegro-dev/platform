CREATE TABLE "chains" (
	"commit" text PRIMARY KEY NOT NULL,
	"public_seed" text NOT NULL,
	"length" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reveals" (
	"commit" text NOT NULL,
	"round" integer NOT NULL,
	"seed" text NOT NULL,
	"number" smallint NOT NULL,
	"revealed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "reveals_commit_round_pk" PRIMARY KEY("commit","round")
);
--> statement-breakpoint
ALTER TABLE "reveals" ADD CONSTRAINT "reveals_commit_chains_commit_fk" FOREIGN KEY ("commit") REFERENCES "public"."chains"("commit") ON DELETE no action ON UPDATE no action;