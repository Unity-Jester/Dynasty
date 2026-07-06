-- Custom SQL migration file, put your code below! --

-- No policies are defined here on purpose: the app talks to Postgres only
-- via the service-role/direct connection (DATABASE_URL), which bypasses RLS
-- entirely. Enabling RLS with zero policies attached means any future
-- anon/authenticated access through PostgREST/Supabase client libraries is
-- denied by default until a policy explicitly allows it.
alter table "profiles" enable row level security;
alter table "leagues" enable row level security;
alter table "seasons" enable row level security;
alter table "teams" enable row level security;
