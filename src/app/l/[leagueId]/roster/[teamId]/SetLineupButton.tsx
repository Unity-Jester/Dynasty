import Link from 'next/link';

// Owner-gated entry point to the lineup editor. Plain link, not a client
// component — there's no client state here, just navigation (same idiom as
// WeekSelector in matchups/).
export default function SetLineupButton({ leagueId, teamId }: { leagueId: string; teamId: string }) {
  return (
    <Link
      href={`/l/${leagueId}/roster/${teamId}/lineup`}
      className="shrink-0 px-4 py-2 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all text-sm"
    >
      Set lineup
    </Link>
  );
}
