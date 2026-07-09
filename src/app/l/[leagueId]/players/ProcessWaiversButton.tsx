'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { processWaiversNow } from '@/server/actions/waivers';
import type { RunWaiversResult } from '@/server/jobs/runWaivers';
import { processWaiversErrorMessage } from './errorText';

function ResultSummary({ result }: { result: RunWaiversResult }) {
  return (
    <div className="text-sm text-gray-300 space-y-1">
      <p>
        Processed {result.leaguesProcessed} league{result.leaguesProcessed === 1 ? '' : 's'} — {result.awarded}{' '}
        awarded, {result.rejected} rejected
        {result.skippedLeagues > 0 ? `, ${result.skippedLeagues} skipped` : ''}.
      </p>
      {result.errors.length > 0 && (
        <ul className="text-xs text-amber-300 list-disc list-inside space-y-0.5">
          {result.errors.map((line, i) => (
            // Error lines aren't guaranteed unique (two leagues can fail the
            // same way); position is part of the key, same convention as
            // trades/TradeAssetSummary.tsx's AssetList.
            <li key={`${line}-${i}`}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Creator-only "run waivers now" button, gated behind an explicit confirm step. */
export default function ProcessWaiversButton({ leagueId }: { leagueId: string }) {
  const router = useRouter();
  const [armed, setArmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RunWaiversResult | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    const outcome = await processWaiversNow(leagueId);
    setPending(false);
    setArmed(false);
    if (!outcome.ok) {
      setError(processWaiversErrorMessage(outcome.error));
      return;
    }
    setResult(outcome.result);
    router.refresh();
  }

  if (!armed) {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => setArmed(true)}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-white/[0.06] text-white hover:bg-white/[0.1] border border-white/10 transition-colors"
        >
          Process waivers now
        </button>
        {result && <ResultSummary result={result} />}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-amber-300">
        Run the waiver process for this league right now? This resolves every pending claim immediately.
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void run()}
          disabled={pending}
          className="px-4 py-2 rounded-lg text-sm font-semibold bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Processing…' : 'Confirm — process now'}
        </button>
        <button
          type="button"
          onClick={() => setArmed(false)}
          disabled={pending}
          className="px-4 py-2 rounded-lg text-sm font-medium text-gray-400 hover:text-white transition-colors"
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-sm text-sleeper-red">{error}</p>}
    </div>
  );
}
