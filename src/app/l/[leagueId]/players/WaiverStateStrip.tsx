import ProcessWaiversButton from './ProcessWaiversButton';
import type { LeagueSettings } from '@/engine/settings';

function modeLabel(waivers: LeagueSettings['waivers']): string {
  return waivers.mode === 'faab' ? `FAAB bidding (budget $${waivers.budget})` : 'Priority order';
}

// faabRemaining/waiverPriority are NULL until the league's first waiver run
// (teams.ts's lazy-init comment) — shown as the settings-implied starting
// value with an "(initial)" note rather than a bare NULL/zero.
function myStatusText(
  waivers: LeagueSettings['waivers'],
  faabRemaining: number | null,
  waiverPriority: number | null,
): string {
  if (waivers.mode === 'faab') {
    return faabRemaining === null
      ? `$${waivers.budget} remaining (initial — no waiver run yet)`
      : `$${faabRemaining} remaining`;
  }
  return waiverPriority === null
    ? 'Priority not yet set (the initial order applies at the first run)'
    : `Priority #${waiverPriority}`;
}

export default function WaiverStateStrip({
  leagueId,
  waivers,
  hasTeam,
  faabRemaining,
  waiverPriority,
  isCreator,
}: {
  leagueId: string;
  waivers: LeagueSettings['waivers'];
  hasTeam: boolean;
  faabRemaining: number | null;
  waiverPriority: number | null;
  isCreator: boolean;
}) {
  return (
    <div className="panel p-4 space-y-2">
      <p className="text-sm text-white">
        <span className="text-gray-500">Waivers:</span> {modeLabel(waivers)}
        {hasTeam && (
          <>
            {' · '}
            <span className="text-gray-500">You:</span> {myStatusText(waivers, faabRemaining, waiverPriority)}
          </>
        )}
      </p>
      <p className="text-xs text-gray-500">
        Waivers process automatically Wednesdays at 08:00 UTC during the season (not yet active until this goes
        live).
        {isCreator ? ' As commissioner, you can also process them right now.' : ' Your commissioner can also process them early.'}
      </p>
      {isCreator && <ProcessWaiversButton leagueId={leagueId} />}
    </div>
  );
}
