import type { ImportReport } from '@/server/import/report';
import TeamsTable from './TeamsTable';
import WarningsList from './WarningsList';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <p className="text-xs text-gray-500 uppercase tracking-wide">{label}</p>
      <p className="text-white font-medium mt-0.5">{value}</p>
    </div>
  );
}

function SummaryStrip({ report }: { report: ImportReport }) {
  return (
    <section className="panel divide-y sm:divide-y-0 sm:divide-x divide-white/[0.06] flex flex-col sm:flex-row">
      <Stat label="Teams" value={String(report.teamCount)} />
      <Stat label="Pick base" value={`${report.pickBaseSize} picks`} />
      <Stat label="Trades applied" value={String(report.tradesApplied)} />
    </section>
  );
}

function Blockers({ blockers }: { blockers: readonly string[] }) {
  if (blockers.length === 0) {
    return null;
  }
  return (
    <div className="rounded-xl border border-sleeper-red/30 bg-sleeper-red/[0.08] p-4">
      <h3 className="text-xs uppercase tracking-wide text-sleeper-red font-medium mb-1.5">
        Blockers — import cannot proceed
      </h3>
      <ul className="space-y-1">
        {blockers.map((blocker) => (
          <li key={blocker} className="text-sm text-sleeper-red flex gap-2">
            <span aria-hidden="true">-</span>
            <span>{blocker}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function ReportView({
  report,
  confirming,
  errorText,
  onConfirm,
  onStartOver,
}: {
  report: ImportReport;
  confirming: boolean;
  errorText: string | null;
  onConfirm: () => void;
  onStartOver: () => void;
}) {
  const hasBlockers = report.blockers.length > 0;
  const hasWarnings =
    report.settingsWarnings.length > 0 ||
    report.rosterWarnings.length > 0 ||
    report.pickWarnings.length > 0;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-display text-2xl text-white">{report.leagueName}</h2>
        <p className="text-sm text-gray-400 mt-1">{report.season} season</p>
      </div>

      <SummaryStrip report={report} />

      <section className="panel p-4">
        <h3 className="font-display text-lg text-white mb-3">Teams</h3>
        <TeamsTable teams={report.teams} />
      </section>

      {hasWarnings && (
        <section className="panel p-4 space-y-4">
          <WarningsList heading="Settings" warnings={report.settingsWarnings} />
          <WarningsList heading="Rosters" warnings={report.rosterWarnings} />
          <WarningsList heading="Picks" warnings={report.pickWarnings} />
        </section>
      )}

      <Blockers blockers={report.blockers} />

      {errorText && <p className="text-sleeper-red text-sm text-center">{errorText}</p>}

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={onConfirm}
          disabled={hasBlockers || confirming}
          className="px-4 py-3.5 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
        >
          {confirming ? 'Importing…' : 'Confirm import'}
        </button>
        <button
          type="button"
          onClick={onStartOver}
          className="text-sm text-gray-400 hover:text-gold-400 transition-colors"
        >
          Start over
        </button>
      </div>
    </div>
  );
}
