CREATE TABLE "pms_reservation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reservation_id" uuid NOT NULL,
	"position" smallint NOT NULL,
	"room_id" uuid NOT NULL,
	"arrival_date" date NOT NULL,
	"departure_date" date NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pms_reservation_items_position" CHECK ("pms_reservation_items"."position" between 1 and 100),
	CONSTRAINT "pms_reservation_items_period" CHECK ("pms_reservation_items"."departure_date" > "pms_reservation_items"."arrival_date"),
	CONSTRAINT "pms_reservation_items_description_length" CHECK (char_length("pms_reservation_items"."description") <= 2000)
);
--> statement-breakpoint
ALTER TABLE "pms_reservation_items" ADD CONSTRAINT "pms_reservation_items_reservation_id_pms_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."pms_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_reservation_items" ADD CONSTRAINT "pms_reservation_items_room_id_pms_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."pms_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pms_reservation_items_position_unique" ON "pms_reservation_items" USING btree ("reservation_id","position");--> statement-breakpoint
CREATE INDEX "pms_reservation_items_room_period" ON "pms_reservation_items" USING btree ("room_id","arrival_date","departure_date");