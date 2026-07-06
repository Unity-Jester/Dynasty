'use client';

import { SCORING_STAT_KEYS, type LeagueSettings } from '@/engine/settings';
import { SectionCard } from './fields';
import BonusesEditor from './BonusesEditor';

type StatKey = (typeof SCORING_STAT_KEYS)[number];

export default function ScoringSection({
  settings,
  onChange,
}: {
  settings: LeagueSettings;
  onChange: (next: LeagueSettings) => void;
}) {
  const { rules, bonuses } = settings.scoring;
  const setScoring = (patch: Partial<LeagueSettings['scoring']>) =>
    onChange({ ...settings, scoring: { ...settings.scoring, ...patch } });

  const activeKeys = SCORING_STAT_KEYS.filter((k) => rules[k] !== undefined);
  const inactiveKeys = SCORING_STAT_KEYS.filter((k) => rules[k] === undefined);

  const setRule = (key: StatKey, value: number) =>
    setScoring({ rules: { ...rules, [key]: value } });
  const removeRule = (key: StatKey) => {
    const next = { ...rules };
    delete next[key];
    setScoring({ rules: next });
  };
  const addRule = (key: StatKey) => setScoring({ rules: { ...rules, [key]: 0 } });

  return (
    <SectionCard title="Scoring" description="Points per stat. Add or remove stat categories as needed.">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {activeKeys.map((key) => (
          <div key={key} className="flex items-center gap-2">
            <span className="w-28 text-sm text-gray-300">{key}</span>
            <input
              type="number"
              step={0.01}
              value={rules[key] ?? 0}
              onChange={(e) => {
                const n = Number(e.target.value);
                setRule(key, Number.isNaN(n) ? 0 : n);
              }}
              className="w-24 px-2 py-1.5 bg-white/[0.04] border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-gold-500/60"
            />
            <button
              type="button"
              onClick={() => removeRule(key)}
              className="text-xs text-gray-500 hover:text-sleeper-red transition-colors"
            >
              Remove
            </button>
          </div>
        ))}
      </div>

      {inactiveKeys.length > 0 && (
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">Add stat</span>
          <select
            value=""
            onChange={(e) => {
              const key = e.target.value as StatKey;
              if (key) {
                addRule(key);
              }
            }}
            className="px-3 py-2 bg-white/[0.04] border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-gold-500/60"
          >
            <option value="" className="bg-sleeper-dark">
              Select a stat…
            </option>
            {inactiveKeys.map((key) => (
              <option key={key} value={key} className="bg-sleeper-dark">
                {key}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="keyline" />
      <BonusesEditor bonuses={bonuses} onChange={(next) => setScoring({ bonuses: next })} />
    </SectionCard>
  );
}
