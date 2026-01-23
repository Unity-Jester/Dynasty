'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

interface WeekSelectorProps {
  currentWeek: number;
  totalWeeks: number;
  playoffStart: number;
  seasonParam?: string;
}

export default function WeekSelector({ currentWeek, totalWeeks, playoffStart, seasonParam }: WeekSelectorProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const handleWeekChange = (week: number) => {
    const params = new URLSearchParams();
    params.set('week', week.toString());
    // Preserve season parameter if set
    if (seasonParam) {
      params.set('season', seasonParam);
    } else {
      const existingSeason = searchParams.get('season');
      if (existingSeason) {
        params.set('season', existingSeason);
      }
    }
    router.push(`/matchups?${params.toString()}`);
  };

  const weeks = Array.from({ length: totalWeeks }, (_, i) => i + 1);

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => handleWeekChange(Math.max(1, currentWeek - 1))}
        disabled={currentWeek <= 1}
        className={cn(
          'p-2 rounded-lg transition-colors',
          currentWeek <= 1
            ? 'text-gray-600 cursor-not-allowed'
            : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        )}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <select
        value={currentWeek}
        onChange={(e) => handleWeekChange(parseInt(e.target.value))}
        className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-sleeper-accent"
      >
        {weeks.map((week) => (
          <option key={week} value={week}>
            {week < playoffStart ? `Week ${week}` : `Playoffs Rd ${week - playoffStart + 1}`}
          </option>
        ))}
      </select>

      <button
        onClick={() => handleWeekChange(Math.min(totalWeeks, currentWeek + 1))}
        disabled={currentWeek >= totalWeeks}
        className={cn(
          'p-2 rounded-lg transition-colors',
          currentWeek >= totalWeeks
            ? 'text-gray-600 cursor-not-allowed'
            : 'text-gray-400 hover:bg-gray-800 hover:text-white'
        )}
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
    </div>
  );
}
