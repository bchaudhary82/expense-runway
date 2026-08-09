/**
 * Display helpers for statement amounts.
 *
 * Amounts stay STRINGS everywhere ("1,875.07"), exactly as printed on the
 * statement. They are only converted to numbers to add up a total, and never
 * converted back into a row value — the report must carry the printed text.
 */
import type { DeclaredTotals, StatementRow } from "./parseStatement";

/** "1,875.07" -> 1875.07 */
export function amountToNumber(amount: string): number {
  return Number(amount.replace(/,/g, ""));
}

/** "1875.07" -> "$1,875.07" */
export function formatMoney(amount: string | number): string {
  const n = typeof amount === "number" ? amount : amountToNumber(amount);
  return `$${n.toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Does what we parsed agree with what the statement says about itself?
 *
 * The statement prints its own transaction count and total on page 1. Checking
 * against it catches a dropped or duplicated line on ANY month — no ground
 * truth, no human. This is the guard that the July refund bug walked straight
 * past, because it didn't exist yet.
 */
export function checkAgainstDeclared(
  rows: StatementRow[],
  declared: DeclaredTotals | null,
): { ok: boolean; reason?: string } {
  if (!declared) {
    return {
      ok: false,
      reason: "Couldn't find the statement's own summary to check against.",
    };
  }
  if (rows.length !== declared.transactionCount) {
    return {
      ok: false,
      reason:
        `The statement says it has ${declared.transactionCount} transactions, ` +
        `but ${rows.length} were read.`,
    };
  }
  const want = amountToNumber(declared.billedTotal);
  const got = billedTotal(rows);
  if (Math.round(want * 100) !== Math.round(got * 100)) {
    return {
      ok: false,
      reason:
        `The statement total is ${formatMoney(want)}, ` +
        `but the lines read add up to ${formatMoney(got)}.`,
    };
  }
  return { ok: true };
}

/** Total actually billed, in CAD — the number that has to match the report. */
export function billedTotal(rows: StatementRow[]): number {
  const cents = rows.reduce(
    (sum, r) => sum + Math.round(amountToNumber(r.billedAmount) * 100),
    0,
  );
  return cents / 100;
}
