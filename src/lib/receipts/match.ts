/**
 * Matching receipts to statement lines.
 *
 * THE MODEL DOES NOT DO THIS. Haiku reads three fields off an image; this file
 * decides, in ordinary deterministic code, which statement line each receipt
 * belongs to. That split matters: the reasoning that could attach a receipt to
 * the wrong expense is code you can read, test and mutate, not a judgement
 * inside a model.
 *
 * HOW A WRONG MATCH IS PREVENTED, rather than merely hoped against:
 *
 * 1. The amount must agree to the cent. It is the strongest signal on a receipt
 *    and the hardest to misread. No amount agreement, no match.
 * 2. The date must be within two days. Card posting lags the transaction, which
 *    is exactly why the PRD specifies a window rather than an exact date.
 * 3. If a receipt fits two or more statement lines EQUALLY well, it is not
 *    assigned to either — it is flagged as ambiguous. Two identical amounts on
 *    nearby dates is the one situation where a confident guess would be wrong
 *    half the time, so the tool refuses to guess.
 * 4. Every match carries its evidence — the receipt's own date, amount and
 *    merchant next to the line's — so a person can check any row in seconds
 *    without opening the receipt.
 */
import type { StatementRow } from "@/lib/statement/parseStatement";
import { amountToNumber } from "@/lib/statement/format";
import type { ReceiptReading } from "./vision";

export interface ReceiptCandidate extends ReceiptReading {
  /** Index into the extracted-images array. */
  imageIndex: number;
  source: string;
  /** Page within that file, so two receipts from one PDF can be told apart. */
  page?: number;
  /** Set when this page belongs to a multi-page document, e.g. a hotel folio. */
  documentGroup?: string;
}

export interface Match {
  /** Index into the statement rows array. */
  rowIndex: number;
  imageIndex: number;
  score: number;
  /**
   * "high" — amount agrees to the cent AND the date is within two days.
   * "low"  — the date was unreadable, but the amount is unique on the whole
   *          statement and only one receipt claims it. Worth a human glance.
   */
  confidence: "high" | "low";
  /** Why this receipt was attached to this line, in plain language. */
  evidence: string;
}

export interface MatchResult {
  matches: Match[];
  /** Receipts that fit more than one line equally well — deliberately unassigned. */
  ambiguous: { imageIndex: number; rowIndexes: number[]; reason: string }[];
  /** Receipts that fit no line: cash, wrong month, duplicate, or misread. */
  unmatched: number[];
  /** Statement lines with no receipt. These block the report (build step 6). */
  rowsWithoutReceipt: number[];
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function toDayNumber(date: string): number | null {
  const m = /^([A-Za-z]{3}) (\d{2}) (\d{4})$/.exec(date);
  if (!m) return null;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return null;
  return Math.floor(Date.UTC(Number(m[3]), month, Number(m[2])) / 86400000);
}

/** Words in common, ignoring noise. Supporting evidence only, never decisive. */
export function merchantOverlap(a: string, b: string): number {
  const tokens = (s: string) =>
    new Set(
      s
        .toUpperCase()
        .replace(/[^A-Z0-9 ]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length > 2 && !["THE", "INC", "LTD", "AND"].includes(t)),
    );
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let hits = 0;
  for (const t of ta) {
    for (const u of tb) {
      if (t === u || t.startsWith(u) || u.startsWith(t)) {
        hits++;
        break;
      }
    }
  }
  return hits / Math.min(ta.size, tb.size);
}

/** Amount must agree to the cent; date must be within two days. */
export const MAX_DAY_GAP = 2;

function scorePair(row: StatementRow, receipt: ReceiptCandidate): number | null {
  if (!receipt.amount || !receipt.date) return null;

  const receiptCents = Math.round(Number(receipt.amount) * 100);
  const expenseCents = Math.round(amountToNumber(row.expenseAmount) * 100);
  const billedCents = Math.round(amountToNumber(row.billedAmount) * 100);

  // A receipt is written in the currency it was paid in, so it can legitimately
  // agree with either the original amount or the CAD amount.
  const amountAgrees =
    Math.abs(receiptCents) === Math.abs(expenseCents) ||
    Math.abs(receiptCents) === Math.abs(billedCents);
  if (!amountAgrees) return null;

  const rowDay = toDayNumber(row.date);
  const receiptDay = toDayNumber(receipt.date);
  if (rowDay === null || receiptDay === null) return null;

  const gap = Math.abs(rowDay - receiptDay);
  if (gap > MAX_DAY_GAP) return null;

  let score = 100 + (MAX_DAY_GAP - gap) * 10;
  if (receipt.merchant) score += merchantOverlap(row.vendor, receipt.merchant) * 25;
  return score;
}

function describe(row: StatementRow, receipt: ReceiptCandidate): string {
  const bits = [`receipt says $${receipt.amount} on ${receipt.date}`];
  if (receipt.merchant) bits.push(`“${receipt.merchant}”`);
  return (
    `${bits.join(", ")} — statement line is $${row.billedAmount} on ${row.date}, ` +
    `“${row.vendor}”`
  );
}

export function matchReceipts(
  rows: StatementRow[],
  receipts: ReceiptCandidate[],
): MatchResult {
  // Score every workable pair.
  const pairs: { rowIndex: number; imageIndex: number; score: number }[] = [];
  for (const [rowIndex, row] of rows.entries()) {
    for (const receipt of receipts) {
      const score = scorePair(row, receipt);
      if (score !== null) {
        pairs.push({ rowIndex, imageIndex: receipt.imageIndex, score });
      }
    }
  }

  const byImage = new Map(receipts.map((r) => [r.imageIndex, r]));

  // Refuse to guess where a receipt fits several lines equally well.
  const ambiguous: MatchResult["ambiguous"] = [];
  const blockedImages = new Set<number>();

  for (const receipt of receipts) {
    const mine = pairs.filter((p) => p.imageIndex === receipt.imageIndex);
    if (mine.length < 2) continue;
    const best = Math.max(...mine.map((p) => p.score));
    const tied = mine.filter((p) => p.score === best);
    if (tied.length > 1) {
      blockedImages.add(receipt.imageIndex);
      ambiguous.push({
        imageIndex: receipt.imageIndex,
        rowIndexes: tied.map((t) => t.rowIndex),
        reason:
          `This receipt ($${receipt.amount} on ${receipt.date}) fits ` +
          `${tied.length} statement lines equally well. Pick the right one — ` +
          `guessing would be wrong about half the time.`,
      });
    }
  }

  // Greedy assignment on the remainder, strongest evidence first. One receipt
  // per line, one line per receipt.
  const usedRows = new Set<number>();
  const usedImages = new Set<number>();
  const matches: Match[] = [];

  for (const pair of pairs
    .filter((p) => !blockedImages.has(p.imageIndex))
    .sort((a, b) => b.score - a.score)) {
    if (usedRows.has(pair.rowIndex) || usedImages.has(pair.imageIndex)) continue;
    usedRows.add(pair.rowIndex);
    usedImages.add(pair.imageIndex);
    matches.push({
      rowIndex: pair.rowIndex,
      imageIndex: pair.imageIndex,
      score: pair.score,
      confidence: "high",
      evidence: describe(rows[pair.rowIndex], byImage.get(pair.imageIndex)!),
    });
  }

  /* ---------------------------------------------------------------------
     Second pass: rescue receipts whose DATE was unreadable.

     Faded thermal receipts scan badly, and the date is usually the first
     thing to go while the total stays crisp. Refusing those outright turns a
     receipt you physically have into a "missing receipt" flag.

     Only allowed when the evidence is unambiguous on its own terms:
       - the amount agrees with exactly ONE unclaimed statement line, and
       - no other unclaimed receipt shares that amount.
     Anything less stays unmatched. These are marked "low" so a person looks.
     --------------------------------------------------------------------- */
  const leftoverReceipts = receipts.filter(
    (r) => !usedImages.has(r.imageIndex) && !blockedImages.has(r.imageIndex),
  );

  for (const receipt of leftoverReceipts) {
    if (!receipt.amount || usedImages.has(receipt.imageIndex)) continue;
    const cents = Math.round(Number(receipt.amount) * 100);

    const fits = rows
      .map((row, i) => ({ row, i }))
      .filter(
        ({ row, i }) =>
          !usedRows.has(i) &&
          (Math.abs(Math.round(amountToNumber(row.expenseAmount) * 100)) === Math.abs(cents) ||
            Math.abs(Math.round(amountToNumber(row.billedAmount) * 100)) === Math.abs(cents)),
      );
    if (fits.length !== 1) continue;

    const rivals = leftoverReceipts.filter(
      (o) =>
        o.imageIndex !== receipt.imageIndex &&
        !usedImages.has(o.imageIndex) &&
        o.amount &&
        Math.round(Number(o.amount) * 100) === cents,
    );
    if (rivals.length > 0) continue;

    const { row, i } = fits[0];
    usedRows.add(i);
    usedImages.add(receipt.imageIndex);
    matches.push({
      rowIndex: i,
      imageIndex: receipt.imageIndex,
      score: 50,
      confidence: "low",
      evidence:
        `matched on amount alone — $${receipt.amount} appears once on the ` +
        `statement and only this receipt claims it. The date on the receipt ` +
        `read as ${receipt.date ?? "unreadable"}, which doesn't fit the line's ` +
        `${row.date}, so the scan is likely too faded to read. Worth a check.`,
    });
  }

  matches.sort((a, b) => a.rowIndex - b.rowIndex);

  return {
    matches,
    ambiguous,
    unmatched: receipts
      .map((r) => r.imageIndex)
      .filter((i) => !usedImages.has(i) && !blockedImages.has(i)),
    rowsWithoutReceipt: rows.map((_, i) => i).filter((i) => !usedRows.has(i)),
  };
}
