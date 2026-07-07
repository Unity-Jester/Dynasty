CREATE TABLE "nfl_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"nfl_team" text NOT NULL,
	"kickoff" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "nfl_games_team_week_uq" ON "nfl_games" USING btree ("season","week","nfl_team");--> statement-breakpoint
CREATE INDEX "nfl_games_season_week_idx" ON "nfl_games" USING btree ("season","week");