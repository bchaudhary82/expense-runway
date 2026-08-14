/**
 * Report verification — checks the generated Word document against ground truth.
 *
 *     npm run verify:report
 *
 * This does NOT test the line-formatting function against itself. It:
 *   1. parses the real June statement PDF,
 *   2. builds the actual .docx through the same code path the browser uses,
 *   3. unzips it and pulls the text back out of Word's own XML,
 *   4. compares that text, line for line, against lines derived independently
 *      from evals/ground-truth/jun-2026.json.
 *
 * So a formatting bug, an ordering bug, or Word silently eating the four-space
 * separators would all fail here rather than being discovered on a filed report.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Packer } from "docx";
import { parseStatement, type StatementRow } from "../src/lib/statement/parseStatement";
import { buildReportDocument, type EmbeddedImage } from "../src/lib/report/buildReport";
import { extractReceipts } from "../src/lib/receipts/extract";
import { renderStatementScreenshot } from "../src/lib/receipts/extract";

/**
 * Deliberately a literal, not an import from the app. If the test borrowed the
 * app's own constant, changing that constant would change both sides of the
 * comparison and the test would keep passing while the output silently changed.
 */
const EMPTY_PURPOSE = "[ADD PURPOSE HERE]";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GT = path.join(HERE, "..", "evals", "ground-truth", "jun-2026.json");
const FIXTURES = path.join(HERE, "..", "evals", "fixtures", "statements");

/**
 * Flip to true when build step 5 embeds receipt images. While false, the image
 * check reports the gap loudly but doesn't fail the run; once true, a document
 * with the wrong number of images is a hard failure.
 */
const IMAGES_IMPLEMENTED = true;

/** Pull paragraph text and image count out of a .docx, the way Word reads it. */
async function readDocx(
  buffer: Buffer,
): Promise<{
  paragraphs: string[];
  /** Indices of paragraphs whose text is bold. */
  bold: number[];
  images: number;
  pageBreaks: number[];
  /** Rendered size of every embedded image, in inches. */
  imageSizes: { paragraph: number; widthIn: number; heightIn: number }[];
  keepNext: number;
  page: { widthIn: number; heightIn: number; contentWIn: number; contentHIn: number } | null;
}> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file("word/document.xml")!.async("string");

  const paragraphs: string[] = [];
  const pageBreaks: number[] = [];
  const bold: number[] = [];
  const imageSizes: { paragraph: number; widthIn: number; heightIn: number }[] = [];
  const EMU_PER_INCH = 914400;
  let images = 0;

  for (const [i, p] of (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? []).entries()) {
    if (/<w:drawing>|<w:pict>/.test(p)) images++;
    if (/<w:pageBreakBefore|w:type="page"/.test(p)) pageBreaks.push(i);
    const extent = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(p);
    if (extent) {
      imageSizes.push({
        paragraph: i,
        widthIn: Number(extent[1]) / EMU_PER_INCH,
        heightIn: Number(extent[2]) / EMU_PER_INCH,
      });
    }
    /* Is this paragraph's text bold?
       The pattern deliberately requires whitespace or the tag's own close right
       after <w:b, so it can't match <w:bCs/> — the complex-script bold flag,
       which Word writes alongside the real one and which does not itself
       embolden Latin text. An explicit w:val of 0/false/off turns it back off. */
    const boldTag = /<w:b(?:\s+([^>]*))?\/>/.exec(p);
    const boldOff = boldTag?.[1] && /w:val="(0|false|off)"/.test(boldTag[1]);
    let text = "";
    for (const t of p.match(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>/g) ?? []) {
      text += t.replace(/<[^>]+>/g, "");
    }
    if (text && boldTag && !boldOff) bold.push(i);
    paragraphs.push(
      text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'"),
    );
  }
  const TWIPS = 1440;
  const sz = /<w:pgSz([^/>]*)\/?>/.exec(xml);
  const mar = /<w:pgMar([^/>]*)\/?>/.exec(xml);
  const num = (m: RegExpExecArray | null, name: string) => {
    if (!m) return null;
    const v = new RegExp(`w:${name}="(-?\\d+)"`).exec(m[1]);
    return v ? Number(v[1]) / TWIPS : null;
  };
  const w = num(sz, "w");
  const h = num(sz, "h");
  const top = num(mar, "top");
  const bottom = num(mar, "bottom");
  const left = num(mar, "left");
  const right = num(mar, "right");
  const page =
    w !== null && h !== null && top !== null && bottom !== null && left !== null && right !== null
      ? { widthIn: w, heightIn: h, contentWIn: w - left - right, contentHIn: h - top - bottom }
      : null;

  return {
    paragraphs,
    images,
    bold,
    pageBreaks,
    imageSizes,
    keepNext: (xml.match(/<w:keepNext/g) ?? []).length,
    page,
  };
}

/**
 * Build the expected report text straight from ground truth — deliberately
 * written out longhand here rather than calling the app's formatter, so the
 * test has its own independent idea of what the format is.
 */
function expectedLines(rows: StatementRow[]): string[] {
  // The real shape: statement screenshot, then per expense a transaction line,
  // a purpose line and that expense's receipt. Image paragraphs hold no text,
  // so they read as empty strings here. 1 + 3n paragraphs, exactly matching the
  // 76 in the filed June report.
  const lines: string[] = [""]; // statement screenshot
  for (const r of rows) {
    lines.push(
      `${r.date}    $${r.expenseAmount}    $${r.billedAmount}    ` +
        `${r.expensedCurrency}    ${r.billedCurrency}    ${r.vendor}`,
    );
    lines.push(EMPTY_PURPOSE);
    lines.push(""); // that expense's receipt image
  }
  return lines;
}

async function main(): Promise<number> {
  const gt = JSON.parse(await readFile(GT, "utf8")) as {
    month: string;
    sourceStatement: string;
    billedTotalCAD: number;
    rows: StatementRow[];
    /** Measured from the report that was actually filed. */
    expectedParagraphs?: number;
    expectedImages?: number;
  };

  const { rows, skipped } = await parseStatement(
    new Uint8Array(await readFile(path.join(FIXTURES, gt.sourceStatement))),
  );

  /* Images. Extraction is deterministic and free — no API key needed — so this
     check can run on every commit. It verifies the DOCUMENT'S SHAPE: that a
     receipt lands after its own entry, that the statement screenshot opens the
     file, and that adding images doesn't disturb a single character of text.

     It deliberately does NOT test match quality. Assigning receipt i to row i
     here is a stand-in, not the real matcher — how well receipts are matched to
     the right lines is `npm run eval:receipts`, which costs money and needs a
     key. Two different questions, two different tests. */
  const statementBytes = new Uint8Array(await readFile(path.join(FIXTURES, gt.sourceStatement)));
  const statement = await renderStatementScreenshot(statementBytes);

  const RECEIPTS = path.join(HERE, "..", "evals", "fixtures", "receipts-june");
  const receiptImages: EmbeddedImage[] = [];
  for (const f of (await readdir(RECEIPTS)).sort()) {
    for (const img of await extractReceipts(f, new Uint8Array(await readFile(path.join(RECEIPTS, f))))) {
      receiptImages.push({ data: img.data, width: img.width, height: img.height });
    }
  }
  const receiptsByRowIndex: Record<number, EmbeddedImage> = {};
  for (const [i] of rows.entries()) {
    if (receiptImages[i]) receiptsByRowIndex[i] = receiptImages[i];
  }

  const buffer = await Packer.toBuffer(
    buildReportDocument(rows, {}, { statement, receiptsByRowIndex }),
  );
  const { paragraphs: got, images, bold, pageBreaks, imageSizes, keepNext, page } =
    await readDocx(Buffer.from(buffer));
  const want = expectedLines(gt.rows);

  console.log(`${gt.month} — generated from ${gt.sourceStatement}`);
  console.log(`  document size   ${(buffer.byteLength / 1024).toFixed(1)} KB`);
  console.log(`  text paragraphs ${got.length} (expected ${want.length})`);
  console.log(`  images          ${images} (expected ${1 + rows.length}: 1 statement + ${rows.length} receipts)`);
  console.log(`  page breaks     ${pageBreaks.length} (expected ${rows.length}: one per expense)`);
  const tallest = Math.max(...imageSizes.map((s) => s.heightIn));
  const widest = Math.max(...imageSizes.map((s) => s.widthIn));
  console.log(
    `  largest image   ${widest.toFixed(2)}in x ${tallest.toFixed(2)}in (must fit 6.50 x 8.00)`,
  );

  const failures: string[] = [];

  for (const s of skipped) {
    failures.push(
      `statement line on page ${s.page} couldn't be read, so it is missing from the report — ${JSON.stringify(s.text)}`,
    );
  }

  if (got.length !== want.length) {
    failures.push(`paragraph count ${got.length} != expected ${want.length}`);
  }

  for (let i = 0; i < Math.max(got.length, want.length); i++) {
    if (got[i] !== want[i]) {
      failures.push(
        `line ${i}:\n      got  ${JSON.stringify(got[i])}\n      want ${JSON.stringify(want[i])}`,
      );
    }
  }

  // Structural checks — these would catch a format that happens to match on
  // this month's data but is wrong in shape.
  const txLines = got.filter((_, i) => i % 3 === 1);
  const blanks = got.filter((_, i) => i % 3 === 0);
  const purposes = got.filter((_, i) => i % 3 === 2);

  /* Image sizing. Letter with 1in margins leaves 6.5 x 9.0in of content, and
     the filed reports fit every image inside 6.5 x 8.0in so the two text lines
     have room. Scaling by width alone left tall till receipts 10-11in high:
     they overflowed onto the next page and dragged the following entry with
     them. Checked per image, not just on the largest. */
  /* Page geometry. This went unstated for a whole session: the docx library
     defaults to A4, so the document was 8.27 x 11.69in with a 6.27in text
     column while images were being sized to 6.50in. The filed reports are
     Letter with 1in margins. Assert it rather than assume it. */
  if (!page) {
    failures.push("couldn't read the page size and margins from the document");
  } else {
    console.log(
      `  page            ${page.widthIn.toFixed(2)}in x ${page.heightIn.toFixed(2)}in, ` +
        `content ${page.contentWIn.toFixed(2)} x ${page.contentHIn.toFixed(2)}in`,
    );
    if (Math.abs(page.widthIn - 8.5) > 0.01 || Math.abs(page.heightIn - 11) > 0.01) {
      failures.push(
        `page is ${page.widthIn.toFixed(2)}x${page.heightIn.toFixed(2)}in — should be Letter, 8.5x11`,
      );
    }
  }

  /* Word's own keep-together flag on the two text paragraphs of every entry.
     The page break alone was not enough: Word left the transaction line at the
     bottom of a page and pushed the receipt to the next. keepNext makes the
     grouping explicit instead of depending on height arithmetic being right. */
  if (keepNext < rows.length * 2) {
    failures.push(
      `only ${keepNext} paragraphs carry keepNext — expected ${rows.length * 2} ` +
        `(the transaction and purpose line of every entry), so an entry can still ` +
        `be split from its receipt`,
    );
  }

  /* The transaction line is bold and NOTHING ELSE IS.
     Checked as an exact set rather than a count, because the failure worth
     catching is emphasis landing on the wrong paragraph — a bold purpose line,
     or the whole document bold, both of which a count would wave through while
     destroying the contrast this exists to create. Transaction lines sit at
     paragraphs 1, 4, 7 …; purpose lines at 2, 5, 8 …; images at 0, 3, 6 …. */
  const wantBold = rows.map((_, i) => 1 + i * 3);
  if (bold.join(",") !== wantBold.join(",")) {
    const unexpected = bold.filter((i) => !wantBold.includes(i));
    const missing = wantBold.filter((i) => !bold.includes(i));
    failures.push(
      `bold is on paragraphs [${bold.slice(0, 8).join(", ")}…] but should be on ` +
        `exactly the transaction lines [${wantBold.slice(0, 8).join(", ")}…]` +
        (missing.length ? ` — ${missing.length} transaction line(s) not bold` : "") +
        (unexpected.length
          ? ` — ${unexpected.length} other paragraph(s) bold, including ${unexpected[0]}`
          : ""),
    );
  }

  const BOX_W = 6.5;
  const BOX_H = 8.0;
  for (const size of imageSizes) {
    if (size.widthIn > BOX_W + 0.01 || size.heightIn > BOX_H + 0.01) {
      failures.push(
        `image in paragraph ${size.paragraph} is ${size.widthIn.toFixed(2)}in x ` +
          `${size.heightIn.toFixed(2)}in — larger than the ${BOX_W} x ${BOX_H}in box, ` +
          `so it will push its entry onto a second page`,
      );
    }
  }

  /* Page breaks sit at the END of every image paragraph — the statement
     screenshot and each receipt — except the last, which would leave a trailing
     blank page. Paragraphs 0, 3, 6, … 72.

     This is NOT `pageBreakBefore` on the transaction lines, which is what the
     filed reports use and what was tried first. That property was silently
     ignored by the renderer: content flowed continuously, so every page ended up
     holding an image plus the FOLLOWING entry's two text lines. The page count
     still came out at 26, which is why three rounds of checking missed it —
     verified now by rendering the document and reading each page, not by
     counting breaks. */
  const wantBreaks = got
    .map((_, i) => i)
    .filter((i) => i % 3 === 0 && i !== got.length - 1);
  if (pageBreaks.join(",") !== wantBreaks.join(",")) {
    failures.push(
      `page breaks are on paragraphs [${pageBreaks.slice(0, 8).join(", ")}…] ` +
        `but should be on every transaction line [${wantBreaks.slice(0, 8).join(", ")}…] ` +
        `— ${pageBreaks.length} found, ${wantBreaks.length} expected`,
    );
  }

  // Image positions, checked structurally rather than just counted: paragraph 0
  // is the statement screenshot and every third one after it is a receipt.
  if (images !== 1 + rows.length) {
    failures.push(
      `image count ${images} != 1 statement screenshot + ${rows.length} receipts`,
    );
  }

  // Paragraphs 0, 3, 6 … carry images and therefore no text. If one has text,
  // the document has drifted out of shape.
  if (blanks.some((l) => l !== "")) {
    failures.push("every third paragraph from 0 should be an image, holding no text");
  }
  if (!purposes.every((l) => l === EMPTY_PURPOSE)) {
    failures.push(`every purpose line should be "${EMPTY_PURPOSE}" here`);
  }
  const badSeparators = txLines.filter((l) => l.split("    ").length !== 6);
  if (badSeparators.length) {
    failures.push(
      `${badSeparators.length} transaction line(s) don't split into 6 fields on four spaces`,
    );
  }

  // Chronological. Nothing below may throw: a malformed document has to be
  // REPORTED, not crash the runner. A stack trace tells you nothing about which
  // line went wrong, and that is the only thing worth knowing here.
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const keys: number[] = [];
  for (const [i, line] of txLines.entries()) {
    const date = line.split("    ")[0] ?? "";
    const m = /^([A-Za-z]{3}) (\d{2}) (\d{4})$/.exec(date);
    if (!m) {
      failures.push(
        `transaction ${i}: doesn't start with a readable date — got ${JSON.stringify(line.slice(0, 40))}`,
      );
      continue;
    }
    keys.push(Number(m[3]) * 10000 + MONTHS.indexOf(m[1]) * 100 + Number(m[2]));
  }
  if (keys.some((k, i) => i > 0 && k < keys[i - 1])) {
    failures.push("transaction lines are not in chronological order");
  }

  // Total still reconciles
  let cents = 0;
  for (const [i, line] of txLines.entries()) {
    const field = line.split("    ")[2];
    const value = Number((field ?? "").replace(/[$,]/g, ""));
    if (!Number.isFinite(value)) {
      failures.push(
        `transaction ${i}: billed amount isn't a number — got ${JSON.stringify(field)}`,
      );
      continue;
    }
    cents += Math.round(value * 100);
  }
  const total = cents / 100;
  if (total !== gt.billedTotalCAD) {
    failures.push(`billed total $${total} != expected $${gt.billedTotalCAD}`);
  }

  console.log(`  transactions    ${txLines.length}`);
  console.log(`  billed total    $${total.toLocaleString("en-CA", { minimumFractionDigits: 2 })} (expected $${gt.billedTotalCAD})`);
  console.log(`  chronological   ${keys.every((k, i) => i === 0 || k >= keys[i - 1]) ? "yes" : "NO"}`);

  /* ---------------------------------------------------------------------
     Images. The filed reports open with a screenshot of the statement and
     carry one receipt image after every expense. This checker compared text
     only until July 30, 2026, and so reported a clean PASS on a document that
     was missing 26 images and ~4.7 MB. State plainly what is and isn't
     checked — a bare "PASS" here was true but badly misleading.
     --------------------------------------------------------------------- */
  const wantImages = gt.expectedImages ?? gt.rows.length + 1;
  const wantParagraphs = gt.expectedParagraphs ?? 1 + 3 * gt.rows.length;

  if (IMAGES_IMPLEMENTED && images !== wantImages) {
    failures.push(
      `image count ${images} != expected ${wantImages} ` +
        `(1 statement screenshot + ${gt.rows.length} receipts)`,
    );
  }

  if (failures.length) {
    console.log(`\nFAIL — ${failures.length} problem(s):`);
    for (const f of failures.slice(0, 25)) console.log("  -", f);
    return 1;
  }

  console.log(
    `\nPASS (text) — ${txLines.length}/${gt.rows.length} transaction lines match ground truth exactly`,
  );

  if (!IMAGES_IMPLEMENTED) {
    console.log(`
INCOMPLETE — this document is the text skeleton only.

  images here                 ${images}
  images in the filed report  ${wantImages}   (1 statement screenshot + ${gt.rows.length} receipts)
  paragraphs here             ${got.length}
  paragraphs when filed       ${wantParagraphs}

  Receipt extraction, matching and embedding is build step 5. Set
  IMAGES_IMPLEMENTED = true in this file to turn the image count into a
  hard failure once that lands.`);
  }

  return 0;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
