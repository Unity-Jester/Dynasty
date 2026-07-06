import type { ImportReport } from '@/server/import/report';

type TeamRow = ImportReport['teams'][number];

function TeamRowView({ team }: { team: TeamRow }) {
  return (
    <tr className="border-t border-white/[0.06]">
      <td className="py-2 pr-3 text-white">{team.name}</td>
      <td className="py-2 pr-3 text-gray-400">{team.active}</td>
      <td className="py-2 pr-3 text-gray-400">{team.taxi}</td>
      <td className="py-2 text-gray-400">{team.ir}</td>
    </tr>
  );
}

export default function TeamsTable({ teams }: { teams: readonly TeamRow[] }) {
  if (teams.length === 0) {
    return <p className="text-sm text-gray-500">No teams found.</p>;
  }
  return (
    <table className="w-full text-sm text-left">
      <thead>
        <tr className="text-gray-500 text-xs uppercase tracking-wide">
          <th className="pb-2 font-medium">Team</th>
          <th className="pb-2 font-medium">Active</th>
          <th className="pb-2 font-medium">Taxi</th>
          <th className="pb-2 font-medium">IR</th>
        </tr>
      </thead>
      <tbody>
        {teams.map((team) => (
          <TeamRowView key={team.rosterId} team={team} />
        ))}
      </tbody>
    </table>
  );
}
