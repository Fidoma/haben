CREATE TABLE "pms_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"room_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"canceled_at" timestamp with time zone,
	CONSTRAINT "pms_reservations_period" CHECK ("pms_reservations"."departure_date" > "pms_reservations"."arrival_date"),
	CONSTRAINT "pms_reservations_note_length" CHECK (char_length("pms_reservations"."note") <= 2000),
	CONSTRAINT "pms_reservations_status" CHECK ("pms_reservations"."status" in ('confirmed', 'canceled')),
	CONSTRAINT "pms_reservations_canceled_at" CHECK (("pms_reservations"."status" = 'confirmed' and "pms_reservations"."canceled_at" is null) or ("pms_reservations"."status" = 'canceled' and "pms_reservations"."canceled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "pms_reservations" ADD CONSTRAINT "pms_reservations_room_id_pms_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."pms_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_reservations" ADD CONSTRAINT "pms_reservations_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pms_reservations_room_period" ON "pms_reservations" USING btree ("room_id","arrival_date","departure_date");--> statement-breakpoint
CREATE INDEX "pms_reservations_contact" ON "pms_reservations" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "pms_reservations_status" ON "pms_reservations" USING btree ("status");