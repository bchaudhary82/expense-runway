/**
 * Layout verification — renders the report and reads it page by page.
 *
 *     npm run verify:layout
 *
 * WHY THIS EXISTS SEPARATELY FROM verify:report
 *
 * `verify:report` asserts things about the .docx XML: paragraph order, image
 * dimensions, page size, break positions. All of that passed for three straight
 * sessions while the document was laid out wrong, because `pageBreakBefore` was
 * valid markup that the renderer silently ignored. The page count even came out
 * correct. Structure was right; rendering was wrong; nothing caught it.
 *
 * So this one doesn't inspect markup. It exports the document to PDF and reads
 * what actually landed on each page:
 *
 *   page 1        the statement screenshot, and nothing else
 *   pages 2..n+1  exactly one expense each — transaction line, purpose, receipt
 *
 * Needs macOS Pages (to render) and poppler's pdftotext (to read). Both are
 * on the build machine. Where they're missing this SKIPS rather than fails, so
 * it never blocks a machine that can't run it — but it is the only check that
 * can catch a layout regression, so run it before shipping any change to
 * buildReport.ts.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Packer } from "docx";
import { parseStatement } from "../src/lib/statement/parseStatement";
import {
  extractReceipts,
  renderStatementScreenshot,
} from "../src/lib/receipts/extract";
import { buildReportDocument, type EmbeddedImage } from "../src/lib/report/buildReport";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(HERE, "..", "evals", "fixtures", "statements");
const RECEIPTS = path.join(HERE, "..", "evals", "fixtures", "receipts-june");
const STATEMENT = "statement-2026-06.pdf";

const PURPOSE_MARKER = "[ADD PURPOSE HERE]";

async function have(cmd: string): Promise<boolean> {
  try {
    await run("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<number> {
  if (!(await have("pdftotext"))) {
    console.log("SKIPPED — pdftotext not found. `brew install poppler` to enable.");
    return 0;
  }
  try {
    await run("osascript", ["-e", 'exists application "Pages"']);
  } catch {
    console.log("SKIPPED — macOS Pages not available to render the document.");
    return 0;
  }

  const statementBytes = new Uint8Array(
    await readFile(path.join(FIXTURES, STATEMENT)),
  );
  const { rows } = await parseStatement(statementBytes);

  // Extraction is deterministic and free — no API key needed here. Receipt i is
  // assigned to row i as a stand-in; this checks LAYOUT, not match quality.
  const receipts: EmbeddedImage[] = [];
  for (const f of (await readdir(RECEIPTS)).sort()) {
    for (const img of await extractReceipts(
      f,
      new Uint8Array(await readFile(path.join(RECEIPTS, f))),
    )) {
      receipts.push({ data: img.data, width: img.width, height: img.height });
    }
  }
  const receiptsByRowIndex: Record<number, EmbeddedImage> = {};
  for (const [i] of rows.entries()) if (receipts[i]) receiptsByRowIndex[i] = receipts[i];

  const doc = buildReportDocument(rows, {}, {
    statement: await renderStatementScreenshot(statementBytes),
    receiptsByRowIndex,
  });

  const dir = await mkdtemp(path.join(tmpdir(), "expense-layout-"));
  const docxPath = path.join(dir, "report.docx");
  const pdfPath = path.join(dir, "report.pdf");

  try {
    await writeFile(docxPath, Buffer.from(await Packer.toBuffer(doc)));

    await run("osascript", [
      "-e",
      `tell application "Pages"
         set d to open POSIX file "${docxPath}"
         export d to POSIX file "${pdfPath}" as PDF
         close d saving no
       end tell`,
    ]);

    const pdf = await readFile(pdfPath);
    const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;

    const failures: string[] = [];
    const expectedPages = rows.length + 1;

    if (pageCount !== expectedPages) {
      failures.push(
        `${pageCount} pages rendered, expected ${expectedPages} ` +
          `(1 statement + ${rows.length} expenses, one each)`,
      );
    }

    let onePer = 0;
    for (let p = 1; p <= pageCount; p++) {
      const { stdout } = await run("pdftotext", ["-f", String(p), "-l", String(p), pdfPath, "-"]);
      const entries = stdout.split("\n").filter((l) => l.includes(PURPOSE_MARKER)).length;

      if (p === 1) {
        if (entries !== 0) {
          failures.push(`page 1 should be the statement screenshot alone, but has an expense on it`);
        }
      } else if (entries === 0) {
        failures.push(`page ${p} has no expense on it — an entry has been split from its receipt`);
      } else if (entries > 1) {
        failures.push(`page ${p} carries ${entries} expenses — they should be one per page`);
      } else {
        onePer++;
      }
    }

    console.log(`Rendered ${pageCount} pages from ${rows.length} expenses`);
    console.log(`  page 1 statement only     ${failures.some((f) => f.includes("page 1")) ? "no" : "yes"}`);
    console.log(`  pages with one expense    ${onePer}/${rows.length}`);

    if (failures.length) {
      console.log(`\nFAIL — ${failures.length} problem(s):`);
      for (const f of failures.slice(0, 15)) console.log("  -", f);
      return 1;
    }

    console.log(`\nPASS — statement on page 1, then exactly one expense per page`);
    return 0;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
