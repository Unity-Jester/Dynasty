// Shared shapes passed from the server page down through the client editor
// tree. Kept in one file so SlotRow/PlayerPicker/LineupEditor agree on shape
// without importing each other's component files.

export type LineupPlayer = {
  playerId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
};

// LineupPlayer plus roster status — used only by the editor, which needs
// status to filter the bench picker to active players (Rule: bench read-only
// views never need status).
export type RosterPlayer = LineupPlayer & { status: 'active' | 'taxi' | 'ir' };

// One starter-slot instance (e.g. FLEX index 1 = "FLEX 2"), merged from
// league settings (the shape) with the currently-saved assignment (if any).
export type SlotInstance = {
  slot: string;
  slotIndex: number;
  playerId: string | null;
};

export function slotInstanceKey(instance: Pick<SlotInstance, 'slot' | 'slotIndex'>): string {
  return `${instance.slot}:${instance.slotIndex}`;
}

// Human label for a slot instance: "FLEX 2" for the second FLEX, "QB" alone
// when the league only has one QB slot.
export function slotLabel(slot: string, slotIndex: number, countForSlot: number): string {
  const display = slot === 'SUPER_FLEX' ? 'SUPER FLEX' : slot;
  if (countForSlot <= 1) return display;
  return `${display} ${slotIndex + 1}`;
}
