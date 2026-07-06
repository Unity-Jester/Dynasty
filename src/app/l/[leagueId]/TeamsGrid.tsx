import Link from 'next/link';

type TeamCard = { id: string; name: string; ownerDisplayName: string | null };

function TeamCardView({ leagueId, team }: { leagueId: string; team: TeamCard }) {
  return (
    <Link href={`/l/${leagueId}/roster/${team.id}`} className="panel panel-hover p-4 block">
      <p className="text-white font-medium truncate">{team.name}</p>
      {team.ownerDisplayName ? (
        <p className="text-sm text-gray-400 mt-1 truncate">{team.ownerDisplayName}</p>
      ) : (
        <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-medium bg-white/[0.06] text-gray-500 border border-white/10">
          Unclaimed
        </span>
      )}
    </Link>
  );
}

export default function TeamsGrid({ leagueId, teams }: { leagueId: string; teams: TeamCard[] }) {
  return (
    <section>
      <h2 className="font-display text-lg text-white mb-3">Teams</h2>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
        {teams.map((team) => (
          <TeamCardView key={team.id} leagueId={leagueId} team={team} />
        ))}
      </div>
    </section>
  );
}
