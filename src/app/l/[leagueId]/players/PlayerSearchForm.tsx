import Link from 'next/link';
import { ROSTERABLE_POSITIONS } from '@/engine/playerSync';
import { cn } from '@/lib/utils';
import type { PositionFilter } from './types';

// Server-rendered GET form + plain links — no client-side data fetching, no
// JS required. Position chips are Links (mirrors matchups/WeekSelector.tsx's
// house pattern) carrying the CURRENT search text along in the href; the
// text form carries the CURRENT position along via a hidden input so neither
// control clobbers the other's state on submit.
function chipHref(leagueId: string, q: string | null, pos: PositionFilter | null): string {
  const params = new URLSearchParams();
  if (q !== null) params.set('q', q);
  if (pos !== null) params.set('pos', pos);
  const qs = params.toString();
  return `/l/${leagueId}/players${qs ? `?${qs}` : ''}`;
}

function chipClass(active: boolean): string {
  return cn(
    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
    active
      ? 'bg-sleeper-accent text-sleeper-dark'
      : 'bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] hover:text-white',
  );
}

export default function PlayerSearchForm({
  leagueId,
  q,
  pos,
}: {
  leagueId: string;
  q: string | null;
  pos: PositionFilter | null;
}) {
  return (
    <section className="space-y-3">
      <form action={`/l/${leagueId}/players`} method="GET" className="flex gap-2">
        <input type="hidden" name="pos" value={pos ?? ''} />
        <input
          type="text"
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search players by name"
          maxLength={60}
          className="flex-1 bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-600"
        />
        <button
          type="submit"
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-white/[0.06] text-white hover:bg-white/[0.1] transition-colors"
        >
          Search
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        <Link href={chipHref(leagueId, q, null)} className={chipClass(pos === null)}>
          All
        </Link>
        {ROSTERABLE_POSITIONS.map((p) => (
          <Link key={p} href={chipHref(leagueId, q, p)} className={chipClass(pos === p)}>
            {p}
          </Link>
        ))}
      </div>
    </section>
  );
}
