import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { invariant } from '@/lib/invariant';
import { syncNflSchedule } from '@/server/jobs/syncNflSchedule';

export const maxDuration = 60;

// season is REQUIRED: unlike poll-stats (which can guess "current week" via
// omission), a schedule sync never guesses which season's kickoffs to write.
const QueryParamSchema = z.object({
  season: z.coerce.number().int().min(2020).max(2050),
});

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  invariant(typeof secret === 'string' && secret.length >= 32, 'CRON_SECRET not configured');
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const parsed = QueryParamSchema.safeParse({ season: searchParams.get('season') });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const result = await syncNflSchedule(parsed.data.season);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  const { ok: _ok, ...rest } = result;
  return NextResponse.json(rest);
}
