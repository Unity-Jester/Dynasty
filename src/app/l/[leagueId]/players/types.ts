// Shared shapes for the players page tree. Kept separate from the query
// modules (which import 'server-only') so client islands can import types
// without pulling server-only code into the client bundle — same split as
// the trades page tree's types.ts.

import { ROSTERABLE_POSITIONS } from '@/engine/playerSync';

export type PositionFilter = (typeof ROSTERABLE_POSITIONS)[number];

export type UnrosteredPlayer = {
  id: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
};

export type RosterOption = { id: string; fullName: string; position: string };

export type MyTeamInfo = {
  id: string;
  name: string;
  faabRemaining: number | null;
  waiverPriority: number | null;
};

/** Mirrors WaiverClaimPayload['resolution'] (payloads.ts) without pulling in the zod schema. */
export type WaiverResolution = { outcome: 'awarded' | 'rejected'; reason?: string };

export type ResolvedClaim =
  | {
      ok: true;
      id: string;
      status: string;
      addPlayerName: string;
      addPosition: string;
      dropPlayerName: string | null;
      bid: number | null;
      resolution: WaiverResolution | null;
      createdAt: string;
      resolvedAt: string | null;
    }
  | { ok: false; id: string; status: string; createdAt: string; resolvedAt: string | null };
