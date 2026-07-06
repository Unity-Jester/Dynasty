import 'server-only';
import type { User } from '@supabase/supabase-js';
import { displayNameFromEmail } from '@/lib/auth/displayName';
import { getDb } from '@/server/db';
import { profiles } from '@/server/schema';

// Guarantees a profiles row exists for a just-authenticated user (profiles.id
// is 1:1 with auth.users.id). Idempotent: an existing row keeps its display
// name. Shared by the magic-link callback and the OTP-code action.
export async function ensureProfileForUser(user: User): Promise<void> {
  await getDb()
    .insert(profiles)
    .values({ id: user.id, displayName: displayNameFromEmail(user.email ?? '') })
    .onConflictDoNothing({ target: profiles.id });
}
