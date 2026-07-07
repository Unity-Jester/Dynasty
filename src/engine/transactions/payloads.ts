import { z } from 'zod';
import { firstZodIssueMessage } from '../zodIssue';

// Fixed upper bounds for arrays/records embedded in a transaction payload —
// Rule 2/3. These mirror roster and league-settings caps elsewhere in the
// engine; a real trade never approaches them.
const MAX_TRADE_PLAYERS = 15;
const MAX_TRADE_PICKS = 10;
const MAX_NOTE_LENGTH = 280;
const MAX_BID = 10_000;
const MAX_COMMISH_DETAIL_KEYS = 20;

const TradeAssets = z.object({
  playerIds: z.array(z.string().min(1)).max(MAX_TRADE_PLAYERS),
  pickIds: z.array(z.string().uuid()).max(MAX_TRADE_PICKS),
});

export const TradePayloadSchema = z.object({
  kind: z.literal('trade'),
  proposingTeamId: z.string().uuid(),
  counterpartyTeamId: z.string().uuid(),
  give: TradeAssets,
  receive: TradeAssets,
  note: z.string().max(MAX_NOTE_LENGTH).optional(),
});
export type TradePayload = z.infer<typeof TradePayloadSchema>;

const WaiverResolution = z.object({
  outcome: z.enum(['awarded', 'rejected']),
  reason: z.string().max(MAX_NOTE_LENGTH).optional(),
});

export const WaiverClaimPayloadSchema = z.object({
  kind: z.literal('waiver_claim'),
  teamId: z.string().uuid(),
  addPlayerId: z.string().min(1),
  dropPlayerId: z.string().min(1).nullable(),
  bid: z.number().int().min(0).max(MAX_BID).nullable(),
  resolution: WaiverResolution.optional(),
});
export type WaiverClaimPayload = z.infer<typeof WaiverClaimPayloadSchema>;

const COMMISH_ACTIONS = ['force_add', 'force_drop', 'lineup_edit'] as const;

export const CommishPayloadSchema = z.object({
  kind: z.literal('commish'),
  action: z.enum(COMMISH_ACTIONS),
  teamId: z.string().uuid(),
  detail: z.record(z.string(), z.unknown()).refine(
    (rec) => Object.keys(rec).length <= MAX_COMMISH_DETAIL_KEYS,
    { message: `detail has more than ${MAX_COMMISH_DETAIL_KEYS} keys` },
  ),
});
export type CommishPayload = z.infer<typeof CommishPayloadSchema>;

// Discriminated union on `kind` — the payload's own self-description. This is
// distinct from the `transactions.type` DB column; parseTransactionPayload
// below cross-checks the two and never trusts one without the other (Rule 5).
export const TransactionPayloadSchema = z.discriminatedUnion('kind', [
  TradePayloadSchema,
  WaiverClaimPayloadSchema,
  CommishPayloadSchema,
]);
export type TransactionPayload = z.infer<typeof TransactionPayloadSchema>;

export type TransactionType = 'trade' | 'waiver_claim' | 'commish';

export type ParseTransactionPayloadResult =
  | { ok: true; value: TransactionPayload }
  | { ok: false; error: string };

/**
 * Parses an untrusted `payload` (e.g. a jsonb column read) against the
 * transaction payload union, then cross-checks the row's `type` column
 * matches the payload's own `kind` discriminant. `type` and `kind` share
 * the same string values by construction, so a mismatch here means the row
 * and its payload have drifted apart — always an error, never silently
 * coerced.
 */
export function parseTransactionPayload(
  type: TransactionType,
  payload: unknown,
): ParseTransactionPayloadResult {
  const parsed = TransactionPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { ok: false, error: firstZodIssueMessage(parsed.error) };
  }
  if (parsed.data.kind !== type) {
    return {
      ok: false,
      error: `transaction type "${type}" does not match payload kind "${parsed.data.kind}"`,
    };
  }
  return { ok: true, value: parsed.data };
}
