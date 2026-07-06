'use client';

import type { LeagueSettings } from '@/engine/settings';
import { SectionCard, NumberField, SelectField } from './fields';

const REVIEW_OPTIONS = [
  { value: 'none', label: 'No review' },
  { value: 'commissioner', label: 'Commissioner review' },
  { value: 'league_vote', label: 'League vote' },
] as const;

const PICK_YEAR_OPTIONS = [0, 1, 2, 3].map((n) => ({
  value: n,
  label: n === 0 ? 'No future picks' : `${n} year${n > 1 ? 's' : ''} out`,
}));

const DEFAULT_DEADLINE_WEEK = 12;

type Trades = LeagueSettings['trades'];

export default function TradesSection({
  settings,
  onChange,
}: {
  settings: LeagueSettings;
  onChange: (next: LeagueSettings) => void;
}) {
  const trades = settings.trades;
  const setTrades = (patch: Partial<Trades>) =>
    onChange({ ...settings, trades: { ...trades, ...patch } });

  const hasDeadline = trades.deadlineWeek !== null;

  return (
    <SectionCard title="Trades" description="Review process, future picks, and the trade deadline.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <SelectField
          label="Review mode"
          value={trades.reviewMode}
          options={REVIEW_OPTIONS}
          onChange={(reviewMode) => setTrades({ reviewMode })}
        />
        <SelectField
          label="Future pick years"
          value={trades.futurePickYears}
          options={PICK_YEAR_OPTIONS}
          onChange={(futurePickYears) => setTrades({ futurePickYears })}
        />
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input
            type="checkbox"
            checked={!hasDeadline}
            onChange={(e) =>
              setTrades({ deadlineWeek: e.target.checked ? null : DEFAULT_DEADLINE_WEEK })
            }
            className="accent-gold-500"
          />
          No trade deadline
        </label>
        {hasDeadline && (
          <NumberField
            label="Deadline week"
            value={trades.deadlineWeek ?? DEFAULT_DEADLINE_WEEK}
            min={1}
            max={18}
            onChange={(n) => setTrades({ deadlineWeek: n })}
          />
        )}
      </div>
    </SectionCard>
  );
}
