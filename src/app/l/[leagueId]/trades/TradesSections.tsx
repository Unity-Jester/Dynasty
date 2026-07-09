import { DeadlineNotice, NoTeamPanel, SectionEmptyState } from './PageChrome';
import ProposeTradeForm from './ProposeTradeForm';
import PendingTrades from './PendingTrades';
import ReviewQueue from './ReviewQueue';
import History from './History';
import { emptyTeamAssets } from './tradeQueries';
import type { TradesSectionsData } from './loadTradesSections';
import type { LeagueSettings } from '@/engine/settings';
import type { TeamOption } from './types';

function PendingSection({ data, myTeam }: { data: TradesSectionsData; myTeam: (TeamOption & { ownerId: string | null }) | null }) {
  if (!myTeam) {
    return (
      <section className="space-y-3">
        <h2 className="font-display text-lg text-white">Pending</h2>
        <SectionEmptyState message="Own a team in this league to see trades involving you." />
      </section>
    );
  }
  return <PendingTrades trades={data.pendingResolved} myTeamId={myTeam.id} />;
}

/** The body of the trades page once league/season/settings all resolved cleanly. */
export default function TradesSections({
  data,
  settings,
  teamRows,
  myTeam,
  isCreator,
  deadlinePassed,
  currentWeek,
}: {
  data: TradesSectionsData;
  settings: LeagueSettings;
  teamRows: (TeamOption & { ownerId: string | null })[];
  myTeam: (TeamOption & { ownerId: string | null }) | null;
  isCreator: boolean;
  deadlinePassed: boolean;
  currentWeek: number;
}) {
  const counterpartyOptions = myTeam ? teamRows.filter((t) => t.id !== myTeam.id) : [];

  return (
    <>
      {deadlinePassed && settings.trades.deadlineWeek !== null && (
        <DeadlineNotice deadlineWeek={settings.trades.deadlineWeek} currentWeek={currentWeek} />
      )}
      {myTeam === null && <NoTeamPanel />}
      {myTeam !== null && (
        <ProposeTradeForm
          myTeamId={myTeam.id}
          myAssets={data.teamAssetsById[myTeam.id] ?? emptyTeamAssets(myTeam.id)}
          counterpartyOptions={counterpartyOptions}
          teamAssetsById={data.teamAssetsById}
          disabled={deadlinePassed}
        />
      )}
      <PendingSection data={data} myTeam={myTeam} />
      {isCreator && <ReviewQueue trades={data.reviewResolved} reviewMode={settings.trades.reviewMode} />}
      <History trades={data.historyResolved} />
    </>
  );
}
