CREATE TABLE "pms_settings" (
	"id" smallint PRIMARY KEY DEFAULT 1 NOT NULL,
	"default_article_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pms_settings_single_row" CHECK ("pms_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE "pms_settings" ADD CONSTRAINT "pms_settings_default_article_id_articles_id_fk" FOREIGN KEY ("default_article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;