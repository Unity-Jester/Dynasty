'use client';

import {
  ROSTER_SLOTS,
  starterSlotCount,
  type LeagueSettings,
  type RosterSlot,
  type RosterSlotEntryT,
} from '@/engine/settings';
import { SectionCard } from './fields';

function unusedSlots(entries: readonly RosterSlotEntryT[]): RosterSlot[] {
  const used = new Set(entries.map((e) => e.slot));
  return ROSTER_SLOTS.filter((s) => !used.has(s));
}

function totalCapacity(entries: readonly RosterSlotEntryT[]): number {
  return entries.reduce((sum, e) => sum + e.count, 0);
}

export default function RosterSlotsSection({
  settings,
  onChange,
}: {
  settings: LeagueSettings;
  onChange: (next: LeagueSettings) => void;
}) {
  const slots = settings.rosterSlots;
  const setSlots = (next: RosterSlotEntryT[]) =>
    onChange({ ...settings, rosterSlots: next });

  const available = unusedSlots(slots);

  const setCount = (slot: RosterSlot, count: number) =>
    setSlots(slots.map((e) => (e.slot === slot ? { ...e, count } : e)));
  const removeSlot = (slot: RosterSlot) =>
    setSlots(slots.filter((e) => e.slot !== slot));
  const addSlot = (slot: RosterSlot) => setSlots([...slots, { slot, count: 1 }]);

  return (
    <SectionCard
      title="Roster slots"
      description="Lineup slots and how many of each. BENCH, TAXI and IR do not count as starters."
    >
      <div className="space-y-2">
        {slots.map((entry) => (
          <div key={entry.slot} className="flex items-center gap-3">
            <span className="w-28 text-sm text-gray-300 font-medium">{entry.slot}</span>
            <input
              type="number"
              min={1}
              value={entry.count}
              onChange={(e) => {
                const n = Number(e.target.value);
                setCount(entry.slot, Number.isNaN(n) ? 1 : n);
              }}
              className="w-24 px-3 py-2 bg-white/[0.04] border border-white/10 rounded-lg text-white focus:outline-none focus:border-gold-500/60"
            />
            <button
              type="button"
              onClick={() => removeSlot(entry.slot)}
              className="text-xs text-gray-500 hover:text-sleeper-red transition-colors"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {available.length > 0 && (
        <div className="flex items-center gap-3 pt-1">
          <span className="text-sm text-gray-400">Add slot</span>
          <select
            value=""
            onChange={(e) => {
              const slot = e.target.value as RosterSlot;
              if (slot) {
                addSlot(slot);
              }
            }}
            className="px-3 py-2 bg-white/[0.04] border border-white/10 rounded-lg text-white focus:outline-none focus:border-gold-500/60"
          >
            <option value="" className="bg-sleeper-dark">
              Select a slot…
            </option>
            {available.map((slot) => (
              <option key={slot} value={slot} className="bg-sleeper-dark">
                {slot}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="flex gap-6 pt-2 text-sm">
        <span className="text-gray-400">
          Total capacity: <span className="text-white font-medium">{totalCapacity(slots)}</span>
        </span>
        <span className="text-gray-400">
          Starters: <span className="text-white font-medium">{starterSlotCount(slots)}</span>
        </span>
      </div>
    </SectionCard>
  );
}
