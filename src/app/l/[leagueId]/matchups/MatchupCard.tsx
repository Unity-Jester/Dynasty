export type MatchupCardData = {
  id: string;
  homeTeamName: string;
  awayTeamName: string;
  homePoints: string | null;
  awayPoints: string | null;
};

function pointsText(points: string | null): string {
  return points ?? '—';
}

function MatchupSide({ name, points }: { name: string; points: string | null }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-white text-sm truncate">{name}</span>
      <span className="text-gray-400 text-sm tabular-nums shrink-0">{pointsText(points)}</span>
    </div>
  );
}

export default function MatchupCard({ matchup }: { matchup: MatchupCardData }) {
  return (
    <div className="panel p-4 space-y-2">
      <MatchupSide name={matchup.homeTeamName} points={matchup.homePoints} />
      <div className="keyline" />
      <MatchupSide name={matchup.awayTeamName} points={matchup.awayPoints} />
    </div>
  );
}
