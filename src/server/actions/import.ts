'use server';

import { z } from 'zod';
import { createSupabaseServerClient } from '@/server/supabase';
import { firstZodIssueMessage } from '@/engine/zodIssue';
import { runSleeperImport, type ImportResult } from '@/server/import/sleeperImport';

// Sleeper league ids are numeric strings; cap the length to keep the id a sane
// path segment for the fetchers. Full document parse at the trust boundary.
const ImportInput = z.object({
  sleeperLeagueId: z.string().regex(/^\d+$/, 'Sleeper league id must be numeric').max(30),
  mode: z.enum(['dry_run', 'execute']),
});

// The action's own transport-level failures unioned with the orchestrator's
// result — the Task 6 UI branches on every variant.
export type ImportActionResult =
  | ImportResult
  | { ok: false; error: 'invalid_input' | 'unauthenticated'; detail?: string };

async function getAuthedUserId(): Promise<string | null> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

export async function importSleeperLeague(input: unknown): Promise<ImportActionResult> {
  const parsed = ImportInput.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid_input', detail: firstZodIssueMessage(parsed.error) };
  }

  const userId = await getAuthedUserId();
  if (!userId) {
    return { ok: false, error: 'unauthenticated' };
  }

  return runSleeperImport(parsed.data.sleeperLeagueId, parsed.data.mode, userId);
}
