/**
 * Report generation — the exact team format.
 *
 * From CLAUDE.md:
 *
 *     Jun 08 2026    $34.42    $34.42    CAD    CAD    RIDESHARE CO/TRIP
 *     Client site travel — Calgary
 *
 *     Apr 20 2026    $3.00    $4.21    USD    CAD    ORCA
 *     [ADD PURPOSE HERE]
 *
 * Blank line, transaction line, purpose line. Four spaces between fields.
 * Chronological. Foreign currency shows the original amount first and the CAD
 * amount second. An empty purpose becomes [ADD PURPOSE HERE], matching what the
 * team already does by hand.
 *
 * EVERY VALUE HERE COMES FROM THE PARSED STATEMENT. Amounts are passed through
 * as the exact strings printed on the statement — including thousands separators
 * ("1,077.08") — never re-formatted from a number. Nothing a model produced ever
 * reaches this file; that is the rule in CLAUDE.md and this is where it matters
 * most, because this is the document that gets filed.
 */
import type { StatementRow } from "@/lib/statement/parseStatement";

export const EMPTY_PURPOSE = "[ADD PURPOSE HERE]";

/** Four spaces, as specified. */
const SEP = "    ";

/** Purposes keyed by row index, as the review table will supply them. */
export type Purposes = Record<number, string>;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Jun 08 2026" -> a sortable number. Returns NaN for anything unexpected. */
function dateKey(date: string): number {
  const m = /^([A-Za-z]{3}) (\d{2}) (\d{4})$/.exec(date);
  if (!m) return Number.NaN;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return Number.NaN;
  return Number(m[3]) * 10000 + month * 100 + Number(m[2]);
}

/**
 * Chronological order. Array.sort is stable, so rows sharing a date keep their
 * statement order. Rows with an unreadable date sort last rather than being
 * dropped — losing a line silently is the one thing this tool must never do.
 */
export function sortChronologically(rows: StatementRow[]): StatementRow[] {
  return [...rows].sort((a, b) => {
    const ka = dateKey(a.date);
    const kb = dateKey(b.date);
    if (Number.isNaN(ka) && Number.isNaN(kb)) return 0;
    if (Number.isNaN(ka)) return 1;
    if (Number.isNaN(kb)) return -1;
    return ka - kb;
  });
}

/** The transaction line: six fields, four spaces between each. */
export function transactionLine(row: StatementRow): string {
  return [
    row.date,
    `$${row.expenseAmount}`,
    `$${row.billedAmount}`,
    row.expensedCurrency,
    row.billedCurrency,
    row.vendor,
  ].join(SEP);
}

export function purposeLine(purpose: string | undefined): string {
  const trimmed = (purpose ?? "").trim();
  return trimmed === "" ? EMPTY_PURPOSE : trimmed;
}

/**
 * The full report as an array of lines — blank, transaction, purpose, repeating.
 *
 * Kept separate from the .docx building so the exact text can be asserted in a
 * test without unzipping a Word file. The document is built from this, so the
 * two cannot drift apart.
 */
/** One entry, in report order, still carrying where it came from. */
export interface OrderedEntry {
  row: StatementRow;
  purpose: string | undefined;
  /** Position in the ORIGINAL rows array — what receipts are keyed by. */
  originalIndex: number;
}

/**
 * The report's entries in chronological order.
 *
 * Pairing happens BEFORE sorting, and each entry keeps its original index, so
 * purposes and receipt images both stay attached to the right expense when the
 * order changes. Getting this wrong produces a document that looks perfect and
 * credits the wrong receipt to the wrong line.
 */
export function orderedEntries(
  rows: StatementRow[],
  purposes: Purposes = {},
): OrderedEntry[] {
  const paired: OrderedEntry[] = rows.map((row, i) => ({
    row,
    purpose: purposes[i],
    originalIndex: i,
  }));

  paired.sort((a, b) => {
    const ka = dateKey(a.row.date);
    const kb = dateKey(b.row.date);
    if (Number.isNaN(ka) && Number.isNaN(kb)) return 0;
    if (Number.isNaN(ka)) return 1;
    if (Number.isNaN(kb)) return -1;
    return ka - kb;
  });

  return paired;
}

/**
 * The text of the report, blank-line-separated for on-screen preview.
 *
 * NOTE: in the real document that leading blank is not blank — it's the receipt
 * image for the previous entry. This is the text-only view.
 */
export function reportLines(
  rows: StatementRow[],
  purposes: Purposes = {},
): string[] {
  const lines: string[] = [];
  for (const { row, purpose } of orderedEntries(rows, purposes)) {
    lines.push("");
    lines.push(transactionLine(row));
    lines.push(purposeLine(purpose));
  }
  return lines;
}

/**
 * "Expense Report — June 2026.docx", named for the STATEMENT DATE.
 *
 * Not for the first transaction, which is what this used to do and which is
 * wrong most months. Statements are issued on the 27th, so anything spent after
 * the 27th appears on the next month's statement: February's runs Jan 30 → Feb
 * 12 and used to download as "January 2026". Three of the six real statements
 * straddle two months that way.
 *
 * The statement prints its own date and the parser already reads it — the same
 * value the self-check verifies its transaction count and billed total against,
 * so by the time it reaches here it has been corroborated twice by the
 * statement's own arithmetic.
 *
 * Do NOT switch this to a text search for the "Statement Date" label. Page 1
 * carries a summary row for the PREVIOUS statement above this one's, so the
 * first match is reliably the month before — which is how this looked like a
 * parsing bug when it was really a second, legitimate row.
 *
 * Falls back to the earliest transaction when no statement date is available,
 * which is the old behaviour: imperfect, but a name in the right ballpark beats
 * an untitled document, and it is editable at download either way.
 */
export function reportFileName(rows: StatementRow[], statementDate?: string | null): string {
  const ordered = sortChronologically(rows);
  const basis = statementDate ?? ordered[0]?.date;
  if (!basis) return "Expense Report.docx";

  const m = /^([A-Za-z]{3}) \d{2} (\d{4})$/.exec(basis);
  if (!m) return "Expense Report.docx";

  const full: Record<string, string> = {
    Jan: "January", Feb: "February", Mar: "March", Apr: "April",
    May: "May", Jun: "June", Jul: "July", Aug: "August",
    Sep: "September", Oct: "October", Nov: "November", Dec: "December",
  };

  return `Expense Report — ${full[m[1]] ?? m[1]} ${m[2]}.docx`;
}
