CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "faab_remaining" integer;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "waiver_priority" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_created_by_profiles_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_league_status_idx" ON "transactions" USING btree ("league_id","status");--> statement-breakpoint
CREATE INDEX "transactions_league_created_idx" ON "transactions" USING btree ("league_id","created_at");