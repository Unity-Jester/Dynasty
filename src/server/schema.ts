import { sql } from 'drizzle-orm';
import {
  pgTable, uuid, text, integer, timestamp, jsonb, uniqueIndex, index, numeric, boolean, check,
} from 'drizzle-orm/pg-core';

// Mirrors Supabase auth.users (1:1); rows created by a claim/signup action.
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(), // = auth.users.id
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const leagues = pgTable('leagues', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  status: text('status', { enum: ['setup', 'active', 'archived'] }).notNull().default('setup'),
  createdBy: uuid('created_by').notNull().references(() => profiles.id),
  sleeperLeagueId: text('sleeper_league_id'), // set when imported
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // A Sleeper league can only be imported into one Dynasty league — this is
  // idempotency-as-invariant, making re-importing the same league a DB-level
  // impossibility rather than an application-level check. Partial index
  // because most rows (native, non-imported leagues) have a NULL here.
  uniqueIndex('leagues_sleeper_league_uq')
    .on(t.sleeperLeagueId)
    .where(sql`${t.sleeperLeagueId} IS NOT NULL`),
]);

export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  year: integer('year').notNull(),
  phase: text('phase', {
    enum: ['offseason', 'regular', 'playoffs', 'complete'],
  }).notNull().default('offseason'),
  currentWeek: integer('current_week').notNull().default(0),
  // zod-validated LeagueSettings document; parse on every read (Rule 5).
  settings: jsonb('settings').notNull(),
}, (t) => [
  // drizzle-kit 0.31 / drizzle-orm 0.45 expect the extras callback to return
  // an array of PgTableExtraConfigValue, not the older `{ name: ... }` object.
  uniqueIndex('seasons_league_year_uq').on(t.leagueId, t.year),
]);

export const teams = pgTable('teams', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  name: text('name').notNull(),
  ownerId: uuid('owner_id').references(() => profiles.id), // null until claimed
  inviteToken: text('invite_token'), // single-use claim token
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Active invite tokens must be globally unique; claimed teams have NULL
  // tokens, so this is a partial index (0002_invite-token-unique.sql).
  uniqueIndex('teams_invite_token_uq')
    .on(t.inviteToken)
    .where(sql`${t.inviteToken} IS NOT NULL`),
  // One franchise per owner per league. This is the real invariant behind
  // claimTeam's user_has_team rule — the action's pre-read count is advisory
  // UX only; concurrent claims are settled here (0003_one-team-per-owner.sql).
  uniqueIndex('teams_league_owner_uq')
    .on(t.leagueId, t.ownerId)
    .where(sql`${t.ownerId} IS NOT NULL`),
]);

// NFL player universe, synced daily from Sleeper (/api/jobs/sync-players).
// sleeper_id is the natural PK — it's the join key for stats, rosters, and
// the Phase 3 importer alike.
export const players = pgTable('players', {
  sleeperId: text('sleeper_id').primaryKey(),
  fullName: text('full_name').notNull(),
  position: text('position').notNull(), // QB/RB/WR/TE/K/DEF — filtered at sync time
  nflTeam: text('nfl_team'), // null = free agent
  status: text('status').notNull().default('unknown'), // Active/Injured Reserve/...
  injuryStatus: text('injury_status'),
  yearsExp: integer('years_exp'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('players_position_idx').on(t.position),
]);

// A player's membership on a team. leagueId is deliberately denormalized from
// teams so the DB itself can enforce "one player per league" — the same
// index-as-invariant pattern as teams_league_owner_uq.
export const rosterMembers = pgTable('roster_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  playerId: text('player_id').notNull().references(() => players.sleeperId),
  status: text('status', { enum: ['active', 'taxi', 'ir'] }).notNull().default('active'),
  acquiredVia: text('acquired_via', {
    enum: ['import', 'draft', 'waiver', 'free_agent', 'trade', 'commish'],
  }).notNull(),
  acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('roster_members_league_player_uq').on(t.leagueId, t.playerId),
  index('roster_members_team_idx').on(t.teamId),
]);

// Tradeable future rookie picks. The full base is materialized at import
// (every team owns its own next-3-years picks); trades reassign currentTeamId.
export const pickAssets = pgTable('pick_assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  season: integer('season').notNull(), // draft year, e.g. 2027
  round: integer('round').notNull(),
  originalTeamId: uuid('original_team_id').notNull().references(() => teams.id),
  currentTeamId: uuid('current_team_id').notNull().references(() => teams.id),
}, (t) => [
  // One asset per (league, year, round, original owner) — the pick's identity.
  uniqueIndex('pick_assets_identity_uq').on(t.leagueId, t.season, t.round, t.originalTeamId),
  index('pick_assets_current_team_idx').on(t.currentTeamId),
]);

// One row per player-week. `stats` is the raw numeric map from the source;
// scoring reads keys per-league at compute time. source='nflverse' rows are
// corrections and are never overwritten by Sleeper polls.
export const statLines = pgTable('stat_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  playerId: text('player_id').notNull().references(() => players.sleeperId),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  stats: jsonb('stats').notNull(),
  source: text('source', { enum: ['sleeper', 'nflverse'] }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('stat_lines_player_week_uq').on(t.playerId, t.season, t.week),
  index('stat_lines_season_week_idx').on(t.season, t.week),
]);

// One row per pairing per week. Points are filled by the Phase 6 scoreWeek
// job once lineups exist; null until then. final=true freezes the result.
export const matchups = pgTable('matchups', {
  id: uuid('id').primaryKey().defaultRandom(),
  leagueId: uuid('league_id').notNull().references(() => leagues.id),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  homeTeamId: uuid('home_team_id').notNull().references(() => teams.id),
  awayTeamId: uuid('away_team_id').notNull().references(() => teams.id),
  // Drizzle surfaces `numeric` as string|null in TS: the Phase 6 scoreWeek
  // writer must store clean 2dp strings (roundPoints(...).toFixed(2)) and
  // standings math must Number()-parse on read.
  homePoints: numeric('home_points'),
  awayPoints: numeric('away_points'),
  final: boolean('final').notNull().default(false),
}, (t) => [
  // These two uniqueness guards ensure a team appears at most once per week
  // on each SIDE (home or away) — they do NOT block a team from being home
  // in one row and away in another the same week. That cross-side collision
  // is prevented elsewhere: the schedule generator's engine invariants never
  // produce it, and Task 6's create-matchup action asserts home != away per
  // row. The CHECK below covers the one thing indexes can't: a row pairing
  // a team against itself.
  uniqueIndex('matchups_home_week_uq').on(t.leagueId, t.season, t.week, t.homeTeamId),
  uniqueIndex('matchups_away_week_uq').on(t.leagueId, t.season, t.week, t.awayTeamId),
  index('matchups_league_week_idx').on(t.leagueId, t.season, t.week),
  check('matchups_home_away_distinct_ck', sql`${t.homeTeamId} <> ${t.awayTeamId}`),
]);

// One row per starter-slot instance per team-week. playerId null = empty slot.
// The partial unique index is the "player starts at most once" invariant.
export const lineupSlots = pgTable('lineup_slots', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamId: uuid('team_id').notNull().references(() => teams.id),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  slot: text('slot').notNull(),
  slotIndex: integer('slot_index').notNull(),
  playerId: text('player_id').references(() => players.sleeperId),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('lineup_slots_instance_uq').on(t.teamId, t.season, t.week, t.slot, t.slotIndex),
  uniqueIndex('lineup_slots_player_uq').on(t.teamId, t.season, t.week, t.playerId).where(sql`${t.playerId} IS NOT NULL`),
  index('lineup_slots_team_week_idx').on(t.teamId, t.season, t.week),
]);

// One row per NFL team per game: kickoff drives per-player lineup locks.
// Kickoffs are stored UTC; source gametime is US/Eastern (converted at ingest).
export const nflGames = pgTable('nfl_games', {
  id: uuid('id').primaryKey().defaultRandom(),
  season: integer('season').notNull(),
  week: integer('week').notNull(),
  nflTeam: text('nfl_team').notNull(),
  kickoff: timestamp('kickoff', { withTimezone: true }).notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('nfl_games_team_week_uq').on(t.season, t.week, t.nflTeam),
  index('nfl_games_season_week_idx').on(t.season, t.week),
]);
