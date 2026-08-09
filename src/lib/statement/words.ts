/**
 * Word extraction — the pdfplumber-equivalent layer.
 *
 * The reference parser (evals/reference/parse_statement.py) is written against
 * pdfplumber's `page.extract_words()`, which returns one entry per whitespace-
 * separated word, each with its own x/y coordinates.
 *
 * pdf.js (which unpdf wraps) does NOT do that. It returns *text runs* — whatever
 * the PDF's content stream emitted as one chunk. On these statements a run is
 * usually a whole table cell ("RIDESHARE CO/TRIP", "Jun 07 2026"), but it can
 * be a whole sentence.
 *
 * If that difference leaked into the parser, the ported algorithm would silently
 * stop being the proven algorithm — the reference drops the first 7 *words* of a
 * transaction line, and 7 words is not 7 runs. So this module converts runs into
 * words first, and the parser above it is then a literal port.
 *
 * Splitting a run into words means estimating where each word starts. pdf.js
 * gives the run's left edge and total width but no per-character positions, so a
 * word's left edge is interpolated by character offset. That is approximate for
 * a proportional font — it is only ever used to decide which side of the
 * Location column a word sits on, and the columns here are ~160pt apart, far
 * wider than the error.
 */
import { getDocumentProxy } from "unpdf";

export interface Word {
  text: string;
  /** Left edge, PDF points from the left of the page. Matches pdfplumber x0. */
  x0: number;
  /** Distance from the TOP of the page, increasing downward. Matches pdfplumber top. */
  top: number;
}

export async function extractWordsByPage(
  data: Uint8Array,
): Promise<Word[][]> {
  // pdf.js takes ownership of the buffer it's handed and detaches it, so a
  // second call with the same Uint8Array throws DataCloneError. Copy first, so
  // callers can reuse their own data without knowing that.
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const pages: Word[][] = [];

  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const pageHeight = page.getViewport({ scale: 1 }).height;
    const content = await page.getTextContent();
    const words: Word[] = [];

    for (const item of content.items) {
      if (!("str" in item)) continue;
      const run = item.str;
      if (!run.trim()) continue;

      // pdf.js measures y from the BOTTOM of the page; pdfplumber measures from
      // the top. Flip it so the reference algorithm's ordering logic carries over.
      const runLeft = item.transform[4] as number;
      const top = pageHeight - (item.transform[5] as number);
      const runWidth = item.width as number;

      let offset = 0;
      // Split on whitespace but keep the separators, so `offset` stays an
      // accurate character index into the original run.
      for (const part of run.split(/(\s+)/)) {
        if (part.trim()) {
          words.push({
            text: part,
            x0:
              run.length > 0
                ? runLeft + (runWidth * offset) / run.length
                : runLeft,
            top,
          });
        }
        offset += part.length;
      }
    }

    pages.push(words);
  }

  return pages;
}
