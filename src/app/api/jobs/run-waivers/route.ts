import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { invariant } from '@/lib/invariant';
import { runWaivers } from '@/server/jobs/runWaivers';

// 60s covers the whole-slate path: bounded reads + one transaction per league,
// capped at MAX_LEAGUES_PER_RUN. Raise per the hosting ceiling if the pending
// league count ever approaches that cap with large claim slates.
export const maxDuration = 60;

// Optional leagueId scopes the run to one league (the commissioner path uses
// the processWaiversNow action instead; this is here for targeted cron/ops).
// An absent body, an absent key, or an empty-string leagueId (the workflow's
// blank-input default) all run every league with pending claims.
const BodySchema = z.object({
  leagueId: z.preprocess((v) => (v === '' ? undefined : v), z.string().uuid().optional()),
});

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  invariant(typeof secret === 'string' && secret.length >= 32, 'CRON_SECRET not configured');
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Tolerate an empty/absent body — a param-less cron POST is the common case.
  const raw: unknown = await request.json().catch(() => ({}));
  const parsed = BodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const result = await runWaivers(parsed.data.leagueId);
  return NextResponse.json(result);
}
