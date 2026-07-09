'use client';

import { useState } from 'react';
import LineupEditor from './LineupEditor';
import LineupReadOnly from './LineupReadOnly';
import type { RosterPlayer, SlotInstance } from './types';

// Creator-viewing-another-team affordance (Phase 7 Task 8): read-only by
// default, with a clearly-labeled amber banner offering to switch into a
// commissioner edit mode. Editing in that mode bypasses lineup LOCKS only
// (server-enforced via saveLineup's asCommissioner gate) — every other
// lineup rule still applies, and the save is audited as a commish
// transaction. lockedNflTeams is passed as [] to LineupEditor so the UI's
// own lock indicators match what the server will actually accept.
export default function CommishLineupPanel({
  teamId,
  teamName,
  season,
  week,
  initialInstances,
  roster,
  rosterById,
  kickoffs,
}: {
  teamId: string;
  teamName: string;
  season: number;
  week: number;
  initialInstances: SlotInstance[];
  roster: RosterPlayer[];
  rosterById: Map<string, RosterPlayer>;
  kickoffs: Record<string, string>;
}) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return (
      <div className="space-y-3">
        <div className="panel p-3 border border-amber-500/30 bg-amber-500/[0.04] flex items-center justify-between gap-3 flex-wrap">
          <p className="text-sm text-amber-300">You&apos;re viewing {teamName}&apos;s lineup as commissioner.</p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 rounded-md text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40 hover:bg-amber-500/30 transition-colors"
          >
            Edit as commissioner
          </button>
        </div>
        <LineupReadOnly instances={initialInstances} rosterById={rosterById} kickoffs={kickoffs} />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="panel p-3 border border-amber-500/30 bg-amber-500/[0.04]">
        <p className="text-sm text-amber-300">
          Commissioner edit mode for {teamName} — lineup locks are bypassed; every other rule still applies.
          This save is logged to the league&apos;s activity feed.
        </p>
      </div>
      <LineupEditor
        teamId={teamId}
        season={season}
        week={week}
        initialInstances={initialInstances}
        roster={roster}
        kickoffs={kickoffs}
        lockedNflTeams={[]}
        asCommissioner
      />
    </div>
  );
}
