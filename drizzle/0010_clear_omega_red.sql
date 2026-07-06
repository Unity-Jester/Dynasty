CREATE TABLE "stat_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"player_id" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"stats" jsonb NOT NULL,
	"source" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stat_lines" ADD CONSTRAINT "stat_lines_player_id_players_sleeper_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("sleeper_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stat_lines_player_week_uq" ON "stat_lines" USING btree ("player_id","season","week");--> statement-breakpoint
CREATE INDEX "stat_lines_season_week_idx" ON "stat_lines" USING btree ("season","week");