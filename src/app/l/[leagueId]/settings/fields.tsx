'use client';

// Shared controlled-input primitives for the settings editor. Kept dependency-
// free (plain HTML inputs) and styled to match the dark/gold theme so each
// section component stays under the 150-line cap.

const INPUT_CLASS =
  'w-full px-3 py-2 bg-white/[0.04] border border-white/10 rounded-lg text-white ' +
  'placeholder-gray-500 focus:outline-none focus:border-gold-500/60 focus:bg-white/[0.06] transition-colors';

export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-6 space-y-4">
      <div>
        <h2 className="font-display text-lg text-white">{title}</h2>
        {description && <p className="text-xs text-gray-500 mt-1">{description}</p>}
      </div>
      {children}
    </section>
  );
}

export function NumberField({
  label,
  value,
  onChange,
  step,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step?: number;
  min?: number;
  max?: number;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-gray-400">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const n = Number(e.target.value);
          // Keep state a valid-SHAPED LeagueSettings; zod judges range on save.
          onChange(Number.isNaN(n) ? 0 : n);
        }}
        className={INPUT_CLASS}
      />
    </label>
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-gray-400">{label}</span>
      <select
        value={String(value)}
        onChange={(e) => {
          const raw = e.target.value;
          const match = options.find((o) => String(o.value) === raw);
          if (match) {
            onChange(match.value);
          }
        }}
        className={INPUT_CLASS}
      >
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)} className="bg-sleeper-dark">
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
