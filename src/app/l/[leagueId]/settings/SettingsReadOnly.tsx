import {
  starterSlotCount,
  type LeagueSettings,
} from '@/engine/settings';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-white/[0.06] last:border-0">
      <span className="text-sm text-gray-400">{label}</span>
      <span className="text-sm text-white text-right">{value}</span>
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="panel p-6">
      <h2 className="font-display text-lg text-white mb-2">{title}</h2>
      {children}
    </section>
  );
}

function waiverSummary(s: LeagueSettings): string {
  return s.waivers.mode === 'faab'
    ? `FAAB, $${s.waivers.budget} budget, ${s.waivers.tiebreaker}`
    : `Rolling priority (${s.waivers.order})`;
}

export default function SettingsReadOnly({ settings }: { settings: LeagueSettings }) {
  const rosterText = settings.rosterSlots
    .map((e) => `${e.slot} ×${e.count}`)
    .join(', ');
  const scoringKeys = Object.keys(settings.scoring.rules);

  return (
    <div className="space-y-6">
      <Group title="Overview">
        <Row label="Teams" value={String(settings.teamCount)} />
        <Row label="Starters" value={String(starterSlotCount(settings.rosterSlots))} />
      </Group>

      <Group title="Roster slots">
        <Row label="Slots" value={rosterText} />
      </Group>

      <Group title="Scoring">
        {scoringKeys.map((key) => (
          <Row key={key} label={key} value={String(settings.scoring.rules[key as keyof typeof settings.scoring.rules])} />
        ))}
        <Row label="Bonuses" value={`${settings.scoring.bonuses.length} configured`} />
      </Group>

      <Group title="Waivers">
        <Row label="Mode" value={waiverSummary(settings)} />
      </Group>

      <Group title="Trades">
        <Row label="Review" value={settings.trades.reviewMode} />
        <Row label="Future pick years" value={String(settings.trades.futurePickYears)} />
        <Row
          label="Deadline"
          value={settings.trades.deadlineWeek === null ? 'None' : `Week ${settings.trades.deadlineWeek}`}
        />
      </Group>

      <Group title="Playoffs">
        <Row label="Teams" value={String(settings.playoffs.teams)} />
        <Row label="Start week" value={String(settings.playoffs.startWeek)} />
      </Group>
    </div>
  );
}
