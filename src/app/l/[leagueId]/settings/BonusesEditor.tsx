'use client';

import { SCORING_STAT_KEYS, type LeagueSettings } from '@/engine/settings';

const MAX_BONUSES = 50;

type Bonus = LeagueSettings['scoring']['bonuses'][number];

export default function BonusesEditor({
  bonuses,
  onChange,
}: {
  bonuses: readonly Bonus[];
  onChange: (next: Bonus[]) => void;
}) {
  const setAt = (i: number, patch: Partial<Bonus>) =>
    onChange(bonuses.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const removeAt = (i: number) => onChange(bonuses.filter((_, j) => j !== i));
  const add = () =>
    onChange([...bonuses, { stat: SCORING_STAT_KEYS[0], threshold: 100, points: 1 }]);

  const num = (raw: string, fallback: number) => {
    const n = Number(raw);
    return Number.isNaN(n) ? fallback : n;
  };

  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-400">Bonuses ({bonuses.length}/{MAX_BONUSES})</p>
      {bonuses.map((bonus, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <select
            value={bonus.stat}
            onChange={(e) => setAt(i, { stat: e.target.value as Bonus['stat'] })}
            className="px-2 py-1.5 bg-white/[0.04] border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-gold-500/60"
          >
            {SCORING_STAT_KEYS.map((k) => (
              <option key={k} value={k} className="bg-sleeper-dark">
                {k}
              </option>
            ))}
          </select>
          <span className="text-xs text-gray-500">≥</span>
          <input
            type="number"
            value={bonus.threshold}
            onChange={(e) => setAt(i, { threshold: num(e.target.value, bonus.threshold) })}
            className="w-24 px-2 py-1.5 bg-white/[0.04] border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-gold-500/60"
            aria-label="threshold"
          />
          <span className="text-xs text-gray-500">→</span>
          <input
            type="number"
            step={0.5}
            value={bonus.points}
            onChange={(e) => setAt(i, { points: num(e.target.value, bonus.points) })}
            className="w-24 px-2 py-1.5 bg-white/[0.04] border border-white/10 rounded-lg text-white text-sm focus:outline-none focus:border-gold-500/60"
            aria-label="points"
          />
          <span className="text-xs text-gray-500">pts</span>
          <button
            type="button"
            onClick={() => removeAt(i)}
            className="text-xs text-gray-500 hover:text-sleeper-red transition-colors"
          >
            Remove
          </button>
        </div>
      ))}
      {bonuses.length < MAX_BONUSES && (
        <button
          type="button"
          onClick={add}
          className="text-xs text-gold-400 hover:text-gold-300 transition-colors"
        >
          + Add bonus
        </button>
      )}
    </div>
  );
}
