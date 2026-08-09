/**
 * Reconciliation — turning match results into a list of things a person must
 * decide, and refusing to build a report until they have.
 *
 * This is the accounting discipline of the manual process, which is the whole
 * reason the team would trust the tool. Every statement line and every receipt
 * has to be accounted for. A report with a quiet gap in it is worse than no
 * report, because it looks finished.
 *
 * NO AI HERE, and no network. Pure functions over the match result, so the
 * blocking rule can be tested exhaustively for free — `npm run verify:blocking`.
 *
 * The four flag types come from PRD.md:
 *   missing-receipt   a statement line with nothing attached
 *   extra-receipt     a receipt that matches no line
 *   ambiguous         a receipt that fits several lines equally well
 *   duplicate         the same receipt supplied twice
 *   amount-mismatch   a near-match where the amounts disagree (tip, FX, partial)
 */
import type { StatementRow } from "@/lib/statement/parseStatement";
import { amountToNumber, formatMoney } from "@/lib/statement/format";
import {
  MAX_DAY_GAP,
  matchReceipts,
  merchantOverlap,
  toDayNumber,
  type Match,
  type ReceiptCandidate,
} from "./match";

export type FlagKind =
  | "missing-receipt"
  | "extra-receipt"
  | "ambiguous"
  | "duplicate"
  | "amount-mismatch";

export interface FlagChoice {
  id: string;
  label: string;
  /** What this choice does to the report, in plain language. */
  effect: string;
}

export interface Flag {
  id: string;
  kind: FlagKind;
  /** Plain-language statement of the problem. Never an error code. */
  message: string;
  rowIndex?: number;
  imageIndex?: number;
  /** For ambiguous: the lines it could belong to. */
  rowIndexes?: number[];
  choices: FlagChoice[];
}

/** flagId -> chosen choice id. Choices that attach a receipt encode it as "attach:<imageIndex>". */
export type Resolutions = Record<string, string>;

export interface ReconcileState {
  matches: Match[];
  flags: Flag[];
  /** Receipts the matcher attached on its own, before any human decision. */
  autoAssignments: Record<number, number>;
}

const ATTACH = "attach:";

/**
 * Receipts that are the same receipt supplied twice — e.g. an Uber trip that
 * appears both in the .docx summary and as a separate screenshot. Same merchant,
 * same amount, same day. The first is kept; the rest are flagged for removal.
 */
function findDuplicates(receipts: ReceiptCandidate[]): Map<number, number> {
  const firstSeen = new Map<string, number>();
  const duplicateOf = new Map<number, number>();

  for (const r of receipts) {
    if (!r.amount || !r.date) continue;
    const key = [
      r.amount,
      r.date,
      (r.merchant ?? "").toUpperCase().replace(/[^A-Z0-9]/g, ""),
    ].join("|");
    const seen = firstSeen.get(key);
    if (seen === undefined) firstSeen.set(key, r.imageIndex);
    else duplicateOf.set(r.imageIndex, seen);
  }
  return duplicateOf;
}

/**
 * A receipt and a line that look like the same purchase but disagree on amount —
 * a tip added after the fact, a currency conversion, a partial refund. The
 * matcher rejects these outright because it requires the amount to agree, which
 * is correct: it shouldn't guess. But leaving them as an unrelated
 * "missing receipt" plus "extra receipt" hides the connection from the user.
 */
function findAmountMismatches(
  rows: StatementRow[],
  receipts: ReceiptCandidate[],
  freeRows: Set<number>,
  freeImages: Set<number>,
): { rowIndex: number; imageIndex: number }[] {
  const out: { rowIndex: number; imageIndex: number }[] = [];
  const takenRows = new Set<number>();
  const takenImages = new Set<number>();

  for (const r of receipts) {
    if (!freeImages.has(r.imageIndex) || !r.date || !r.amount) continue;
    if (takenImages.has(r.imageIndex)) continue;
    const rDay = toDayNumber(r.date);
    if (rDay === null) continue;

    for (const [i, row] of rows.entries()) {
      if (!freeRows.has(i) || takenRows.has(i)) continue;
      const rowDay = toDayNumber(row.date);
      if (rowDay === null || Math.abs(rowDay - rDay) > MAX_DAY_GAP) continue;
      if (!r.merchant || merchantOverlap(row.vendor, r.merchant) < 0.5) continue;

      // The amounts must actually DISAGREE. Without this the check swallowed
      // pairs whose amounts were identical — which is not a mismatch, it's an
      // ambiguous receipt that the user needs to place. The ambiguity flag then
      // never appeared, and a receipt could have been attached to the wrong one
      // of two identical lines without anyone being asked.
      const cents = (v: string) => Math.round(amountToNumber(v) * 100);
      const receiptCents = Math.round(Number(r.amount) * 100);
      if (
        Math.abs(receiptCents) === Math.abs(cents(row.billedAmount)) ||
        Math.abs(receiptCents) === Math.abs(cents(row.expenseAmount))
      ) {
        continue;
      }

      out.push({ rowIndex: i, imageIndex: r.imageIndex });
      takenRows.add(i);
      takenImages.add(r.imageIndex);
      break;
    }
  }
  return out;
}

function describeRow(row: StatementRow): string {
  return `${row.vendor} — ${row.date}, ${formatMoney(row.billedAmount)}`;
}

function describeReceipt(r: ReceiptCandidate): string {
  const bits: string[] = [];
  if (r.merchant) bits.push(r.merchant);
  if (r.date) bits.push(r.date);
  if (r.amount) bits.push(formatMoney(r.amount));
  return bits.length ? bits.join(" — ") : `${r.source} (couldn't be read)`;
}

export function reconcile(
  rows: StatementRow[],
  receipts: ReceiptCandidate[],
): ReconcileState {
  const duplicateOf = findDuplicates(receipts);
  // Duplicates never enter matching — otherwise a copy could claim a line and
  // leave the original looking like an extra receipt.
  const forMatching = receipts.filter((r) => !duplicateOf.has(r.imageIndex));

  const result = matchReceipts(rows, forMatching);

  const autoAssignments: Record<number, number> = {};
  for (const m of result.matches) autoAssignments[m.rowIndex] = m.imageIndex;

  const byImage = new Map(receipts.map((r) => [r.imageIndex, r]));
  const flags: Flag[] = [];

  const freeRows = new Set(result.rowsWithoutReceipt);
  const freeImages = new Set([
    ...result.unmatched,
    ...result.ambiguous.map((a) => a.imageIndex),
  ]);

  // Amount mismatches first — they explain a row and a receipt at once, so
  // finding them removes two confusing flags and replaces them with one clear one.
  const mismatches = findAmountMismatches(rows, receipts, freeRows, freeImages);
  for (const { rowIndex, imageIndex } of mismatches) {
    freeRows.delete(rowIndex);
    freeImages.delete(imageIndex);
    const row = rows[rowIndex];
    const r = byImage.get(imageIndex)!;
    const diff = Math.abs(
      amountToNumber(row.billedAmount) - Number(r.amount ?? 0),
    );
    flags.push({
      id: `mismatch:${rowIndex}:${imageIndex}`,
      kind: "amount-mismatch",
      rowIndex,
      imageIndex,
      message:
        `This receipt looks like the same purchase as ${describeRow(row)}, but the ` +
        `amounts differ by ${formatMoney(diff)} — the receipt says ` +
        `${formatMoney(r.amount ?? "0")}. A tip added afterwards or a currency ` +
        `conversion usually explains it.`,
      choices: [
        {
          id: `${ATTACH}${imageIndex}`,
          label: "Yes, same purchase — attach it",
          effect: "The statement amount is used in the report, as always.",
        },
        {
          id: "not-related",
          label: "No, different purchase",
          effect: "The line goes back to needing a receipt.",
        },
      ],
    });
  }

  for (const [imageIndex, originalIndex] of duplicateOf) {
    const r = byImage.get(imageIndex)!;
    flags.push({
      id: `duplicate:${imageIndex}`,
      kind: "duplicate",
      imageIndex,
      message:
        `${describeReceipt(r)} was supplied twice — once in ` +
        `${byImage.get(originalIndex)?.source ?? "another file"} and again in ` +
        `${r.source}. Only one copy belongs in the report.`,
      choices: [
        {
          id: "drop-duplicate",
          label: "Drop the duplicate",
          effect: "One copy is kept and attached to its line.",
        },
        {
          id: "keep-both",
          label: "They're different receipts",
          effect: "Both are kept and matched separately.",
        },
      ],
    });
  }

  for (const a of result.ambiguous) {
    if (!freeImages.has(a.imageIndex)) continue;
    const r = byImage.get(a.imageIndex)!;
    flags.push({
      id: `ambiguous:${a.imageIndex}`,
      kind: "ambiguous",
      imageIndex: a.imageIndex,
      rowIndexes: a.rowIndexes,
      message:
        `${describeReceipt(r)} fits ${a.rowIndexes.length} statement lines ` +
        `equally well. Guessing would be wrong about half the time, so it needs ` +
        `you to pick.`,
      choices: a.rowIndexes.map((i) => ({
        id: `row:${i}`,
        label: describeRow(rows[i]),
        effect: "The receipt is attached to this line.",
      })),
    });
  }

  for (const rowIndex of freeRows) {
    const row = rows[rowIndex];
    const spare = [...freeImages].filter(
      (i) => !mismatches.some((m) => m.imageIndex === i),
    );
    flags.push({
      id: `missing:${rowIndex}`,
      kind: "missing-receipt",
      rowIndex,
      message: `${describeRow(row)} is on your statement, but no receipt matches it.`,
      choices: [
        ...spare.map((i) => ({
          id: `${ATTACH}${i}`,
          label: `Attach: ${describeReceipt(byImage.get(i)!)}`,
          effect: "That receipt is used for this line.",
        })),
        {
          id: "receipt-lost",
          label: "Receipt lost — include anyway",
          effect: "The line appears in the report with no receipt beneath it.",
        },
        {
          id: "exclude",
          label: "Personal charge — leave it out",
          effect: "The line is removed from the report and from the total.",
        },
      ],
    });
  }

  for (const imageIndex of freeImages) {
    if (mismatches.some((m) => m.imageIndex === imageIndex)) continue;
    if (result.ambiguous.some((a) => a.imageIndex === imageIndex)) continue;
    const r = byImage.get(imageIndex)!;
    flags.push({
      id: `extra:${imageIndex}`,
      kind: "extra-receipt",
      imageIndex,
      message:
        `${describeReceipt(r)} doesn't match any line on your statement. It may ` +
        `be a cash expense, a different month, or paid on another card.`,
      choices: [
        {
          id: "ignore",
          label: "Leave it out",
          effect: "The receipt isn't used. Nothing changes on the statement side.",
        },
      ],
    });
  }

  return { matches: result.matches, flags, autoAssignments };
}

export interface AppliedResolutions {
  /** rowIndex -> imageIndex, after human decisions. */
  assignments: Record<number, number>;
  /** Rows removed from the report entirely — personal charges. */
  excludedRows: number[];
  /** Flags still needing a decision. Report generation is blocked while non-empty. */
  outstanding: Flag[];
}

/**
 * Apply the user's decisions and report what's still outstanding.
 *
 * Used by the UI to decide whether the download button is enabled, and by the
 * server to refuse the request if it isn't. The server check matters: a disabled
 * button is a courtesy, not a control.
 */
export function applyResolutions(
  state: ReconcileState,
  resolutions: Resolutions,
): AppliedResolutions {
  const assignments = { ...state.autoAssignments };
  const excludedRows: number[] = [];
  const outstanding: Flag[] = [];

  for (const flag of state.flags) {
    const choice = resolutions[flag.id];
    if (!choice) {
      outstanding.push(flag);
      continue;
    }

    if (choice.startsWith(ATTACH) && flag.rowIndex !== undefined) {
      assignments[flag.rowIndex] = Number(choice.slice(ATTACH.length));
    } else if (choice.startsWith("row:") && flag.imageIndex !== undefined) {
      assignments[Number(choice.slice(4))] = flag.imageIndex;
    } else if (choice === "exclude" && flag.rowIndex !== undefined) {
      excludedRows.push(flag.rowIndex);
    }
    // "receipt-lost", "ignore", "drop-duplicate", "keep-both" and "not-related"
    // need no assignment — they resolve the flag by accepting the situation.
  }

  return { assignments, excludedRows, outstanding };
}

/**
 * Drop the preview image before sending readings on to generation.
 *
 * The thumbnail exists only so a person can see what they're deciding about on
 * screen. It has no business travelling back to the server.
 */
export function stripThumb<T extends { thumb?: string }>(r: T): Omit<T, "thumb"> {
  const copy = { ...r };
  delete copy.thumb;
  return copy;
}
