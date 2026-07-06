import {
  pgTable, uuid, text, integer, timestamp, jsonb, uniqueIndex,
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
});

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
});
