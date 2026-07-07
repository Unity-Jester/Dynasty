import type { StandingRow } from './standingsQueries';

// Points render to 2dp — the same clean 2dp values scoreWeek writes to the
// matchups table (roundPoints(total).toFixed(2)); the numbers are 2dp-clean by
// construction, toFixed(2) just fixes trailing-zero display.
function fmt(points: number): string {
  return points.toFixed(2);
}

function record(row: StandingRow): string {
  return `${row.wins}-${row.losses}-${row.ties}`;
}

function EmptyState() {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">Standings appear once games go final.</p>
    </div>
  );
}

function HeaderRow() {
  return (
    <thead>
      <tr className="text-xs uppercase tracking-wide text-gray-500">
        <th className="text-left font-medium py-2 pr-3">Team</th>
        <th className="text-right font-medium py-2 px-3">W-L-T</th>
        <th className="text-right font-medium py-2 px-3 tabular-nums">PF</th>
        <th className="text-right font-medium py-2 pl-3 tabular-nums">PA</th>
      </tr>
    </thead>
  );
}

function TeamRow({ rank, row }: { rank: number; row: StandingRow }) {
  return (
    <tr className="border-t border-white/10">
      <td className="py-2 pr-3">
        <span className="text-gray-500 tabular-nums mr-2">{rank}</span>
        <span className="text-white truncate">{row.teamName}</span>
      </td>
      <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{record(row)}</td>
      <td className="py-2 px-3 text-right text-gray-300 tabular-nums">{fmt(row.pointsFor)}</td>
      <td className="py-2 pl-3 text-right text-gray-400 tabular-nums">{fmt(row.pointsAgainst)}</td>
    </tr>
  );
}

export default function StandingsPanel({ rows }: { rows: StandingRow[] }) {
  return (
    <section>
      <h2 className="font-display text-lg text-white mb-3">Standings</h2>
      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="panel p-4 overflow-x-auto">
          <table className="w-full text-sm">
            <HeaderRow />
            <tbody>
              {rows.map((row, i) => (
                <TeamRow key={row.teamId} rank={i + 1} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
