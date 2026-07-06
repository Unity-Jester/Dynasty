'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { importSleeperLeague } from '@/server/actions/import';
import type { ImportReport } from '@/server/import/report';
import EnterStage from './EnterStage';
import ReportView from './ReportView';

type Stage =
  | { kind: 'enter' }
  | { kind: 'report'; report: ImportReport }
  | { kind: 'confirming'; report: ImportReport }
  | { kind: 'failed'; report: ImportReport; errorText: string };

// Friendly text for every ImportActionResult failure variant (Task 6 spec:
// every error the action can return must map to copy here, not a raw code).
const ERROR_TEXT: Record<string, (detail?: string) => string> = {
  invalid_input: (detail) => detail ?? 'Enter a valid Sleeper league id (digits only).',
  unauthenticated: () => 'Your session expired. Sign in again to import a league.',
  fetch_failed: (detail) =>
    `Couldn't reach Sleeper (${detail ?? 'unknown error'}). Check the league ID and try again.`,
  translate_settings: (detail) =>
    `Couldn't read this league's settings (${detail ?? 'unknown error'}).`,
  translate_rosters: (detail) =>
    `Couldn't read this league's rosters (${detail ?? 'unknown error'}).`,
  translate_picks: (detail) =>
    `Couldn't read this league's draft picks (${detail ?? 'unknown error'}).`,
  already_imported: () => 'This Sleeper league has already been imported.',
  blocked: (detail) => detail ?? 'This import is blocked and cannot proceed.',
  db_error: (detail) => `Something went wrong saving the league (${detail ?? 'unknown error'}).`,
};

function errorText(error: string, detail?: string): string {
  const toText = ERROR_TEXT[error];
  return toText ? toText(detail) : 'Something went wrong. Try again.';
}

export default function ImportWizard() {
  const router = useRouter();
  const [leagueId, setLeagueId] = useState('');
  const [loading, setLoading] = useState(false);
  const [enterError, setEnterError] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'enter' });

  const handlePreview = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setEnterError(null);
    const result = await importSleeperLeague({ sleeperLeagueId: leagueId, mode: 'dry_run' });
    setLoading(false);
    if (result.ok) {
      setStage({ kind: 'report', report: result.report });
      return;
    }
    setEnterError(errorText(result.error, result.detail));
  };

  const handleConfirm = async () => {
    if (stage.kind !== 'report' && stage.kind !== 'failed') {
      return;
    }
    const { report } = stage;
    setStage({ kind: 'confirming', report });
    const result = await importSleeperLeague({ sleeperLeagueId: leagueId, mode: 'execute' });
    if (result.ok && result.mode === 'execute') {
      router.push(`/l/${result.leagueId}`);
      return;
    }
    if (!result.ok) {
      setStage({ kind: 'failed', report, errorText: errorText(result.error, result.detail) });
    }
  };

  const handleStartOver = () => {
    setLeagueId('');
    setEnterError(null);
    setStage({ kind: 'enter' });
  };

  if (stage.kind === 'enter') {
    return (
      <EnterStage
        leagueId={leagueId}
        setLeagueId={setLeagueId}
        loading={loading}
        errorMessage={enterError}
        onSubmit={handlePreview}
      />
    );
  }

  return (
    <ReportView
      report={stage.report}
      confirming={stage.kind === 'confirming'}
      errorText={stage.kind === 'failed' ? stage.errorText : null}
      onConfirm={() => {
        void handleConfirm();
      }}
      onStartOver={handleStartOver}
    />
  );
}
