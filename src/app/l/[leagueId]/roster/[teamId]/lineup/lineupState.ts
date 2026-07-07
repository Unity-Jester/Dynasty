import { isEligible } from '@/engine/lineup/eligibility';
import type { PickerCandidate } from './PlayerPicker';
import { slotInstanceKey, type RosterPlayer, type SlotInstance } from './types';

export function buildRosterMap(roster: readonly RosterPlayer[]): Map<string, RosterPlayer> {
  const byId = new Map<string, RosterPlayer>();
  for (const p of roster) byId.set(p.playerId, p);
  return byId;
}

export function countBySlot(instances: readonly SlotInstance[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const inst of instances) {
    counts.set(inst.slot, (counts.get(inst.slot) ?? 0) + 1);
  }
  return counts;
}

export function buildCandidates(
  slot: string,
  activeBench: readonly RosterPlayer[],
  assignedPlayerIds: ReadonlySet<string>,
  lockedNflTeams: ReadonlySet<string>,
): PickerCandidate[] {
  const candidates: PickerCandidate[] = [];
  for (const player of activeBench) {
    if (assignedPlayerIds.has(player.playerId)) continue;
    if (!isEligible(player.position, slot)) continue;
    candidates.push({ player, locked: player.nflTeam !== null && lockedNflTeams.has(player.nflTeam) });
  }
  return candidates;
}

export function isInstanceLocked(
  inst: SlotInstance,
  rosterById: ReadonlyMap<string, RosterPlayer>,
  lockedNflTeams: ReadonlySet<string>,
): boolean {
  if (inst.playerId === null) return false;
  const player = rosterById.get(inst.playerId);
  if (!player || player.nflTeam === null) return false;
  return lockedNflTeams.has(player.nflTeam);
}

export function hasLineupChanges(
  instances: readonly SlotInstance[],
  initialInstances: readonly SlotInstance[],
): boolean {
  if (instances.length !== initialInstances.length) return true;
  const initialByKey = new Map(initialInstances.map((i) => [slotInstanceKey(i), i.playerId]));
  return instances.some((inst) => initialByKey.get(slotInstanceKey(inst)) !== inst.playerId);
}
