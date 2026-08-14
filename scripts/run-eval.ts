/**
 * Eval runner — scores the TypeScript parser against five months of ground truth.
 *
 *     npm run eval
 *
 * Ground truth lives in evals/ground-truth/*.json and was extracted from the
 * finished, human-verified expense reports that were actually filed and
 * accepted. It is real ground truth, not a guess.
 *
 * PASS BAR: 90/90 rows, every field exact. Dates and amounts are the fields that
 * destroy trust when wrong, so there is no partial credit and no tolerance.
 *
 * This deliberately mirrors evals/run_eval.py line for line, including the
 * output format, so the TypeScript and Python results can be diffed directly.
 * If this ever disagrees with the Python, one of the two is wrong — fix the
 * parser, never the scorer.
 */
import { readdir, readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { reportFileName } from "../src/lib/report/reportFormat";
import { parseStatement, type StatementRow } from "../src/lib/statement/parseStatement";
import { checkAgainstDeclared } from "../src/lib/statement/format";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GT_DIR = path.join(HERE, "..", "evals", "ground-truth");
const FIXTURES = path.join(HERE, "..", "evals", "fixtures", "statements");

const FIELDS = [
  "date",
  "expenseAmount",
  "billedAmount",
  "expensedCurrency",
  "billedCurrency",
  "vendor",
] as const;

interface GroundTruth {
  month: string;
  sourceStatement: string;
  billedTotalCAD: number;
  rows: StatementRow[];
}

async function main(): Promise<number> {
  let total = 0;
  let matched = 0;
  const failures: string[] = [];

  const files = (await readdir(GT_DIR)).filter((f) => f.endsWith(".json")).sort();

  for (const file of files) {
    const gt: GroundTruth = JSON.parse(
      await readFile(path.join(GT_DIR, file), "utf8"),
    );
    const stmt = path.join(FIXTURES, gt.sourceStatement);

    let data: Uint8Array;
    try {
      data = new Uint8Array(await readFile(stmt));
    } catch {
      console.log(`SKIP ${gt.month}: statement not found at ${stmt}`);
      continue;
    }

    const { rows: got, skipped, declared } = await parseStatement(data);
    const expected = gt.rows;
    total += expected.length;

    // A line the parser couldn't read is a failure even if every other row is
    // perfect. A refund line went missing from a July report exactly this way,
    // and nothing in the eval would have noticed.
    for (const s of skipped) {
      failures.push(
        `${gt.month}: unreadable transaction line on page ${s.page} — ${JSON.stringify(s.text)}`,
      );
    }

    // The statement's own summary is an independent check that needs no
    // ground truth. It would have caught the July refund bug on its own.
    const self = checkAgainstDeclared(got, declared);
    if (!self.ok) failures.push(`${gt.month}: self-check — ${self.reason}`);

    if (got.length !== expected.length) {
      failures.push(
        `${gt.month}: row count ${got.length} != expected ${expected.length}`,
      );
    }

    let monthOk = 0;
    for (const [i, exp] of expected.entries()) {
      if (i >= got.length) {
        failures.push(`${gt.month} row ${i}: missing`);
        continue;
      }
      const diffs = FIELDS.filter((f) => got[i][f] !== exp[f]);
      if (diffs.length) {
        failures.push(
          `${gt.month} row ${i}: [${diffs.join(", ")}]\n` +
            `      got  ${JSON.stringify(got[i])}\n` +
            `      want ${JSON.stringify(exp)}`,
        );
      } else {
        monthOk++;
      }
    }
    matched += monthOk;

    const gotTotal =
      Math.round(
        got.reduce((s, r) => s + Number(r.billedAmount.replace(/,/g, "")), 0) *
          100,
      ) / 100;

    const flag =
      monthOk === expected.length && skipped.length === 0 && self.ok
        ? "OK "
        : "FAIL";
    console.log(
      `${flag} ${gt.month.padEnd(15)} ${monthOk}/${expected.length} rows   ` +
        `total $${gotTotal} (expected $${gt.billedTotalCAD})`,
    );
  }

  /* ---------------------------------------------------------------------
     Self-check on EVERY statement, including months with no filed report to
     compare against. Each statement prints its own transaction count and total
     on page 1, so the parser can be checked on a month nobody has verified by
     hand. This is what catches a new statement quirk the day it appears —
     July 2026 arrived with a refund line, which the original parser dropped
     silently and no ground-truth comparison could have flagged.
     --------------------------------------------------------------------- */
  console.log("\nSelf-check — parsed vs. the statement's own printed summary:");

  const seen = new Set(
    files.map(
      (f) => (JSON.parse(readFileSync(path.join(GT_DIR, f), "utf8")) as GroundTruth)
        .sourceStatement,
    ),
  );

  for (const pdf of (await readdir(FIXTURES)).filter((f) => f.endsWith(".pdf")).sort()) {
    const { rows, skipped, declared } = await parseStatement(
      new Uint8Array(await readFile(path.join(FIXTURES, pdf))),
    );
    const self = checkAgainstDeclared(rows, declared);
    const extra = seen.has(pdf) ? "" : "  (no filed report — self-check only)";

    if (!self.ok) failures.push(`${pdf}: self-check — ${self.reason}`);
    for (const s of skipped) {
      failures.push(`${pdf}: unreadable line on page ${s.page} — ${JSON.stringify(s.text)}`);
    }

    /* The report is named for the statement's own month, not its first
       transaction. Statements are issued on the 27th, so three of these six
       straddle two months and used to be named for the wrong one — February
       downloaded as "January 2026".

       The expectation comes from the FILENAME, `statement-2026-02.pdf`, which
       is an independent record of which month each file is: derive it from the
       parsed contents and the test would agree with any bug that changed both
       sides at once. */
    const monthFromFilename = /statement-(\d{4})-(\d{2})\.pdf$/.exec(pdf);
    if (monthFromFilename) {
      const MONTHS = ["January","February","March","April","May","June","July",
        "August","September","October","November","December"];
      const wantName =
        `Expense Report — ${MONTHS[Number(monthFromFilename[2]) - 1]} ` +
        `${monthFromFilename[1]}.docx`;
      const gotName = reportFileName(rows, declared?.statementDate ?? null);
      if (gotName !== wantName) {
        failures.push(`${pdf}: names the report "${gotName}", expected "${wantName}"`);
      }
    }

    console.log(
      `${self.ok && skipped.length === 0 ? "OK  " : "FAIL"} ${pdf.padEnd(34)} ` +
        `${rows.length} txns, declared ${declared?.transactionCount ?? "?"}${extra}`,
    );
  }

  const pct = total ? (100 * matched) / total : 0;
  console.log(`\nRESULT: ${matched}/${total} rows exact (${pct.toFixed(1)}%)`);

  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures.slice(0, 25)) console.log("  -", f);
  }

  // Any failure fails the run — including a self-check or an unreadable line on
  // a month with no filed report. Returning 0 while `failures` is non-empty
  // would recreate exactly the "green but wrong" problem this run exists to stop.
  return matched === total && total > 0 && failures.length === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
