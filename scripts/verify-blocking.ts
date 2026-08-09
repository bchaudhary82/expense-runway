/**
 * Reconciliation and blocking test.
 *
 *     npm run verify:blocking
 *
 * Costs nothing and needs no API key: reconciliation is pure functions over a
 * match result, so every flag type and the blocking rule can be exercised with
 * invented data. No real merchant name or amount appears in this file.
 *
 * What it asserts:
 *   - each of the five flag types is raised when it should be
 *   - generation is BLOCKED while any flag is unresolved
 *   - each resolution has the effect it claims (attach, exclude, accept)
 *   - resolving everything unblocks it
 */
import type { StatementRow } from "../src/lib/statement/parseStatement";
import type { ReceiptCandidate } from "../src/lib/receipts/match";
import {
  applyResolutions,
  reconcile,
  type FlagKind,
  type Resolutions,
} from "../src/lib/receipts/reconcile";
import { applyEdits } from "../src/lib/report/edits";

const failures: string[] = [];
function check(label: string, ok: boolean, detail = "") {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`);
}

function row(
  date: string,
  amount: string,
  vendor: string,
): StatementRow {
  return {
    date,
    expenseAmount: amount,
    billedAmount: amount,
    expensedCurrency: "CAD",
    billedCurrency: "CAD",
    vendor,
  };
}

function receipt(
  imageIndex: number,
  date: string | null,
  amount: string | null,
  merchant: string | null,
  source = "receipts.pdf",
): ReceiptCandidate {
  return { imageIndex, date, amount, merchant, legible: true, source };
}

/* -------------------------------------------------------------------------- */

console.log("Clean month — every line matched, nothing to decide");
{
  const rows = [
    row("Mar 03 2026", "10.00", "COFFEE BAR"),
    row("Mar 04 2026", "20.00", "BOOK SHOP"),
  ];
  const receipts = [
    receipt(0, "Mar 03 2026", "10.00", "Coffee Bar"),
    receipt(1, "Mar 04 2026", "20.00", "Book Shop"),
  ];
  const state = reconcile(rows, receipts);
  const applied = applyResolutions(state, {});
  check("no flags raised", state.flags.length === 0, `got ${state.flags.length}`);
  check("not blocked", applied.outstanding.length === 0);
  check("both lines have a receipt", Object.keys(applied.assignments).length === 2);
}

console.log("\nMissing receipt — a line with nothing attached");
{
  const rows = [row("Mar 03 2026", "10.00", "COFFEE BAR"), row("Mar 09 2026", "55.00", "HARDWARE CO")];
  const receipts = [receipt(0, "Mar 03 2026", "10.00", "Coffee Bar")];
  const state = reconcile(rows, receipts);
  const flag = state.flags.find((f) => f.kind === "missing-receipt");

  check("raises missing-receipt", !!flag);
  check("blocked while unresolved", applyResolutions(state, {}).outstanding.length === 1);

  const lost = applyResolutions(state, { [flag!.id]: "receipt-lost" });
  check('"receipt lost" unblocks', lost.outstanding.length === 0);
  check('"receipt lost" keeps the line', !lost.excludedRows.includes(1));

  const excluded = applyResolutions(state, { [flag!.id]: "exclude" });
  check('"personal charge" unblocks', excluded.outstanding.length === 0);
  check('"personal charge" removes the line', excluded.excludedRows.includes(1));
}

console.log("\nExtra receipt — a receipt matching no line");
{
  const rows = [row("Mar 03 2026", "10.00", "COFFEE BAR")];
  const receipts = [
    receipt(0, "Mar 03 2026", "10.00", "Coffee Bar"),
    receipt(1, "Mar 20 2026", "99.00", "Unrelated Store"),
  ];
  const state = reconcile(rows, receipts);
  const flag = state.flags.find((f) => f.kind === "extra-receipt");
  check("raises extra-receipt", !!flag);
  check("blocked while unresolved", applyResolutions(state, {}).outstanding.length === 1);
  check(
    '"leave it out" unblocks',
    applyResolutions(state, { [flag!.id]: "ignore" }).outstanding.length === 0,
  );
}

console.log("\nAmbiguous — one receipt fits two identical lines");
{
  const rows = [
    row("Mar 05 2026", "12.50", "SANDWICH CO"),
    row("Mar 05 2026", "12.50", "SANDWICH CO"),
  ];
  const receipts = [receipt(0, "Mar 05 2026", "12.50", "Sandwich Co")];
  const state = reconcile(rows, receipts);
  const flag = state.flags.find((f) => f.kind === "ambiguous");

  check("raises ambiguous", !!flag);
  check("offers both lines as choices", (flag?.choices.length ?? 0) === 2);
  check("attaches to neither on its own", Object.keys(state.autoAssignments).length === 0);

  const picked = applyResolutions(state, { [flag!.id]: "row:1" });
  check("choosing a line attaches the receipt there", picked.assignments[1] === 0);
  check(
    "the other line still needs resolving",
    picked.outstanding.some((f) => f.kind === "missing-receipt") ||
      picked.outstanding.length > 0,
  );
}

console.log("\nDuplicate — the same receipt supplied twice");
{
  const rows = [row("Mar 07 2026", "31.00", "RIDE CO")];
  const receipts = [
    receipt(0, "Mar 07 2026", "31.00", "Ride Co", "trips.docx"),
    receipt(1, "Mar 07 2026", "31.00", "Ride Co", "scans.pdf"),
  ];
  const state = reconcile(rows, receipts);
  const flag = state.flags.find((f) => f.kind === "duplicate");
  check("raises duplicate", !!flag);
  check("the original still matched its line", state.autoAssignments[0] === 0);
  check(
    '"drop the duplicate" unblocks',
    applyResolutions(state, { [flag!.id]: "drop-duplicate" }).outstanding.length === 0,
  );
}

console.log("\nAmount mismatch — same purchase, different totals (a tip)");
{
  const rows = [row("Mar 11 2026", "57.50", "GRILL HOUSE")];
  const receipts = [receipt(0, "Mar 11 2026", "48.00", "Grill House")];
  const state = reconcile(rows, receipts);
  const flag = state.flags.find((f) => f.kind === "amount-mismatch");

  check("raises amount-mismatch", !!flag);
  check("does NOT attach it automatically", Object.keys(state.autoAssignments).length === 0);
  check(
    "message names both amounts",
    !!flag && flag.message.includes("48.00") && flag.message.includes("9.50"),
    flag?.message,
  );

  const accepted = applyResolutions(state, { [flag!.id]: `attach:0` });
  check('"same purchase" attaches the receipt', accepted.assignments[0] === 0);
  check("and unblocks", accepted.outstanding.length === 0);
}

console.log("\nBlocking holds until the LAST flag is resolved");
{
  const rows = [
    row("Mar 03 2026", "10.00", "COFFEE BAR"),
    row("Mar 09 2026", "55.00", "HARDWARE CO"),
    row("Mar 12 2026", "18.00", "PARKING LOT"),
  ];
  const receipts = [receipt(0, "Mar 30 2026", "77.00", "Somewhere Else")];
  const state = reconcile(rows, receipts);

  check("three lines missing + one extra receipt = 4 flags", state.flags.length === 4, `got ${state.flags.length}`);

  const resolutions: Resolutions = {};
  for (const [i, flag] of state.flags.entries()) {
    const before = applyResolutions(state, resolutions).outstanding.length;
    check(
      `blocked with ${state.flags.length - i} flag(s) left`,
      before > 0,
      `outstanding=${before}`,
    );
    resolutions[flag.id] = flag.kind === "missing-receipt" ? "receipt-lost" : "ignore";
  }
  check("unblocked once all are resolved", applyResolutions(state, resolutions).outstanding.length === 0);
}

console.log("\nEvery flag offers at least one way out");
{
  const kinds: FlagKind[] = [
    "missing-receipt",
    "extra-receipt",
    "ambiguous",
    "duplicate",
    "amount-mismatch",
  ];
  const rows = [
    row("Mar 03 2026", "10.00", "COFFEE BAR"),
    row("Mar 05 2026", "12.50", "SANDWICH CO"),
    row("Mar 05 2026", "12.50", "SANDWICH CO"),
    row("Mar 11 2026", "57.50", "GRILL HOUSE"),
    row("Mar 07 2026", "31.00", "RIDE CO"),
  ];
  const receipts = [
    receipt(0, "Mar 05 2026", "12.50", "Sandwich Co"),
    receipt(1, "Mar 11 2026", "48.00", "Grill House"),
    receipt(2, "Mar 07 2026", "31.00", "Ride Co", "trips.docx"),
    receipt(3, "Mar 07 2026", "31.00", "Ride Co", "scans.pdf"),
    receipt(4, "Mar 25 2026", "88.00", "Nowhere Ltd"),
  ];
  const state = reconcile(rows, receipts);
  const seen = new Set(state.flags.map((f) => f.kind));
  for (const k of kinds) check(`raises ${k} in a mixed month`, seen.has(k));
  check(
    "every flag has choices",
    state.flags.every((f) => f.choices.length > 0),
  );
  check(
    "every choice explains its effect",
    state.flags.every((f) => f.choices.every((c) => c.effect.length > 0)),
  );
}

/* -------------------------------------------------------------------------- */
/* Row edits — the re-keying that happens when a personal charge is deleted.   */
/* -------------------------------------------------------------------------- */

console.log("\nDeleting a row re-keys purposes, receipts and overrides together");
{
  const rows = [
    row("Mar 01 2026", "1.00", "ONE"),
    row("Mar 02 2026", "2.00", "TWO"),
    row("Mar 03 2026", "3.00", "THREE"),
    row("Mar 04 2026", "4.00", "FOUR"),
  ];
  // Every row has its own receipt and its own purpose, so a mis-shift is obvious.
  const assignments = { 0: 100, 1: 101, 2: 102, 3: 103 };
  const purposes = { 0: "purpose one", 1: "purpose two", 2: "purpose three", 3: "purpose four" };

  const applied = applyEdits(rows, assignments, { purposes, excluded: [1] });

  check("row removed", applied.rows.length === 3);
  check("excludedCount reported", applied.excludedCount === 1);
  check(
    "remaining rows are the right ones",
    applied.rows.map((r) => r.vendor).join(",") === "ONE,THREE,FOUR",
    applied.rows.map((r) => r.vendor).join(","),
  );
  check(
    "receipts followed their own rows",
    applied.assignments[0] === 100 &&
      applied.assignments[1] === 102 &&
      applied.assignments[2] === 103,
    JSON.stringify(applied.assignments),
  );
  check(
    "purposes followed their own rows",
    applied.purposes[0] === "purpose one" &&
      applied.purposes[1] === "purpose three" &&
      applied.purposes[2] === "purpose four",
    JSON.stringify(applied.purposes),
  );
  check(
    "the deleted row's receipt is gone, not reassigned",
    !Object.values(applied.assignments).includes(101),
  );
}

console.log("\nDeleting several rows at once");
{
  const rows = [0, 1, 2, 3, 4].map((i) => row(`Mar 0${i + 1} 2026`, `${i + 1}.00`, `V${i}`));
  const assignments = { 0: 10, 1: 11, 2: 12, 3: 13, 4: 14 };
  const applied = applyEdits(rows, assignments, { excluded: [0, 2, 4] });
  check("two rows survive", applied.rows.length === 2);
  check(
    "the survivors keep their own receipts",
    applied.assignments[0] === 11 && applied.assignments[1] === 13,
    JSON.stringify(applied.assignments),
  );
}

console.log("\nAmount override replaces the statement value and is reported");
{
  const rows = [row("Mar 01 2026", "10.00", "ONE"), row("Mar 02 2026", "20.00", "TWO")];
  const applied = applyEdits(rows, {}, {
    overrides: { 1: { billedAmount: "22.50" } },
  });
  check("override applied", applied.rows[1].billedAmount === "22.50");
  check("untouched row unchanged", applied.rows[0].billedAmount === "10.00");
  check("other field left alone", applied.rows[1].expenseAmount === "20.00");
  check("override reported for the summary", applied.overriddenRows.join() === "1");
}

console.log("\nAn empty purpose is not carried through");
{
  const rows = [row("Mar 01 2026", "10.00", "ONE")];
  const applied = applyEdits(rows, {}, { purposes: { 0: "   " } });
  check("blank purpose dropped", applied.purposes[0] === undefined);
}

console.log();
if (failures.length) {
  console.log(`FAIL — ${failures.length} problem(s):`);
  for (const f of failures) console.log("  -", f);
  process.exit(1);
}
console.log("PASS — all flag types raised, blocking holds, every resolution behaves");
process.exit(0);
