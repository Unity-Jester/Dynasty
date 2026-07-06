import Link from 'next/link';
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { leagues, teams } from '@/server/schema';
import { createSupabaseServerClient } from '@/server/supabase';
import ClaimButton from './ClaimButton';

const MAX_TOKEN_LENGTH = 200;

type Invite = { teamName: string; leagueName: string; claimed: boolean };

// `/join/*` is intentionally outside the auth middleware matcher so logged-out
// invitees can see what they'd be claiming before signing in.
async function lookupInvite(token: string): Promise<Invite | null> {
  if (token.length === 0 || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }
  const [row] = await getDb()
    .select({
      teamName: teams.name,
      ownerId: teams.ownerId,
      leagueName: leagues.name,
    })
    .from(teams)
    .innerJoin(leagues, eq(teams.leagueId, leagues.id))
    .where(eq(teams.inviteToken, token))
    .limit(1);
  if (!row) {
    return null;
  }
  return {
    teamName: row.teamName,
    leagueName: row.leagueName,
    claimed: row.ownerId !== null,
  };
}

async function isSignedIn(): Promise<boolean> {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user !== null;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-md mx-auto py-16">
      <div className="panel p-6 space-y-4 text-center">{children}</div>
    </div>
  );
}

export default async function JoinPage({ params }: { params: { token: string } }) {
  const token = decodeURIComponent(params.token);
  const invite = await lookupInvite(token);

  if (!invite || invite.claimed) {
    return (
      <Shell>
        <h1 className="font-display text-2xl text-white">Invite unavailable</h1>
        <p className="text-gray-400">
          This invite link is invalid or has already been used. Ask your
          commissioner for a fresh link.
        </p>
      </Shell>
    );
  }

  const signedIn = await isSignedIn();

  return (
    <Shell>
      <h1 className="font-display text-2xl text-white">
        Join <span className="text-gold-gradient">{invite.leagueName}</span>
      </h1>
      <p className="text-gray-400">
        You&apos;ve been invited to manage{' '}
        <span className="text-white font-medium">{invite.teamName}</span>.
      </p>
      {signedIn ? (
        <ClaimButton token={token} />
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500">Sign in to claim this team.</p>
          <Link
            href={`/login?next=${encodeURIComponent(`/join/${encodeURIComponent(token)}`)}`}
            className="block w-full px-4 py-3.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all"
          >
            Sign in to continue
          </Link>
        </div>
      )}
    </Shell>
  );
}
