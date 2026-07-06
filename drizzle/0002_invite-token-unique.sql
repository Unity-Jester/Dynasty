-- Custom SQL migration file, put your code below! --
-- Partial unique index: invite tokens are single-use and must be globally
-- unique while active, but claimed teams have NULL tokens (many NULLs allowed).
CREATE UNIQUE INDEX "teams_invite_token_uq" ON "teams" ("invite_token") WHERE "invite_token" IS NOT NULL;