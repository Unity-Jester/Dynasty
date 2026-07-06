CREATE TABLE "pick_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"league_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"round" integer NOT NULL,
	"original_team_id" uuid NOT NULL,
	"current_team_id" uuid NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pick_assets" ADD CONSTRAINT "pick_assets_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_assets" ADD CONSTRAINT "pick_assets_original_team_id_teams_id_fk" FOREIGN KEY ("original_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pick_assets" ADD CONSTRAINT "pick_assets_current_team_id_teams_id_fk" FOREIGN KEY ("current_team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pick_assets_identity_uq" ON "pick_assets" USING btree ("league_id","season","round","original_team_id");--> statement-breakpoint
CREATE INDEX "pick_assets_current_team_idx" ON "pick_assets" USING btree ("current_team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leagues_sleeper_league_uq" ON "leagues" USING btree ("sleeper_league_id") WHERE "leagues"."sleeper_league_id" IS NOT NULL;