'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { proposeTrade } from '@/server/actions/trades';
import { proposeTradeErrorMessage } from './errorText';
import AssetPicker, { type AssetSelection } from './AssetPicker';
import type { TeamAssets, TeamOption } from './types';

const MAX_NOTE_LENGTH = 280;

function toggleId(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

const EMPTY_SELECTION: AssetSelection = { playerIds: new Set(), pickIds: new Set() };

function isSelectionEmpty(give: AssetSelection, receive: AssetSelection): boolean {
  const giveEmpty = give.playerIds.size === 0 && give.pickIds.size === 0;
  const receiveEmpty = receive.playerIds.size === 0 && receive.pickIds.size === 0;
  return giveEmpty && receiveEmpty;
}

function canSubmitTrade(options: {
  disabled: boolean;
  counterpartyTeamId: string;
  isEmpty: boolean;
  pending: boolean;
}): boolean {
  if (options.disabled || options.pending) return false;
  if (options.counterpartyTeamId === '') return false;
  return !options.isEmpty;
}

export default function ProposeTradeForm({
  myTeamId,
  myAssets,
  counterpartyOptions,
  teamAssetsById,
  disabled,
}: {
  myTeamId: string;
  myAssets: TeamAssets;
  counterpartyOptions: TeamOption[];
  teamAssetsById: Record<string, TeamAssets>;
  disabled: boolean;
}) {
  const router = useRouter();
  const [counterpartyTeamId, setCounterpartyTeamId] = useState('');
  const [give, setGive] = useState<AssetSelection>(EMPTY_SELECTION);
  const [receive, setReceive] = useState<AssetSelection>(EMPTY_SELECTION);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const counterpartyAssets: TeamAssets = useMemo(
    () => teamAssetsById[counterpartyTeamId] ?? { teamId: counterpartyTeamId, players: [], picks: [] },
    [teamAssetsById, counterpartyTeamId],
  );

  const isEmpty = isSelectionEmpty(give, receive);
  const canSubmit = canSubmitTrade({ disabled, counterpartyTeamId, isEmpty, pending });

  function resetSelections() {
    setGive(EMPTY_SELECTION);
    setReceive(EMPTY_SELECTION);
    setNote('');
  }

  async function handleSubmit() {
    setPending(true);
    setError(null);
    setNotice(null);
    const result = await proposeTrade({
      proposingTeamId: myTeamId,
      counterpartyTeamId,
      give: { playerIds: [...give.playerIds], pickIds: [...give.pickIds] },
      receive: { playerIds: [...receive.playerIds], pickIds: [...receive.pickIds] },
      note: note.trim() === '' ? undefined : note.trim(),
    });
    setPending(false);
    if (!result.ok) {
      setError(proposeTradeErrorMessage(result.error, result.detail));
      return;
    }
    resetSelections();
    setNotice(
      result.warning
        ? `Trade proposed. Warning: ${result.warning.detail} — the receiving team must clear roster space before it can be accepted.`
        : 'Trade proposed.',
    );
    router.refresh();
  }

  return (
    <section className="space-y-4">
      <h2 className="font-display text-lg text-white">Propose a trade</h2>
      <div>
        <label htmlFor="counterparty" className="block text-sm text-gray-400 mb-1">
          Trade with
        </label>
        <select
          id="counterparty"
          value={counterpartyTeamId}
          disabled={disabled}
          onChange={(e) => {
            setCounterpartyTeamId(e.target.value);
            setReceive(EMPTY_SELECTION);
          }}
          className="w-full sm:w-64 bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
        >
          <option value="">Select a team&hellip;</option>
          {counterpartyOptions.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid sm:grid-cols-2 gap-6">
        <AssetPicker title="You give" assets={myAssets} selection={give} disabled={disabled} onTogglePlayer={(id) => setGive((s) => ({ ...s, playerIds: toggleId(s.playerIds, id) }))} onTogglePick={(id) => setGive((s) => ({ ...s, pickIds: toggleId(s.pickIds, id) }))} />
        <AssetPicker title="You receive" assets={counterpartyAssets} selection={receive} disabled={disabled || counterpartyTeamId === ''} onTogglePlayer={(id) => setReceive((s) => ({ ...s, playerIds: toggleId(s.playerIds, id) }))} onTogglePick={(id) => setReceive((s) => ({ ...s, pickIds: toggleId(s.pickIds, id) }))} />
      </div>
      <div>
        <label htmlFor="note" className="block text-sm text-gray-400 mb-1">
          Note (optional)
        </label>
        <textarea
          id="note"
          value={note}
          disabled={disabled}
          maxLength={MAX_NOTE_LENGTH}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          className="w-full bg-white/[0.04] border border-white/[0.1] rounded-lg px-3 py-2 text-sm text-white disabled:opacity-50"
        />
        <p className="text-[11px] text-gray-500 mt-1">{note.length}/{MAX_NOTE_LENGTH}</p>
      </div>
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit}
          className="px-6 py-3 bg-gradient-to-b from-gold-400 to-gold-600 text-sleeper-dark font-semibold rounded-xl hover:shadow-gold-glow hover:brightness-110 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {pending ? 'Proposing…' : 'Propose trade'}
        </button>
        {notice && <span className="text-sm text-emerald-400">{notice}</span>}
        {error && <span className="text-sm text-sleeper-red">{error}</span>}
      </div>
    </section>
  );
}
