export default function EnterStage({
  leagueId,
  setLeagueId,
  loading,
  errorMessage,
  onSubmit,
}: {
  leagueId: string;
  setLeagueId: (value: string) => void;
  loading: boolean;
  errorMessage: string | null;
  onSubmit: (e: React.FormEvent) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="panel p-6 space-y-4">
      <div className="space-y-2">
        <label htmlFor="sleeper-league-id" className="block text-sm text-gray-400">
          Sleeper league ID
        </label>
        <input
          id="sleeper-league-id"
          type="text"
          inputMode="numeric"
          value={leagueId}
          onChange={(e) => setLeagueId(e.target.value.replace(/\D/g, ''))}
          required
          maxLength={30}
          placeholder="921234567890123456"
          className="w-full px-4 py-3.5 bg-white/[0.04] border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-gold-500/60 focus:bg-white/[0.06] transition-colors"
          autoFocus
        />
        <p className="text-xs text-gray-600">
          Find it in the Sleeper app under League Settings, or in your league&apos;s URL.
        </p>
      </div>

      <button
        type="submit"
        disabled={loading || !leagueId}
        className="w-full px-4 py-3.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
      >
        {loading ? 'Checking…' : 'Preview import'}
      </button>

      {errorMessage && <p className="text-sleeper-red text-sm text-center">{errorMessage}</p>}
    </form>
  );
}
