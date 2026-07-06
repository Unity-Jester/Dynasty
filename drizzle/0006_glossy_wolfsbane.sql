CREATE TABLE "roster_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"player_id" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"acquired_via" text NOT NULL,
	"acquired_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roster_members" ADD CONSTRAINT "roster_members_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_members" ADD CONSTRAINT "roster_members_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_members" ADD CONSTRAINT "roster_members_player_id_players_sleeper_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("sleeper_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "roster_members_league_player_uq" ON "roster_members" USING btree ("league_id","player_id");--> statement-breakpoint
CREATE INDEX "roster_members_team_idx" ON "roster_members" USING btree ("team_id");