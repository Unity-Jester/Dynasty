// The position -> eligible-slot matrix long deferred by settings.ts (ROSTER_SLOTS)
// and playerSync.ts (ROSTERABLE_POSITIONS). Kept as explicit data, not derived,
// so the mapping is auditable at a glance and both TODOs resolve here.

// Lineup-legal slots: ROSTER_SLOTS minus the non-starter slots (BENCH/TAXI/IR).
export const STARTER_SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF'] as const;
export type StarterSlot = (typeof STARTER_SLOTS)[number];

const ELIGIBLE_SLOTS_BY_POSITION: Readonly<Record<string, readonly StarterSlot[]>> = {
  QB: ['QB', 'SUPER_FLEX'],
  RB: ['RB', 'FLEX', 'SUPER_FLEX'],
  WR: ['WR', 'FLEX', 'SUPER_FLEX'],
  TE: ['TE', 'FLEX', 'SUPER_FLEX'],
  K: ['K'],
  DEF: ['DEF'],
};

/**
 * Total and dumb: an unknown position or an unknown slot (e.g. BENCH, which is
 * never lineup-legal) both simply return false. Never throws — this is called
 * on external/user-controlled position strings, not a trust boundary itself.
 */
export function isEligible(position: string, slot: string): boolean {
  const eligibleSlots = ELIGIBLE_SLOTS_BY_POSITION[position];
  if (!eligibleSlots) return false;
  return (eligibleSlots as readonly string[]).includes(slot);
}
