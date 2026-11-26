ALTER TABLE "quotes" ADD COLUMN "external_source" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "external_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "quotes_external_ref" ON "quotes" USING btree ("external_source","external_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_external_ref_pair" CHECK (("quotes"."external_source" is null) = ("quotes"."external_id" is null));