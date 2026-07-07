import Link from 'next/link';
import { cn } from '@/lib/utils';

// Plain links rather than a client <select> — simpler, and week navigation
// is a normal in-page nav action that should be a real, bookmarkable URL.
export default function WeekSelector({
  leagueId,
  currentWeek,
  totalWeeks,
}: {
  leagueId: string;
  currentWeek: number;
  totalWeeks: number;
}) {
  const weeks = Array.from({ length: totalWeeks }, (_, i) => i + 1);

  return (
    <nav className="flex flex-wrap gap-1.5">
      {weeks.map((week) => {
        const isActive = week === currentWeek;
        return (
          <Link
            key={week}
            href={`/l/${leagueId}/matchups?week=${week}`}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-sleeper-accent text-sleeper-dark'
                : 'bg-white/[0.04] text-gray-300 hover:bg-white/[0.08] hover:text-white'
            )}
          >
            {week}
          </Link>
        );
      })}
    </nav>
  );
}
