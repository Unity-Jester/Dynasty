import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { invariant } from '@/lib/invariant';
import { scoreWeek } from '@/server/jobs/scoreWeek';

// 60s covers the whole-slate path (all leagues in a week, bounded reads + a
// handful of guarded UPDATEs per league). Raise per the hosting ceiling if the
// league count ever approaches MAX_LEAGUES with large slates.
export const maxDuration = 60;

// season + week REQUIRED (a scoring job never guesses which week to write).
// finalize + dryRun are OPTIONAL booleans defaulting to false. NOTE: we do NOT
// use z.coerce.boolean() — it maps any non-empty string (incl. "false") to
// true. Parse the literal "true" instead so ?dryRun=false means false.
const BoolParam = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const QueryParamSchema = z.object({
  season: z.coerce.number().int().min(2020).max(2050),
  week: z.coerce.number().int().min(1).max(18),
  finalize: BoolParam,
  dryRun: BoolParam,
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
    finalize: searchParams.get('finalize') ?? undefined,
    dryRun: searchParams.get('dryRun') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid_params' }, { status: 400 });
  }

  const { season, week, finalize, dryRun } = parsed.data;
  const result = await scoreWeek(season, week, { finalize, dryRun });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  const { ok: _ok, ...rest } = result;
  return NextResponse.json(rest);
}
