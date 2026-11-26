CREATE TABLE "psp_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"name" text NOT NULL,
	"bank_account_id" uuid,
	"account_id" text NOT NULL,
	"key_hint" text DEFAULT '' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"zugang_gueltig_bis" timestamp with time zone,
	"fetch_from" date NOT NULL,
	"abruf_start" date NOT NULL,
	"rhythmus" text DEFAULT 'taeglich' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psp_connections_provider" CHECK ("psp_connections"."provider" ~ '^[a-z][a-z0-9]*$'),
	CONSTRAINT "psp_connections_rhythmus" CHECK ("psp_connections"."rhythmus" in ('stuendlich', 'taeglich', 'woechentlich'))
);
--> statement-breakpoint
ALTER TABLE "psp_connections" ADD CONSTRAINT "psp_connections_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "psp_connections_konto_beim_anbieter" ON "psp_connections" USING btree ("provider","account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "psp_connections_konto" ON "psp_connections" USING btree ("bank_account_id");