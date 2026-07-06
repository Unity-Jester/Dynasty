import type { LeagueSettings } from '@/engine/settings';
import { starterSlotCount } from '@/engine/settings';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-white font-medium mt-0.5">{value}</p>
    </div>
  );
}

function waiverModeLabel(settings: LeagueSettings): string {
  return settings.waivers.mode === 'faab' ? 'FAAB' : 'Priority';
}

export default function SettingsSummary({ settings }: { settings: LeagueSettings }) {
  return (
    <section className="panel divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] flex flex-col sm:flex-row">
      <Stat label="Teams" value={String(settings.teamCount)} />
      <Stat label="Starters" value={String(starterSlotCount(settings.rosterSlots))} />
      <Stat label="Waivers" value={waiverModeLabel(settings)} />
      <Stat
        label="Playoffs"
        value={`${settings.playoffs.teams} teams, wk ${settings.playoffs.startWeek}`}
      />
    </section>
  );
}
