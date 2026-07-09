import PlayerSearchForm from './PlayerSearchForm';
import PlayerBrowser from './PlayerBrowser';
import WaiverStateStrip from './WaiverStateStrip';
import MyClaims from './MyClaims';
import ClaimResolutions from './ClaimResolutions';
import { NoTeamNotice } from './PageChrome';
import type { LeagueSettings } from '@/engine/settings';
import type { MyTeamInfo, PositionFilter } from './types';
import type { PlayersSectionsData } from './loadPlayersSections';

/** The body of the players page once league/season/settings all resolved cleanly. */
export default function PlayersSections({
  leagueId,
  q,
  pos,
  settings,
  myTeam,
  isCreator,
  data,
}: {
  leagueId: string;
  q: string | null;
  pos: PositionFilter | null;
  settings: LeagueSettings;
  myTeam: MyTeamInfo | null;
  isCreator: boolean;
  data: PlayersSectionsData;
}) {
  return (
    <>
      <WaiverStateStrip
        leagueId={leagueId}
        waivers={settings.waivers}
        hasTeam={myTeam !== null}
        faabRemaining={myTeam?.faabRemaining ?? null}
        waiverPriority={myTeam?.waiverPriority ?? null}
        isCreator={isCreator}
      />
      {myTeam === null && <NoTeamNotice />}
      <PlayerSearchForm leagueId={leagueId} q={q} pos={pos} />
      <PlayerBrowser
        results={data.results}
        myTeamId={myTeam?.id ?? null}
        waivers={settings.waivers}
        faabRemaining={myTeam?.faabRemaining ?? null}
        rosterOptions={data.rosterOptions}
      />
      {myTeam !== null && (
        <>
          <MyClaims claims={data.pendingClaims} />
          <ClaimResolutions claims={data.resolvedClaims} />
        </>
      )}
    </>
  );
}
