/**
 * Applying the user's edits to the rows before the document is built.
 *
 * Three edits are possible on the review screen:
 *   - a purpose typed against a row
 *   - a row deleted as a personal charge
 *   - a statement amount overridden by hand
 *
 * THE DANGEROUS PART IS RE-KEYING. Purposes and receipt images are keyed by a
 * row's position. Delete row 3 and every row after it shifts down one — so
 * without care, row 4's receipt ends up under row 5's expense. That failure is
 * invisible: right count, right total, plausible-looking document, wrong
 * receipts. It's the same shape as the purpose-ordering bug caught in step 4.
 *
 * So this is one pure function, re-keying all three things together, tested by
 * `npm run verify:blocking` with no API key and no real data.
 */
import type { StatementRow } from "@/lib/statement/parseStatement";
import type { Purposes } from "./reportFormat";

/** A hand-edited amount. Both fields optional — usually only one is touched. */
export interface AmountOverride {
  expenseAmount?: string;
  billedAmount?: string;
}

export interface RowEdits {
  purposes?: Purposes;
  /** Row indexes removed from the report entirely. */
  excluded?: number[];
  /** Row index -> amounts typed by hand, replacing the statement's. */
  overrides?: Record<number, AmountOverride>;
}

export interface AppliedEdits {
  rows: StatementRow[];
  purposes: Purposes;
  /** newRowIndex -> imageIndex */
  assignments: Record<number, number>;
  /** New indexes whose amounts were overridden — surfaced in the summary. */
  overriddenRows: number[];
  /** How many rows were dropped. */
  excludedCount: number;
}

export function applyEdits(
  rows: StatementRow[],
  assignments: Record<number, number>,
  edits: RowEdits,
): AppliedEdits {
  const excluded = new Set(edits.excluded ?? []);
  const purposes = edits.purposes ?? {};
  const overrides = edits.overrides ?? {};

  // Build the old -> new index map ONCE, and route everything through it.
  // Anything that keys off a row position must use this map; nothing may assume
  // positions are unchanged.
  const oldToNew = new Map<number, number>();
  const kept: StatementRow[] = [];

  for (const [oldIndex, row] of rows.entries()) {
    if (excluded.has(oldIndex)) continue;
    const override = overrides[oldIndex];
    oldToNew.set(oldIndex, kept.length);
    kept.push(
      override
        ? {
            ...row,
            expenseAmount: override.expenseAmount ?? row.expenseAmount,
            billedAmount: override.billedAmount ?? row.billedAmount,
          }
        : row,
    );
  }

  const newPurposes: Purposes = {};
  for (const [oldText, purpose] of Object.entries(purposes)) {
    const next = oldToNew.get(Number(oldText));
    if (next !== undefined && purpose?.trim()) newPurposes[next] = purpose;
  }

  const newAssignments: Record<number, number> = {};
  for (const [oldText, imageIndex] of Object.entries(assignments)) {
    const next = oldToNew.get(Number(oldText));
    if (next !== undefined) newAssignments[next] = imageIndex;
  }

  const overriddenRows: number[] = [];
  for (const oldText of Object.keys(overrides)) {
    const next = oldToNew.get(Number(oldText));
    if (next !== undefined) overriddenRows.push(next);
  }

  return {
    rows: kept,
    purposes: newPurposes,
    assignments: newAssignments,
    overriddenRows: overriddenRows.sort((a, b) => a - b),
    excludedCount: rows.length - kept.length,
  };
}
