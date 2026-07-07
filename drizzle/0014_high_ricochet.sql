CREATE TABLE "lineup_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"team_id" uuid NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"slot" text NOT NULL,
	"slot_index" integer NOT NULL,
	"player_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "lineup_slots" ADD CONSTRAINT "lineup_slots_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lineup_slots" ADD CONSTRAINT "lineup_slots_player_id_players_sleeper_id_fk" FOREIGN KEY ("player_id") REFERENCES "public"."players"("sleeper_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_slots_instance_uq" ON "lineup_slots" USING btree ("team_id","season","week","slot","slot_index");--> statement-breakpoint
CREATE UNIQUE INDEX "lineup_slots_player_uq" ON "lineup_slots" USING btree ("team_id","season","week","player_id") WHERE "lineup_slots"."player_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "lineup_slots_team_week_idx" ON "lineup_slots" USING btree ("team_id","season","week");