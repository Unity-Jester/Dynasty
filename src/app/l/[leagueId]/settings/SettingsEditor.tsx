'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { LeagueSettings } from '@/engine/settings';
import { updateLeagueSettings, type UpdateSettingsResult } from '@/server/actions/settings';
import RosterSlotsSection from './RosterSlotsSection';
import ScoringSection from './ScoringSection';
import WaiversSection from './WaiversSection';
import TradesSection from './TradesSection';
import PlayoffsSection from './PlayoffsSection';

const ERROR_TEXT: Record<Exclude<UpdateSettingsResult, { ok: true }>['error'], string> = {
  invalid_input: 'Some settings are out of range. Check the highlighted values and try again.',
  unauthenticated: 'Your session expired. Sign in again to save settings.',
  not_found: 'This league or season could not be found.',
  not_creator: 'Only the league commissioner can edit settings.',
  season_locked: 'The season has started — settings are locked.',
  team_count_mismatch: 'Team count no longer matches the league. Reload the page and retry.',
};

export default function SettingsEditor({
  leagueId,
  initialSettings,
}: {
  leagueId: string;
  initialSettings: LeagueSettings;
}) {
  const router = useRouter();
  const [settings, setSettings] = useState<LeagueSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    const result = await updateLeagueSettings({ leagueId, settings });
    setSaving(false);
    if (result.ok) {
      setSaved(true);
      router.refresh();
      return;
    }
    const base = ERROR_TEXT[result.error];
    setError(result.detail ? `${base} (${result.detail})` : base);
  };

  const onChange = (next: LeagueSettings) => {
    setSettings(next);
    setSaved(false);
  };

  return (
    <div className="space-y-6">
      <section className="panel p-6">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Teams</p>
        <p className="text-white font-medium mt-0.5">{settings.teamCount}</p>
        <p className="text-xs text-gray-600 mt-1">
          Team count is fixed after league creation and cannot be changed here.
        </p>
      </section>

      <RosterSlotsSection settings={settings} onChange={onChange} />
      <ScoringSection settings={settings} onChange={onChange} />
      <WaiversSection settings={settings} onChange={onChange} />
      <TradesSection settings={settings} onChange={onChange} />
      <PlayoffsSection settings={settings} onChange={onChange} />

      <div className="flex items-center gap-4 sticky bottom-4">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="text-sm text-emerald-400">Settings saved.</span>}
        {error && <span className="text-sm text-sleeper-red">{error}</span>}
      </div>
    </div>
  );
}
