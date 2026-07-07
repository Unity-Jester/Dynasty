-- Custom SQL migration file, put your code below! --

-- Backfills waiver state for teams that already exist (today: the one
-- imported league's 12 teams) so Phase 7's waiver logic (Tasks 5-7) has
-- non-NULL values to read immediately. faab_remaining defaults to 500,
-- matching that league's settings.waivers.budget. waiver_priority is seeded
-- alphabetically by team name within each league — an arbitrary but
-- deterministic starting order; real leagues reorder it via standings once
-- a season completes.
--
-- Both statements are guarded by "IS NULL" so this migration is safe to run
-- more than once. This is a one-time data fix, not the steady-state path:
-- new leagues created after this migration get faab_remaining/waiver_priority
-- set at creation time by createLeague/import (Phase 7 Task 6). A team row
-- with NULL here is otherwise a normal, expected state — the lazy-init rule
-- documented on the teams table in src/server/schema.ts — until that code
-- runs for it.

update "teams"
set "faab_remaining" = 500
where "faab_remaining" is null;

with ranked as (
  select "id", row_number() over (partition by "league_id" order by "name") as rn
  from "teams"
  where "waiver_priority" is null
)
update "teams"
set "waiver_priority" = ranked.rn
from ranked
where "teams"."id" = ranked."id";