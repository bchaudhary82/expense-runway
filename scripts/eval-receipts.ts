/**
 * Receipt matching eval.
 *
 *     npm run eval:receipts
 *
 * Runs the real June receipts through extraction, Haiku vision and the matcher,
 * then reports what fraction of the 25 statement lines got a receipt — and
 * prints the evidence for every single match so a wrong one is visible rather
 * than hidden inside a percentage.
 *
 * This costs money (a few cents). It's the only script here that does.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { parseStatement } from "../src/lib/statement/parseStatement";
import { extractReceipts, type ReceiptImage } from "../src/lib/receipts/extract";
import { readReceipt, RECEIPT_MODEL } from "../src/lib/receipts/vision";
import { matchReceipts, type ReceiptCandidate } from "../src/lib/receipts/match";

const HERE = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.join(HERE, "..", ".env.local"), quiet: true });

const STATEMENT = path.join(
  HERE, "..", "evals", "fixtures", "statements", "statement-2026-06.pdf",
);
const RECEIPTS = path.join(HERE, "..", "evals", "fixtures", "receipts-june");

// Haiku 4.5, per million tokens.
const IN_PER_MTOK = 1;
const OUT_PER_MTOK = 5;

async function main(): Promise<number> {
  const { rows } = await parseStatement(new Uint8Array(await readFile(STATEMENT)));
  console.log(`Statement: ${rows.length} lines\n`);

  const images: ReceiptImage[] = [];
  for (const f of (await readdir(RECEIPTS)).sort()) {
    images.push(
      ...(await extractReceipts(f, new Uint8Array(await readFile(path.join(RECEIPTS, f))))),
    );
  }
  const mb = images.reduce((s, i) => s + i.data.length, 0) / 1024 / 1024;
  console.log(`Extracted: ${images.length} receipt images (${mb.toFixed(2)} MB)\n`);

  console.log(`Reading with ${RECEIPT_MODEL}…`);
  const candidates: ReceiptCandidate[] = [];
  let inTok = 0;
  let outTok = 0;

  const readings = await Promise.all(
    images.map(async (img, i) => ({ i, img, r: await readReceipt(img.data) })),
  );

  for (const { i, img, r } of readings.sort((a, b) => a.i - b.i)) {
    inTok += r.inputTokens;
    outTok += r.outputTokens;
    candidates.push({ ...r, imageIndex: i, source: img.source });
  }

  const cost = (inTok / 1e6) * IN_PER_MTOK + (outTok / 1e6) * OUT_PER_MTOK;
  const unreadable = candidates.filter((c) => !c.amount || !c.date).length;
  console.log(
    `  ${inTok} in / ${outTok} out tokens — $${cost.toFixed(4)} ` +
      `($${(cost / images.length).toFixed(5)} per receipt)`,
  );
  console.log(`  ${images.length - unreadable}/${images.length} produced a usable date and amount\n`);

  const result = matchReceipts(rows, candidates);
  const pct = (100 * result.matches.length) / rows.length;

  console.log("Matches — evidence for every one:\n");
  for (const m of result.matches) {
    const src = candidates.find((c) => c.imageIndex === m.imageIndex)!;
    console.log(
      `  ${m.confidence === "high" ? "  " : "?!"} line ${String(m.rowIndex + 1).padStart(2)}  ${rows[m.rowIndex].date}  ` +
        `$${rows[m.rowIndex].billedAmount.padStart(9)}  ${rows[m.rowIndex].vendor}`,
    );
    console.log(`          ← ${src.source} #${src.imageIndex}: ${m.evidence}`);
  }

  if (result.ambiguous.length) {
    console.log("\nAmbiguous — deliberately NOT assigned:");
    for (const a of result.ambiguous) {
      console.log(`  image ${a.imageIndex}: ${a.reason}`);
      for (const r of a.rowIndexes) {
        console.log(`      candidate line ${r + 1}: ${rows[r].date} $${rows[r].billedAmount} ${rows[r].vendor}`);
      }
    }
  }

  if (result.rowsWithoutReceipt.length) {
    console.log("\nStatement lines with no receipt:");
    for (const i of result.rowsWithoutReceipt) {
      console.log(`  line ${i + 1}: ${rows[i].date} $${rows[i].billedAmount} ${rows[i].vendor}`);
    }
  }

  if (result.unmatched.length) {
    console.log("\nReceipts matching no statement line:");
    for (const i of result.unmatched) {
      const c = candidates.find((x) => x.imageIndex === i)!;
      console.log(
        `  image ${i} (${c.source}): $${c.amount ?? "?"} on ${c.date ?? "?"} — ${c.merchant ?? "unreadable"}`,
      );
    }
  }

  const low = result.matches.filter((m) => m.confidence === "low").length;
  console.log(
    `\nRESULT: ${result.matches.length}/${rows.length} statement lines matched (${pct.toFixed(1)}%)`,
  );
  console.log(`        ${result.matches.length - low} high confidence, ${low} needing a human glance`);
  console.log(`        ${result.ambiguous.length} ambiguous, ${result.unmatched.length} unmatched receipts`);
  console.log(`        cost $${cost.toFixed(4)}`);

  return 0;
}

main().then(
  (c) => process.exit(c),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
