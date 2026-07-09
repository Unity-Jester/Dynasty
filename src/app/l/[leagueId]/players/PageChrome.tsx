export function PlayersHeader() {
  return (
    <header>
      <h1 className="font-display text-3xl text-white">Players</h1>
      <p className="text-sm text-gray-500 mt-1">
        Every add goes through a waiver claim — instant free agency is coming later. A player nobody claims stays
        available for the next run.
      </p>
      <div className="keyline mt-3" />
    </header>
  );
}

export function NoSeasonPanel() {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">This league has no season set up yet.</p>
    </div>
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

export function NoTeamNotice() {
  return (
    <div className="panel p-4 text-center">
      <p className="text-gray-400 text-sm">
        You don&apos;t own a team in this league, so you can&apos;t submit waiver claims. You can still browse
        unrostered players below.
      </p>
    </div>
  );
}

export function SectionEmptyState({ message }: { message: string }) {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">{message}</p>
    </div>
  );
}
