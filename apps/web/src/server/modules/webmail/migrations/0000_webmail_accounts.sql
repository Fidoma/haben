CREATE TABLE IF NOT EXISTS "webmail_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"imap_host" text NOT NULL,
	"imap_port" integer DEFAULT 993 NOT NULL,
	"imap_secure" boolean DEFAULT true NOT NULL,
	"imap_username" text NOT NULL,
	"smtp_host" text NOT NULL,
	"smtp_port" integer DEFAULT 587 NOT NULL,
	"smtp_secure" boolean DEFAULT false NOT NULL,
	"smtp_username" text NOT NULL,
	"ciphertext" "bytea" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'webmail_accounts_user_id_user_id_fk') THEN
		ALTER TABLE "webmail_accounts" ADD CONSTRAINT "webmail_accounts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "webmail_accounts_user_email" ON "webmail_accounts" USING btree ("user_id","email");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "webmail_accounts_user" ON "webmail_accounts" USING btree ("user_id");
