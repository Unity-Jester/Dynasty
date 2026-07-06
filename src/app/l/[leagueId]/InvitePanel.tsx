import CopyInviteButton from './CopyInviteButton';

type UnclaimedTeam = { id: string; name: string; inviteUrl: string };

// Visible ONLY to the league creator — the caller (page.tsx) must gate on
// `user.id === league.createdBy` before ever constructing this component's
// props. Invite tokens must never reach a non-creator's rendered output.
export default function InvitePanel({ teams }: { teams: UnclaimedTeam[] }) {
  if (teams.length === 0) {
    return null;
  }

  return (
    <section className="panel p-5">
      <h2 className="font-display text-lg text-white mb-1">Invites</h2>
      <p className="text-sm text-gray-500 mb-4">
        Share a link with each league mate to claim their team. Only you can see these.
      </p>
      <ul className="space-y-3">
        {teams.map((team) => (
          <li key={team.id} className="flex flex-col sm:flex-row sm:items-center gap-2">
            <span className="text-white text-sm w-32 shrink-0 truncate">{team.name}</span>
            <code className="flex-1 min-w-0 truncate px-3 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-xs text-gray-300">
              {team.inviteUrl}
            </code>
            <CopyInviteButton url={team.inviteUrl} />
          </li>
        ))}
      </ul>
    </section>
  );
}
