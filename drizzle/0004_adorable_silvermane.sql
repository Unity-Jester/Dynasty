CREATE TABLE "players" (
	"sleeper_id" text PRIMARY KEY NOT NULL,
	"full_name" text NOT NULL,
	"position" text NOT NULL,
	"nfl_team" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"injury_status" text,
	"years_exp" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "players_position_idx" ON "players" USING btree ("position");