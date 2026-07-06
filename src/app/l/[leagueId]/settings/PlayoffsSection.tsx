'use client';

import type { LeagueSettings } from '@/engine/settings';
import { SectionCard, NumberField } from './fields';

export default function PlayoffsSection({
  settings,
  onChange,
}: {
  settings: LeagueSettings;
  onChange: (next: LeagueSettings) => void;
}) {
  const playoffs = settings.playoffs;
  const setPlayoffs = (patch: Partial<LeagueSettings['playoffs']>) =>
    onChange({ ...settings, playoffs: { ...playoffs, ...patch } });

  return (
    <SectionCard title="Playoffs" description="Bracket size and the week the postseason begins.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberField
          label="Playoff teams"
          value={playoffs.teams}
          min={2}
          max={16}
          onChange={(teams) => setPlayoffs({ teams })}
        />
        <NumberField
          label="Start week"
          value={playoffs.startWeek}
          min={14}
          max={17}
          onChange={(startWeek) => setPlayoffs({ startWeek })}
        />
      </div>
    </SectionCard>
  );
}
