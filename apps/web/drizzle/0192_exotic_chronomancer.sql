ALTER TABLE "pms_reservation_items" ADD COLUMN "article_id" uuid;--> statement-breakpoint
ALTER TABLE "pms_reservation_items" ADD COLUMN "unit_price" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "pms_reservation_items" ADD CONSTRAINT "pms_reservation_items_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pms_reservation_items" ADD CONSTRAINT "pms_reservation_items_unit_price" CHECK ("pms_reservation_items"."unit_price" between 0 and 999999999);