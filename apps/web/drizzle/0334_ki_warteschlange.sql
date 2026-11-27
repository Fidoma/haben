ALTER TYPE "public"."extraction_status" ADD VALUE 'wartet';--> statement-breakpoint
CREATE SEQUENCE "public"."documents_extraction_queue_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "extraction_paused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "extraction_max_tokens_per_request" integer;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "extraction_requests_per_minute" integer;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "extraction_tokens_per_minute" integer;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "extraction_max_parallel" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "extraction_queue_position" bigint;--> statement-breakpoint
CREATE INDEX "documents_extraction_queue_idx" ON "documents" USING btree ("extraction_queue_position") WHERE "documents"."extraction_queue_position" is not null;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_extraction_max_parallel" CHECK ("company"."extraction_max_parallel" between 1 and 20);--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_extraction_limits" CHECK (coalesce("company"."extraction_max_tokens_per_request", 1) > 0 and coalesce("company"."extraction_requests_per_minute", 1) > 0 and coalesce("company"."extraction_tokens_per_minute", 1) > 0);