'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveLineup } from '@/server/actions/lineup';
import { lineupErrorMessage } from './errorText';
import SlotRow from './SlotRow';
import PlayerPicker from './PlayerPicker';
import { slotInstanceKey, slotLabel, type RosterPlayer, type SlotInstance } from './types';
import { buildCandidates, buildRosterMap, countBySlot, hasLineupChanges, isInstanceLocked } from './lineupState';

// Mirrors validateLineup's MAX_ASSIGNMENTS — the editor never holds more
// instances than the engine will ever accept in one save (Rule 2/3).
const MAX_INSTANCES = 30;

type OpenPicker = { slot: string; slotIndex: number };

export default function LineupEditor({
  teamId,
  season,
  week,
  initialInstances,
  roster,
  kickoffs,
  lockedNflTeams,
}: {
  teamId: string;
  season: number;
  week: number;
  initialInstances: SlotInstance[];
  roster: RosterPlayer[];
  kickoffs: Record<string, string>;
  lockedNflTeams: string[];
}) {
  const router = useRouter();
  const [instances, setInstances] = useState<SlotInstance[]>(() => initialInstances.slice(0, MAX_INSTANCES));
  const [openPicker, setOpenPicker] = useState<OpenPicker | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rosterById = useMemo(() => buildRosterMap(roster), [roster]);
  const lockedSet = useMemo(() => new Set(lockedNflTeams), [lockedNflTeams]);
  const slotCounts = useMemo(() => countBySlot(initialInstances), [initialInstances]);
  const activeBench = useMemo(() => roster.filter((p) => p.status === 'active'), [roster]);

  const assignedPlayerIds = useMemo(() => {
    const set = new Set<string>();
    for (const inst of instances) {
      if (inst.playerId !== null) set.add(inst.playerId);
    }
    return set;
  }, [instances]);

  const hasChanges = useMemo(
    () => hasLineupChanges(instances, initialInstances),
    [instances, initialInstances],
  );

  function assignPlayer(target: OpenPicker, playerId: string | null) {
    setInstances((prev) =>
      prev.map((inst) =>
        inst.slot === target.slot && inst.slotIndex === target.slotIndex ? { ...inst, playerId } : inst,
      ),
    );
    setOpenPicker(null);
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await saveLineup({
      teamId,
      season,
      week,
      assignments: instances.map((i) => ({ slot: i.slot, slotIndex: i.slotIndex, playerId: i.playerId })),
    });
    setSaving(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
      return;
    }
    setError(lineupErrorMessage(result.error, result.detail));
  }

  const pickerCandidates = openPicker
    ? buildCandidates(openPicker.slot, activeBench, assignedPlayerIds, lockedSet)
    : [];
  const pickerCurrent = openPicker
    ? instances.find((i) => i.slot === openPicker.slot && i.slotIndex === openPicker.slotIndex)
    : undefined;

  return (
    <div className="space-y-3 pb-24">
      {instances.map((inst) => {
        const player = inst.playerId !== null ? rosterById.get(inst.playerId) ?? null : null;
        const locked = isInstanceLocked(inst, rosterById, lockedSet);
        return (
          <SlotRow
            key={slotInstanceKey(inst)}
            label={slotLabel(inst.slot, inst.slotIndex, slotCounts.get(inst.slot) ?? 1)}
            player={player}
            locked={locked}
            kickoffIso={player?.nflTeam ? kickoffs[player.nflTeam] : undefined}
            onTap={() => {
              if (!locked) setOpenPicker({ slot: inst.slot, slotIndex: inst.slotIndex });
            }}
          />
        );
      })}

      {openPicker && (
        <PlayerPicker
          title={`Choose ${slotLabel(openPicker.slot, openPicker.slotIndex, slotCounts.get(openPicker.slot) ?? 1)}`}
          candidates={pickerCandidates}
          canLeaveEmpty={pickerCurrent?.playerId !== null}
          onPick={(playerId) => assignPlayer(openPicker, playerId)}
          onLeaveEmpty={() => assignPlayer(openPicker, null)}
          onClose={() => setOpenPicker(null)}
        />
      )}

      <div className="fixed bottom-0 inset-x-0 sm:sticky sm:bottom-4 p-4 sm:p-0 bg-sleeper-dark/95 sm:bg-transparent backdrop-blur border-t border-white/[0.06] sm:border-0 flex items-center gap-4 z-40">
        <button
          type="button"
          onClick={() => {
            void handleSave();
          }}
          disabled={saving || !hasChanges}
          className="px-6 py-3 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save lineup'}
        </button>
        {saved && <span className="text-sm text-emerald-400">Lineup saved.</span>}
        {error && <span className="text-sm text-sleeper-red">{error}</span>}
      </div>
    </div>
  );
}
