import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { invariant } from '@/lib/invariant';
import { pollStats } from '@/server/jobs/pollStats';

export const maxDuration = 60;

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
  const seasonRaw = searchParams.get('season');
  const weekRaw = searchParams.get('week');

  // Both-or-neither: one present without the other is a malformed request,
  // not "use the default for the missing one".
  if ((seasonRaw === null) !== (weekRaw === null)) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  let season: number | undefined;
  let week: number | undefined;
  if (seasonRaw !== null && weekRaw !== null) {
    const parsed = QueryParamSchema.safeParse({ season: seasonRaw, week: weekRaw });
    if (!parsed.success) {
      return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
    }
    season = parsed.data.season;
    week = parsed.data.week;
  }

  const result = await pollStats(season, week);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  const { ok: _ok, ...rest } = result;
  return NextResponse.json(rest);
}
