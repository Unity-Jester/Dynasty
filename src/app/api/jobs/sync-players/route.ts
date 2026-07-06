import { NextRequest, NextResponse } from 'next/server';
import { invariant } from '@/lib/invariant';
import { syncPlayers } from '@/server/jobs/syncPlayers';

export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  invariant(typeof secret === 'string' && secret.length >= 32, 'CRON_SECRET not configured');
  const auth = request.headers.get('authorization');
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await syncPlayers();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }
  return NextResponse.json({
    upserted: result.upserted,
    skipped: result.skipped,
    deduped: result.deduped,
  });
}
