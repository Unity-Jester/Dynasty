export function TradesHeader() {
  return (
    <header>
      <h1 className="font-display text-3xl text-white">Trades</h1>
      <p className="text-sm text-gray-500 mt-1">Two-team trades only — multi-team trades coming later.</p>
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

export function NoTeamPanel() {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">
        You don&apos;t own a team in this league, so you can&apos;t propose or respond to trades. You can
        still see the league&apos;s trade history below.
      </p>
    </div>
  );
}

export function DeadlineNotice({ deadlineWeek, currentWeek }: { deadlineWeek: number; currentWeek: number }) {
  return (
    <div className="panel p-4 border border-amber-500/30 bg-amber-500/[0.04]">
      <p className="text-sm text-amber-300">
        The trade deadline (week {deadlineWeek}) has passed — it is currently week {currentWeek}. New trades
        can&apos;t be proposed.
      </p>
    </div>
  );
}

export function ReviewModeNotice({ reviewMode }: { reviewMode: 'none' | 'commissioner' | 'league_vote' }) {
  const body =
    reviewMode === 'league_vote'
      ? 'This league is set to league vote review. For now the commissioner acts as the league’s proxy and approves or vetoes on its behalf.'
      : reviewMode === 'commissioner'
        ? 'Accepted trades in this league are held for commissioner review before they take effect.'
        : "This league doesn't hold trades for review, so nothing should normally reach this queue.";
  return <p className="text-xs text-gray-500">{body}</p>;
}

export function SectionEmptyState({ message }: { message: string }) {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">{message}</p>
    </div>
  );
}
