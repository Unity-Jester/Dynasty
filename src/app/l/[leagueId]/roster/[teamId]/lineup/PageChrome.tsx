import Link from 'next/link';

export function LineupHeader({
  teamName,
  leagueId,
  teamId,
}: {
  teamName: string;
  leagueId: string;
  teamId: string;
}) {
  return (
    <header>
      <Link
        href={`/l/${leagueId}/roster/${teamId}`}
        className="text-sm text-gray-400 hover:text-white transition-colors"
      >
        ← Back to roster
      </Link>
      <h1 className="font-display text-3xl text-white mt-3">{teamName} — Lineup</h1>
      <div className="keyline mt-3" />
    </header>
  );
}

export function SettingsErrorPanel({ detail }: { detail: string }) {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">
        This league&apos;s settings failed validation ({detail}). Ask your commissioner to check settings.
      </p>
    </div>
  );
}

export function NoSeasonPanel() {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">This league has no season set up yet.</p>
    </div>
  );
}

export function NoStartersPanel() {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">This league has no starter slots configured.</p>
    </div>
  );
}
