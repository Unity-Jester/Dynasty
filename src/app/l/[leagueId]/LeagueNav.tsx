'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

// Small nav for the hosted-league shell. Distinct from the Sleeper analytics
// `Navigation` component (which lives under /league/[leagueId]/...) — hosted
// leagues have far fewer sections for now, so this stays intentionally thin.
export default function LeagueNav({
  leagueId,
  leagueName,
}: {
  leagueId: string;
  leagueName: string;
}) {
  const pathname = usePathname();
  const base = `/l/${leagueId}`;
  // Activity and Commish are always shown to everyone (Phase 7 Task 8): this
  // layout has no viewer identity to gate on (it never calls the Supabase
  // client), and plumbing auth in here just for a nav link would touch every
  // page load. Both destinations self-gate instead — the commish page shows
  // a "commissioner only" panel to non-creators, and every mutating action
  // re-checks league.createdBy server-side regardless of what the nav shows.
  const links = [
    { href: base, label: 'Home' },
    { href: `${base}/matchups`, label: 'Matchups' },
    { href: `${base}/players`, label: 'Players' },
    { href: `${base}/trades`, label: 'Trades' },
    { href: `${base}/activity`, label: 'Activity' },
    { href: `${base}/commish`, label: 'Commish' },
    { href: `${base}/settings`, label: 'Settings' },
  ];

  return (
    <nav className="sticky top-0 z-40 bg-sleeper-dark/80 backdrop-blur-xl border-b border-white/[0.06]">
      <div className="max-w-4xl mx-auto px-4">
        <div className="flex items-center justify-between h-14 gap-4">
          <div className="flex items-center gap-1 min-w-0">
            <span className="font-display text-white truncate mr-3">{leagueName}</span>
            {links.map((item) => {
              const isActive = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'px-3 py-2 rounded-md text-sm font-medium transition-colors',
                    isActive
                      ? 'bg-sleeper-accent text-sleeper-dark'
                      : 'text-gray-300 hover:bg-white/[0.06] hover:text-white'
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
          <Link
            href="/l"
            className="px-3 py-2 rounded-md text-sm font-medium text-gray-500 hover:bg-white/[0.06] hover:text-gold-400 transition-colors shrink-0"
          >
            My Leagues
          </Link>
        </div>
      </div>
    </nav>
  );
}
