export function CommishHeader() {
  return (
    <header>
      <h1 className="font-display text-3xl text-white">Commissioner tools</h1>
      <p className="text-sm text-gray-500 mt-1">Force roster moves, run waivers, and review pending trades.</p>
      <div className="keyline mt-3" />
    </header>
  );
}

export function NotCreatorPanel() {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">Only this league&apos;s commissioner can access these tools.</p>
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

export function SettingsErrorPanel({ detail }: { detail: string }) {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">This league&apos;s settings failed validation ({detail}).</p>
    </div>
  );
}

export function NoTeamsPanel() {
  return (
    <div className="panel p-6 text-center">
      <p className="text-gray-400 text-sm">This league has no teams yet.</p>
    </div>
  );
}
