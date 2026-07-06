import { formatRound } from '@/lib/formatRound';
import type { HeldPick, TradedAwayPick } from './picksQueries';

// Held picks are already bounded by the query cap (60); a named loop bound
// here keeps Rule 2 explicit at the render layer too.
const MAX_SEASON_GROUPS = 10;

type SeasonGroup = { season: number; picks: HeldPick[] };

// Groups held picks by season, preserving the query's season/round ordering.
function groupBySeason(picks: readonly HeldPick[]): SeasonGroup[] {
  const groups: SeasonGroup[] = [];
  for (const pick of picks) {
    const last = groups[groups.length - 1];
    if (last && last.season === pick.season) {
      last.picks.push(pick);
      continue;
    }
    if (groups.length >= MAX_SEASON_GROUPS) {
      break; // defensive: never render an unbounded list of season headings
    }
    groups.push({ season: pick.season, picks: [pick] });
  }
  return groups;
}

function HeldPickRow({ pick }: { pick: HeldPick }) {
  return (
    <li className="text-sm text-white">
      {formatRound(pick.round)} round
      {pick.viaName !== null && <span className="text-gray-500"> via {pick.viaName}</span>}
    </li>
  );
}

function SeasonGroupView({ group }: { group: SeasonGroup }) {
  return (
    <div>
      <h3 className="text-xs uppercase tracking-wide text-gray-500 font-medium mb-1.5">
        {group.season}
      </h3>
      <ul className="space-y-1">
        {group.picks.map((pick, index) => (
          <HeldPickRow key={`${group.season}-${pick.round}-${index}`} pick={pick} />
        ))}
      </ul>
    </div>
  );
}

function TradedAwayList({ picks }: { picks: readonly TradedAwayPick[] }) {
  if (picks.length === 0) {
    return null;
  }
  return (
    <div className="border-t border-white/[0.06] pt-4">
      <h3 className="text-xs uppercase tracking-wide text-gray-600 font-medium mb-1.5">
        Traded away
      </h3>
      <ul className="space-y-1">
        {picks.map((pick, index) => (
          <li key={`${pick.season}-${pick.round}-${index}`} className="text-sm text-gray-500">
            {pick.season} {formatRound(pick.round)} &rarr; {pick.holderName}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PicksSection({
  held,
  tradedAway,
}: {
  held: HeldPick[];
  tradedAway: TradedAwayPick[];
}) {
  const seasonGroups = groupBySeason(held);
  return (
    <section className="panel p-4 space-y-4">
      <h2 className="font-display text-lg text-white">Future Picks</h2>
      {seasonGroups.length === 0 ? (
        <p className="text-sm text-gray-500">No future picks held.</p>
      ) : (
        <div className="space-y-4">
          {seasonGroups.map((group) => (
            <SeasonGroupView key={group.season} group={group} />
          ))}
        </div>
      )}
      <TradedAwayList picks={tradedAway} />
    </section>
  );
}
