'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { generateSchedule, type GenerateScheduleResult } from '@/server/actions/schedule';

const ERROR_TEXT: Record<Exclude<GenerateScheduleResult, { ok: true }>['error'], string> = {
  invalid_input: 'Something was wrong with the request. Reload the page and try again.',
  unauthenticated: 'Your session expired. Sign in again to generate the schedule.',
  not_found: 'This league or season could not be found.',
  not_creator: 'Only the league commissioner can generate the schedule.',
  season_locked: 'The season has already started — the schedule is locked.',
  already_scheduled: 'A schedule already exists for this season.',
  invalid_team_count: 'The league needs an even number of teams (at least 4) to generate a schedule.',
  invalid_settings: 'This season’s settings failed validation. Fix settings before generating.',
  generation_failed: 'The schedule generator could not build a valid schedule.',
  db_error: 'A database error occurred. Try again in a moment.',
};

export default function GenerateScheduleButton({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    setPending(true);
    setError(null);
    const result = await generateSchedule({ leagueId });
    setPending(false);
    if (result.ok) {
      router.refresh();
      return;
    }
    const base = ERROR_TEXT[result.error];
    setError(result.detail ? `${base} (${result.detail})` : base);
  };

  return (
    <div className="panel p-6 text-center space-y-3">
      <p className="text-gray-300 text-sm">No schedule has been generated for this season yet.</p>
      <button
        type="button"
        onClick={() => {
          void handleClick();
        }}
        disabled={pending}
        className="px-6 py-3 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? 'Generating…' : 'Generate schedule'}
      </button>
      {error && <p className="text-sm text-sleeper-red">{error}</p>}
    </div>
  );
}
