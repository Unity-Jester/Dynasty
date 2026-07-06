import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { invariant } from '@/lib/invariant';
import { reconcileStats } from '@/server/jobs/reconcileStats';

export const maxDuration = 60;

// Unlike poll-stats, BOTH season and week are REQUIRED: a correction job never
// guesses which week to overwrite. Missing either -> 400 invalid_params.
const QueryParamSchema = z.object({
  season: z.coerce.number().int().min(2020).max(2050),
  week: z.coerce.number().int().min(1).max(18),
});

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  invariant(typeof secret === 'string' && secret.length >= 32, 'CRON_SECRET not configured');
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = QueryParamSchema.safeParse({
    season: searchParams.get('season'),
    week: searchParams.get('week'),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const result = await reconcileStats(parsed.data.season, parsed.data.week);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  const { ok: _ok, ...rest } = result;
  return NextResponse.json(rest);
}
