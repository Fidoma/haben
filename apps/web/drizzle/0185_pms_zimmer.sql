CREATE TABLE "pms_rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"capacity" smallint DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pms_rooms_number_length" CHECK (char_length("pms_rooms"."number") between 1 and 50),
	CONSTRAINT "pms_rooms_name_length" CHECK (char_length("pms_rooms"."name") <= 100),
	CONSTRAINT "pms_rooms_capacity" CHECK ("pms_rooms"."capacity" between 1 and 100)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pms_rooms_number_unique" ON "pms_rooms" USING btree (lower("number"));