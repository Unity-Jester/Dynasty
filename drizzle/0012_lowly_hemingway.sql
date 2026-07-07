CREATE TABLE "matchups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"home_team_id" uuid NOT NULL,
	"away_team_id" uuid NOT NULL,
	"home_points" numeric,
	"away_points" numeric,
	"final" boolean DEFAULT false NOT NULL,
	CONSTRAINT "matchups_home_away_distinct_ck" CHECK ("matchups"."home_team_id" <> "matchups"."away_team_id")
);
--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_home_team_id_teams_id_fk" FOREIGN KEY ("home_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matchups" ADD CONSTRAINT "matchups_away_team_id_teams_id_fk" FOREIGN KEY ("away_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "matchups_home_week_uq" ON "matchups" USING btree ("league_id","season","week","home_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "matchups_away_week_uq" ON "matchups" USING btree ("league_id","season","week","away_team_id");--> statement-breakpoint
CREATE INDEX "matchups_league_week_idx" ON "matchups" USING btree ("league_id","season","week");