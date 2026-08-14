/**
 * Word document generation.
 *
 * The report's *text* is defined in reportFormat.ts, which has no dependency on
 * the docx library. This file turns those entries into a .docx and drops the
 * receipt images in.
 *
 * DOCUMENT SHAPE (see CLAUDE.md — corrected July 30, 2026):
 *
 *   [screenshot of the corporate card statement]      once, at the top
 *   transaction line
 *   purpose line
 *   [receipt image for that expense]
 *   transaction line
 *   ...
 *
 * There is no blank paragraph anywhere. Paragraph count is 1 + 3n, image count
 * is 1 + n. Both are asserted by `npm run verify:report`.
 *
 * Images are keyed by the row's index in the ORIGINAL rows array, not by its
 * position in the sorted document — see orderedEntries().
 */
import { Document, ImageRun, Packer, PageBreak, Paragraph, TextRun } from "docx";
import type { StatementRow } from "@/lib/statement/parseStatement";
import { orderedEntries, purposeLine, transactionLine, type Purposes } from "./reportFormat";

export interface EmbeddedImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface ReportImages {
  /** Screenshot of the statement's transaction table. */
  statement?: EmbeddedImage;
  /** Receipt per original row index. A missing entry just means no receipt. */
  receiptsByRowIndex?: Record<number, EmbeddedImage>;
}

/**
 * Every image is fitted into a box, preserving its aspect ratio.
 *
 * Measured from the filed reports: Letter with 1" margins gives a 6.5" × 9.0"
 * content area, and every embedded image there fits inside **6.5" × 8.0"** —
 * height capped at 8", width following. The spare inch is what the transaction
 * and purpose lines sit in.
 *
 * Scaling by width alone is not enough and was the bug: a scanned till receipt
 * is roughly 1:4, so constraining only its width left it 10–11 inches tall. It
 * overflowed onto the next page and dragged the following entry with it, which
 * is exactly the staggering Bilal saw.
 *
 * Images are scaled UP as well as down to fill the box, matching the filed
 * reports where every receipt is exactly 8" tall. Extraction already upscales to
 * a 1568px long edge, so there's real resolution behind it.
 */
const BOX_WIDTH = 624; // 6.5in at 96dpi — the full Letter content width
const BOX_HEIGHT = 768; // 8.0in at 96dpi

/** Letter, in twips (1/1440 inch). The filed reports are 8.5 x 11 with 1in margins. */
const LETTER_WIDTH_TWIPS = 12240;
const LETTER_HEIGHT_TWIPS = 15840;
const MARGIN_TWIPS = 1440;

/**
 * An image, optionally followed by an explicit page break.
 *
 * The break is a real `<w:br w:type="page"/>` run sitting after the image, NOT
 * the paragraph property `pageBreakBefore`.
 *
 * `pageBreakBefore` was tried first, because that's what the filed reports use.
 * It was silently ignored by the renderer: every page ended up holding an image
 * plus the *following* entry's two text lines, because the content simply
 * flowed. Page count happened to come out right (26), which hid it — an entry
 * was never split in two, it was just offset by one from the start.
 *
 * An explicit break run is honoured everywhere, and it also matches how the
 * layout is described: the page ends at the end of the receipt.
 */
function imageParagraph(image: EmbeddedImage, breakAfter: boolean): Paragraph {
  const scale = Math.min(BOX_WIDTH / image.width, BOX_HEIGHT / image.height);
  const children: (ImageRun | PageBreak)[] = [
    new ImageRun({
      type: "jpg",
      data: image.data,
      transformation: {
        width: Math.round(image.width * scale),
        height: Math.round(image.height * scale),
      },
    }),
  ];
  if (breakAfter) children.push(new PageBreak());
  return new Paragraph({ children });
}

export function buildReportDocument(
  rows: StatementRow[],
  purposes: Purposes = {},
  images: ReportImages = {},
): Document {
  const children: Paragraph[] = [];

  const entries = orderedEntries(rows, purposes);

  if (images.statement) {
    // Break after the statement screenshot so the first expense opens page 2.
    children.push(imageParagraph(images.statement, true));
  }

  for (const [entryIndex, { row, purpose, originalIndex }] of entries.entries()) {
    const isLast = entryIndex === entries.length - 1;
    // Every entry starts a new page, so a transaction line, its purpose and its
    // receipt always stay together and nothing straddles a page boundary.
    // Matched from the filed reports, which carry pageBreakBefore on exactly the
    // transaction lines — 25 of them in June, on paragraphs 1, 4, 7, …
    // keepNext binds each paragraph to the one after it, so a transaction line
    // can never be left at the bottom of a page with its receipt overleaf. The
    // page break itself now lives at the END of the receipt, below.
    children.push(
      new Paragraph({
        keepNext: true,
        keepLines: true,
        // Bold, because this is the line a reviewer checks against the card
        // statement and it was reading too faint above a full-page receipt
        // image. The purpose line below stays regular — bolding both would
        // restore the flatness this is meant to fix.
        children: [new TextRun({ text: transactionLine(row), bold: true })],
      }),
    );
    children.push(
      new Paragraph({
        keepNext: true,
        keepLines: true,
        children: [new TextRun(purposeLine(purpose))],
      }),
    );

    const receipt = images.receiptsByRowIndex?.[originalIndex];
    if (receipt) {
      // Page ends here — except after the final receipt, which would otherwise
      // leave a blank page at the end of the document.
      children.push(imageParagraph(receipt, !isLast));
    } else {
      // No receipt for this line. The paragraph still exists so the document
      // keeps its shape, and step 6 blocks generation until every line either
      // has a receipt or is explicitly excused. It still ends the page.
      children.push(
        new Paragraph({ children: isLast ? [] : [new PageBreak()] }),
      );
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: "Calibri", size: 22 }, // half-points: 22 = 11pt
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            // Letter, 1in margins — matching the filed reports exactly.
            // The docx library defaults to A4 (8.27 x 11.69in), which was never
            // set here and gave a 6.27in text column while images were being
            // sized to 6.50in. Page geometry was an unstated assumption; now
            // it's explicit and identical to the documents being reproduced.
            size: { width: LETTER_WIDTH_TWIPS, height: LETTER_HEIGHT_TWIPS },
            margin: {
              top: MARGIN_TWIPS,
              right: MARGIN_TWIPS,
              bottom: MARGIN_TWIPS,
              left: MARGIN_TWIPS,
            },
          },
        },
        children,
      },
    ],
  });
}

export async function reportToBlob(
  rows: StatementRow[],
  purposes: Purposes = {},
  images: ReportImages = {},
): Promise<Blob> {
  return Packer.toBlob(buildReportDocument(rows, purposes, images));
}
