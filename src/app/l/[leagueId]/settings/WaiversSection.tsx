'use client';

import type { LeagueSettings } from '@/engine/settings';
import { SectionCard, NumberField, SelectField } from './fields';

const TIEBREAKER_OPTIONS = [
  { value: 'reverse_standings', label: 'Reverse standings' },
  { value: 'rolling', label: 'Rolling' },
] as const;

type Waivers = LeagueSettings['waivers'];

// Toggling modes resets the mode-specific fields to these defaults — an
// earlier entry for the other mode is NOT remembered within the session.
const DEFAULT_FAAB: Extract<Waivers, { mode: 'faab' }> = {
  mode: 'faab',
  budget: 100,
  tiebreaker: 'reverse_standings',
};
const DEFAULT_PRIORITY: Extract<Waivers, { mode: 'priority' }> = {
  mode: 'priority',
  order: 'reverse_standings',
};

export default function WaiversSection({
  settings,
  onChange,
}: {
  settings: LeagueSettings;
  onChange: (next: LeagueSettings) => void;
}) {
  const waivers = settings.waivers;
  const setWaivers = (next: Waivers) => onChange({ ...settings, waivers: next });

  return (
    <SectionCard title="Waivers" description="How free agents are awarded each week.">
      <div className="flex gap-4">
        {(['faab', 'priority'] as const).map((mode) => (
          <label key={mode} className="flex items-center gap-2 text-sm text-gray-300">
            <input
              type="radio"
              name="waiver-mode"
              checked={waivers.mode === mode}
              onChange={() => setWaivers(mode === 'faab' ? DEFAULT_FAAB : DEFAULT_PRIORITY)}
              className="accent-gold-500"
            />
            {mode === 'faab' ? 'FAAB budget' : 'Rolling priority'}
          </label>
        ))}
      </div>

      {waivers.mode === 'faab' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField
            label="Budget"
            value={waivers.budget}
            min={1}
            max={10_000}
            onChange={(n) => setWaivers({ ...waivers, budget: n })}
          />
          <SelectField
            label="Tiebreaker"
            value={waivers.tiebreaker}
            options={TIEBREAKER_OPTIONS}
            onChange={(tiebreaker) => setWaivers({ ...waivers, tiebreaker })}
          />
        </div>
      ) : (
        <SelectField
          label="Priority order"
          value={waivers.order}
          options={TIEBREAKER_OPTIONS}
          onChange={(order) => setWaivers({ ...waivers, order })}
        />
      )}
    </SectionCard>
  );
}
