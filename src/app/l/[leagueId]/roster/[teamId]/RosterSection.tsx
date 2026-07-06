export type RosterPlayerRow = {
  playerId: string;
  fullName: string;
  position: string;
  nflTeam: string | null;
  injuryStatus: string | null;
};

function InjuryTag({ injuryStatus }: { injuryStatus: string | null }) {
  if (!injuryStatus) {
    return null;
  }
  return (
    <span className="ml-2 inline-block px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20 align-middle">
      {injuryStatus}
    </span>
  );
}

function RosterPlayerRowView({ player }: { player: RosterPlayerRow }) {
  return (
    <tr className="border-t border-white/[0.06]">
      <td className="py-2 pr-3 text-white">
        {player.fullName}
        <InjuryTag injuryStatus={player.injuryStatus} />
      </td>
      <td className="py-2 pr-3 text-gray-400">{player.position}</td>
      <td className="py-2 text-gray-400">{player.nflTeam ?? '—'}</td>
    </tr>
  );
}

export default function RosterSection({
  title,
  players,
}: {
  title: string;
  players: RosterPlayerRow[];
}) {
  return (
    <section className="panel p-4">
      <h2 className="font-display text-lg text-white mb-3">
        {title} ({players.length})
      </h2>
      {players.length === 0 ? (
        <p className="text-sm text-gray-500">None.</p>
      ) : (
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="text-gray-500 text-xs uppercase tracking-wide">
              <th className="pb-2 font-medium">Player</th>
              <th className="pb-2 font-medium">Pos</th>
              <th className="pb-2 font-medium">Team</th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => (
              <RosterPlayerRowView key={player.playerId} player={player} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
