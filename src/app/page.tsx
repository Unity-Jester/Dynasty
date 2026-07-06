import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/server/supabase';

// Root is the Dynasty hosting platform. Signed-in members go straight to
// their leagues; visitors get the platform landing. The Sleeper analytics
// hub lives on at /start (picker) and /league/<id> (league pages) — the old
// NEXT_PUBLIC_LEAGUE_ID and lastLeagueId cookie redirects are gone on
// purpose: they hijacked the domain root for the analytics era.
export default async function HomePage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    redirect('/l');
  }

  return (
    <div className="max-w-2xl mx-auto py-20 px-4 text-center">
      <h1 className="font-display text-5xl sm:text-6xl text-white mb-6 animate-rise">
        <span className="text-gold-gradient">Dynasty</span>
      </h1>
      <p
        className="text-gray-400 text-lg mb-10 animate-rise"
        style={{ animationDelay: '120ms' }}
      >
        A league hosting platform built for dynasty fantasy football &mdash;
        rosters, taxi squads, future pick trading, and rules that work the way
        your league actually plays.
      </p>

      <div
        className="flex flex-col sm:flex-row gap-3 justify-center animate-rise"
        style={{ animationDelay: '240ms' }}
      >
        <Link
          href="/login"
          className="px-6 py-3.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all"
        >
          Sign in to your league
        </Link>
        <Link
          href="/start"
          className="px-6 py-3.5 bg-white/[0.04] border border-white/10 rounded-xl text-white font-medium hover:bg-white/[0.06] transition-colors"
        >
          Browse a Sleeper league
        </Link>
      </div>

      <p
        className="text-xs text-gray-600 mt-12 animate-rise"
        style={{ animationDelay: '360ms' }}
      >
        Looking for the Sleeper analytics hub? It moved to{' '}
        <Link href="/start" className="underline hover:text-gray-400">
          /start
        </Link>
        .
      </p>
    </div>
  );
}
