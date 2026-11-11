CREATE TABLE "pms_reservation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"room_id" uuid NOT NULL,
	"article_id" uuid,
	"unit_price" integer DEFAULT 0 NOT NULL,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pms_reservation_items_position" CHECK ("pms_reservation_items"."position" between 1 and 100),
	CONSTRAINT "pms_reservation_items_period" CHECK ("pms_reservation_items"."departure_date" > "pms_reservation_items"."arrival_date"),
	CONSTRAINT "pms_reservation_items_description_length" CHECK (char_length("pms_reservation_items"."description") <= 2000),
	CONSTRAINT "pms_reservation_items_unit_price" CHECK ("pms_reservation_items"."unit_price" between 0 and 999999999)
);
--> statement-breakpoint
CREATE TABLE "pms_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"invoice_id" uuid,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "pms_reservations_invoice_id_unique" UNIQUE("invoice_id"),
	CONSTRAINT "pms_reservations_period" CHECK ("pms_reservations"."departure_date" > "pms_reservations"."arrival_date"),
	CONSTRAINT "pms_reservations_note_length" CHECK (char_length("pms_reservations"."note") <= 2000),
	CONSTRAINT "pms_reservations_status" CHECK ("pms_reservations"."status" in ('confirmed', 'canceled')),
	CONSTRAINT "pms_reservations_canceled_at" CHECK (("pms_reservations"."status" = 'confirmed' and "pms_reservations"."canceled_at" is null) or ("pms_reservations"."status" = 'canceled' and "pms_reservations"."canceled_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "pms_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"capacity" smallint DEFAULT 1 NOT NULL,
	"cleaning_status" text DEFAULT 'clean' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pms_rooms_number_length" CHECK (char_length("pms_rooms"."number") between 1 and 50),
	CONSTRAINT "pms_rooms_name_length" CHECK (char_length("pms_rooms"."name") <= 100),
	CONSTRAINT "pms_rooms_capacity" CHECK ("pms_rooms"."capacity" between 1 and 100),
	CONSTRAINT "pms_rooms_cleaning_status" CHECK ("pms_rooms"."cleaning_status" in ('clean', 'dirty'))
);
--> statement-breakpoint
CREATE TABLE "pms_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_article_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pms_settings_single_row" CHECK ("pms_settings"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "pms_tourism_country_values" (
	"report_id" uuid NOT NULL,
	"country_key" text NOT NULL,
	"arrivals" integer DEFAULT 0 NOT NULL,
	"overnight_stays" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "pms_tourism_country_values_report_id_country_key_pk" PRIMARY KEY("report_id","country_key"),
	CONSTRAINT "pms_tourism_country_values_key" CHECK (char_length("pms_tourism_country_values"."country_key") between 1 and 50),
	CONSTRAINT "pms_tourism_country_values_amounts" CHECK ("pms_tourism_country_values"."arrivals" >= 0 and "pms_tourism_country_values"."overnight_stays" >= "pms_tourism_country_values"."arrivals")
);
--> statement-breakpoint
CREATE TABLE "pms_tourism_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"year" smallint NOT NULL,
	"month" smallint NOT NULL,
	"beds_offered" integer DEFAULT 0 NOT NULL,
	"available_guest_room_days" integer DEFAULT 0 NOT NULL,
	"occupied_guest_room_days" integer DEFAULT 0 NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pms_tourism_reports_year" CHECK ("pms_tourism_reports"."year" between 2000 and 2200),
	CONSTRAINT "pms_tourism_reports_month" CHECK ("pms_tourism_reports"."month" between 1 and 12),
	CONSTRAINT "pms_tourism_reports_values" CHECK ("pms_tourism_reports"."beds_offered" >= 0 and "pms_tourism_reports"."available_guest_room_days" >= 0 and "pms_tourism_reports"."occupied_guest_room_days" >= 0),
	CONSTRAINT "pms_tourism_reports_remarks" CHECK (char_length("pms_tourism_reports"."remarks") <= 1000)
);
--> statement-breakpoint
ALTER TABLE "pms_reservation_items" ADD CONSTRAINT "pms_reservation_items_reservation_id_pms_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."pms_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_reservation_items" ADD CONSTRAINT "pms_reservation_items_room_id_pms_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."pms_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_reservation_items" ADD CONSTRAINT "pms_reservation_items_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_reservations" ADD CONSTRAINT "pms_reservations_room_id_pms_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."pms_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_reservations" ADD CONSTRAINT "pms_reservations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_reservations" ADD CONSTRAINT "pms_reservations_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_settings" ADD CONSTRAINT "pms_settings_default_article_id_articles_id_fk" FOREIGN KEY ("default_article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_tourism_country_values" ADD CONSTRAINT "pms_tourism_country_values_report_id_pms_tourism_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."pms_tourism_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pms_reservation_items_position_unique" ON "pms_reservation_items" USING btree ("reservation_id","position");--> statement-breakpoint
CREATE INDEX "pms_reservation_items_room_period" ON "pms_reservation_items" USING btree ("room_id","arrival_date","departure_date");--> statement-breakpoint
CREATE INDEX "pms_reservations_room_period" ON "pms_reservations" USING btree ("room_id","arrival_date","departure_date");--> statement-breakpoint
CREATE INDEX "pms_reservations_contact" ON "pms_reservations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "pms_reservations_status" ON "pms_reservations" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pms_rooms_number_unique" ON "pms_rooms" USING btree (lower("number"));--> statement-breakpoint
CREATE UNIQUE INDEX "pms_tourism_reports_period_unique" ON "pms_tourism_reports" USING btree ("year","month");