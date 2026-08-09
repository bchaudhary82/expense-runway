/**
 * Corporate credit card statement parser — TypeScript port.
 *
 * A literal port of evals/reference/parse_statement.py, which reproduces 90/90
 * line items across five months of real statements. Read that file's docstring
 * before changing anything here.
 *
 * No AI is involved and no network call is made. The statement PDF has a real
 * text layer; this is text extraction plus column-position logic. Statement data
 * must never be sent to the Claude API — this is the reason it doesn't have to be.
 *
 * ALGORITHM (unchanged from the reference)
 * 1. Extract words with coordinates from every page.
 * 2. Group words into visual lines by rounding the `top` coordinate.
 * 3. On each page, find the x-position of the "Location" column header.
 * 4. A line is a transaction if its first three words form a date (MMM DD YYYY).
 * 5. Fields 1-7 are fixed: date (3 words), $expenseAmount, $billedAmount,
 *    expensedCurrency, billedCurrency.
 * 6. Vendor = remaining words LEFT of the Location column x-position.
 *    Location = words at or right of it, and is DISCARDED — it does not appear
 *    in the expense report.
 *
 * WHY THE COLUMN POSITION MATTERS
 * Vendor names are truncated to 22 characters and frequently contain spaces
 * ("DELTA HOTELS BY MARRIO", "NOODLE HOUSE AND CO"). Locations contain spaces
 * too ("Toronto ON"). There is no reliable way to split vendor from location
 * with a regex on the flattened text. The x-coordinate is unambiguous. A
 * regex-only approach was tried first and mangled every multi-word vendor.
 */
import { extractWordsByPage, type Word } from "./words";

export interface StatementRow {
  /** "Jun 08 2026" — kept as text, exactly as printed. */
  date: string;
  /** Amount in the original currency, e.g. "3.00". No dollar sign. */
  expenseAmount: string;
  /** Amount actually billed in CAD, e.g. "4.21". No dollar sign. */
  billedAmount: string;
  expensedCurrency: string;
  billedCurrency: string;
  vendor: string;
}

const DATE_RE = /^[A-Z][a-z]{2} \d{2} \d{4}$/;

/**
 * Amounts print with the minus sign INSIDE the dollar sign on refunds:
 * `$-12.24`, not `-$12.24`. Found July 30, 2026 on the July statement — a
 * purchase and an immediate refund at the same merchant. The refund line failed
 * this pattern and was dropped, which overstates the expense report by the
 * refunded amount. None of the five months in the eval set contained a refund.
 */
const AMOUNT = "\\$(-?[\\d,]+\\.\\d{2})";

const ROW_RE = new RegExp(
  "^([A-Z][a-z]{2} \\d{2} \\d{4})\\s+" + // expense date
    AMOUNT + "\\s+" + //                    expense amount (original currency)
    AMOUNT + "\\s+" + //                    billed amount (CAD)
    "([A-Z]{3})\\s+" + //                   expensed currency
    "([A-Z]{3})\\s+" + //                   billed currency
    "(.+?)\\s*$", //                        vendor + location
);

/** Number of fixed leading words before the vendor: 3 date + 2 amounts + 2 currencies. */
const FIXED_LEADING_WORDS = 7;

/** Tolerance, in points, when testing whether a word sits left of the Location column. */
const COLUMN_TOLERANCE = 2;

/** A line that looks like a transaction but couldn't be read. Never dropped quietly. */
export interface SkippedLine {
  page: number;
  text: string;
}

/**
 * What the statement says about itself.
 *
 * Page 1 carries a summary row per statement period: date, number, total,
 * transaction count, status. That means every statement ships with its own
 * answer key — the parser can check its work on any month, with no ground truth
 * and no human involved.
 *
 * Found July 30, 2026 while chasing a dropped refund line. This check would have
 * caught that bug automatically: 18 parsed against 19 declared.
 */
export interface DeclaredTotals {
  statementDate: string;
  transactionCount: number;
  /** Exactly as printed, e.g. "5,990.83". */
  billedTotal: string;
}

/** The statement's own summary row for its own period. */
function findDeclaredTotals(pages: Word[][]): DeclaredTotals | null {
  // "Statement Date: Jul 27 2026" appears on the transaction page.
  let statementDate: string | null = null;
  for (const words of pages) {
    const m = /Statement Date:? ([A-Z][a-z]{2} \d{2} \d{4})/.exec(
      words.map((w) => w.text).join(" "),
    );
    if (m) {
      statementDate = m[1];
      break;
    }
  }
  if (!statementDate || pages.length === 0) return null;

  // Page 1 lists a summary row per period; take the one for this statement.
  const lines = new Map<number, Word[]>();
  for (const w of pages[0]) {
    const key = Math.round(w.top / 3);
    const bucket = lines.get(key);
    if (bucket) bucket.push(w);
    else lines.set(key, [w]);
  }

  for (const key of [...lines.keys()].sort((a, b) => a - b)) {
    const text = [...lines.get(key)!]
      .sort((a, b) => a.x0 - b.x0)
      .map((w) => w.text)
      .join(" ");
    if (!text.startsWith(statementDate)) continue;

    // Statement number is present on some rows and blank on others, so skip
    // straight to the money and the count that follows it.
    const m = /\$(-?[\d,]+\.\d{2})\s+(\d+)/.exec(text);
    if (m) {
      return {
        statementDate,
        billedTotal: m[1],
        transactionCount: Number(m[2]),
      };
    }
  }
  return null;
}

export interface ParsedStatement {
  rows: StatementRow[];
  /**
   * Lines beginning with a date that the row pattern rejected.
   *
   * This exists because of a real incident: a refund line silently vanished
   * from a July report, and nothing anywhere said so. A parser that quietly
   * discards statement lines produces a report that looks complete and isn't —
   * exactly the failure the reconciliation rules are meant to prevent. Anything
   * in here must reach the user.
   */
  skipped: SkippedLine[];
  /** What the statement claims about itself — the built-in answer key. */
  declared: DeclaredTotals | null;
}

/** Returns one row per transaction, in statement order, plus anything unreadable. */
export async function parseStatement(
  data: Uint8Array,
): Promise<ParsedStatement> {
  const rows: StatementRow[] = [];
  const skipped: SkippedLine[] = [];

  const pages = await extractWordsByPage(data);

  for (const [pageIndex, words] of pages.entries()) {
    // Group words into visual lines. Words printed on the same row share a
    // `top` within a point or two, so bucketing by top/3 collapses them together.
    const lines = new Map<number, Word[]>();
    for (const w of words) {
      const key = Math.round(w.top / 3);
      const bucket = lines.get(key);
      if (bucket) bucket.push(w);
      else lines.set(key, [w]);
    }

    // Find the Location column. Later occurrences win, as in the reference.
    let locationX: number | null = null;
    for (const group of lines.values()) {
      for (const w of group) {
        if (w.text === "Location") locationX = w.x0;
      }
    }
    // No Location header means this is a summary page with no transaction table.
    if (locationX === null) continue;

    for (const key of [...lines.keys()].sort((a, b) => a - b)) {
      const group = [...lines.get(key)!].sort((a, b) => a.x0 - b.x0);

      const firstThree = group
        .slice(0, 3)
        .map((w) => w.text)
        .join(" ");
      if (!DATE_RE.test(firstThree)) continue;

      // From here the line IS a transaction — it starts with a date inside the
      // table. If it can't be read, it gets reported, never discarded.
      const flat = group.map((w) => w.text).join(" ");
      const match = ROW_RE.exec(flat);
      if (!match) {
        skipped.push({ page: pageIndex + 1, text: flat });
        continue;
      }

      // Drop the fixed leading words, then keep only what sits LEFT of the
      // Location column. Everything at or right of it is the location, discarded.
      const vendor = group
        .slice(FIXED_LEADING_WORDS)
        .filter((w) => w.x0 < locationX! - COLUMN_TOLERANCE)
        .map((w) => w.text)
        .join(" ");

      rows.push({
        date: match[1],
        expenseAmount: match[2],
        billedAmount: match[3],
        expensedCurrency: match[4],
        billedCurrency: match[5],
        vendor: vendor.trim(),
      });
    }
  }

  return { rows, skipped, declared: findDeclaredTotals(pages) };
}
