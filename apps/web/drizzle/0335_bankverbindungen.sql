CREATE TABLE "bankverbindungen" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bezeichnung" text NOT NULL,
	"iban" text NOT NULL,
	"bic" text DEFAULT '' NOT NULL,
	"bank" text DEFAULT '' NOT NULL,
	"kontoinhaber" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "bankverbindung_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "bankverbindung_id" uuid;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "bankverbindung_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "bankverbindungen_iban" ON "bankverbindungen" USING btree ("iban");--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_bankverbindung_id_bankverbindungen_id_fk" FOREIGN KEY ("bankverbindung_id") REFERENCES "public"."bankverbindungen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bankverbindung_id_bankverbindungen_id_fk" FOREIGN KEY ("bankverbindung_id") REFERENCES "public"."bankverbindungen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_bankverbindung_id_bankverbindungen_id_fk" FOREIGN KEY ("bankverbindung_id") REFERENCES "public"."bankverbindungen"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_bankverbindung_entwurf" CHECK ("invoices"."status" = 'draft' or "invoices"."bankverbindung_id" is null);--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_bankverbindung_entwurf" CHECK ("quotes"."status" = 'draft' or "quotes"."bankverbindung_id" is null);