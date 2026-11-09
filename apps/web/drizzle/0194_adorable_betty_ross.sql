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
ALTER TABLE "pms_reservation_items" ADD COLUMN "dirty_processed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pms_rooms" ADD COLUMN "cleaning_status" text DEFAULT 'clean' NOT NULL;--> statement-breakpoint
ALTER TABLE "pms_tourism_country_values" ADD CONSTRAINT "pms_tourism_country_values_report_id_pms_tourism_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."pms_tourism_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pms_tourism_reports_period_unique" ON "pms_tourism_reports" USING btree ("year","month");