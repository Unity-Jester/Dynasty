// Shared shapes for the trades page tree. Kept separate from the query
// modules so components can import types without pulling in server-only code.

export type TeamOption = { id: string; name: string };

export type PlayerAsset = { playerId: string; fullName: string; position: string; status: string };
export type PickAsset = { id: string; season: number; round: number; originalTeamName: string };

/** One team's tradeable assets, pre-grouped for the picker UI. */
export type TeamAssets = {
  teamId: string;
  players: PlayerAsset[];
  picks: PickAsset[];
};

export type ResolvedSide = { playerNames: string[]; pickLabels: string[] };

export type ResolvedTrade =
  | {
      ok: true;
      id: string;
      status: string;
      proposingTeamId: string;
      proposingTeamName: string;
      counterpartyTeamId: string;
      counterpartyTeamName: string;
      give: ResolvedSide;
      receive: ResolvedSide;
      note: string | null;
      createdAt: string;
      resolvedAt: string | null;
    }
  | { ok: false; id: string; status: string; createdAt: string; resolvedAt: string | null };
