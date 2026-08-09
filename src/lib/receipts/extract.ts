/**
 * Receipt extraction — turning uploaded files into individual receipt images.
 *
 * NO AI HERE. This is unzipping and page rendering. The model never sees a file,
 * only the images this produces, and only to decide which statement line each
 * one belongs to.
 *
 * Four input shapes, confirmed against five months of real data:
 *
 *   Uber .docx          embedded images, one receipt each   -> jszip
 *   paper receipts.pdf  scanned pages, one receipt per page -> render page
 *   hotel folio .pdf    has a text layer, but the report     -> render page
 *                       needs a picture of it either way
 *   statement .pdf      the screenshot for the top           -> render page
 *
 * Everything comes out as JPEG. The originals are PNG screenshots and a June
 * report built from them is ~4.7 MB; JPEG at this size keeps a 25-receipt month
 * closer to 1.5 MB while staying comfortably legible. Receipts get read by a
 * human at 100% zoom, not forensically examined.
 */
import { renderPageAsImage } from "unpdf";

export interface ReceiptImage {
  /** Where it came from, for showing the user which receipt is which. */
  source: string;
  /** 1-based page number for PDFs, image index for .docx. */
  index: number;
  /** JPEG bytes. */
  data: Uint8Array;
  width: number;
  height: number;
}

/**
 * Long edge in pixels, and JPEG quality.
 *
 * Tuned by looking at the output, not guessed. At 1400px / 0.82 the Uber
 * receipts came out with the fare amount barely readable — which is the one
 * number a reviewer actually checks. These settings keep a 25-receipt month
 * under ~1 MB against the 4.7 MB of the hand-made original, with the text
 * still crisp.
 */
const MAX_EDGE = 2000;
/**
 * Small sources get enlarged to this before the model reads them. 1568px is the
 * long edge the vision API works at, so anything under it is leaving detail on
 * the table for free.
 */
const MIN_EDGE = 1568;
/**
 * 0–100, NOT 0–1. @napi-rs/canvas takes a percentage; passing 0.92 silently
 * produces a ~1%-quality image. It was shipping unreadable receipts at 6 KB
 * each and only showed up by opening one and looking at it.
 */
const JPEG_QUALITY = 92;

async function canvasLib() {
  return (await import("@napi-rs/canvas")) as unknown as {
    createCanvas: (w: number, h: number) => {
      getContext: (t: "2d") => {
        drawImage: (
          img: unknown,
          x: number,
          y: number,
          w: number,
          h: number,
        ) => void;
      };
      toBuffer: (mime: "image/jpeg", quality?: number) => Buffer;
    };
    loadImage: (
      src: Buffer | Uint8Array,
    ) => Promise<{ width: number; height: number }>;
  };
}

/** Re-encode any image to a size-capped JPEG. */
async function toJpeg(
  bytes: Uint8Array,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { createCanvas, loadImage } = await canvasLib();
  const img = await loadImage(Buffer.from(bytes));

  // Downscale big renders; also UPSCALE small ones. The Uber .docx images are
  // only ~503x874 and their fare amounts are small text — the two receipts that
  // failed matching were both from that source, both digit errors. Enlarging
  // before the model sees them is the lever that resolution problems respond
  // to; prompt wording is not.
  const longest = Math.max(img.width, img.height);
  const scale =
    longest < MIN_EDGE ? MIN_EDGE / longest : Math.min(1, MAX_EDGE / longest);
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);

  return {
    data: new Uint8Array(canvas.toBuffer("image/jpeg", JPEG_QUALITY)),
    width,
    height,
  };
}

/**
 * A small copy of an image, for showing the user which receipt is which.
 *
 * Kept deliberately small: 25 of these travel to the browser so a person can
 * see what they're deciding about during reconciliation. The full-size version
 * never leaves the server except inside the finished document.
 */
export async function thumbnail(
  bytes: Uint8Array,
  maxEdge = 320,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { createCanvas, loadImage } = await canvasLib();
  const img = await loadImage(Buffer.from(bytes));
  const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const canvas = createCanvas(width, height);
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return { data: new Uint8Array(canvas.toBuffer("image/jpeg", 70)), width, height };
}

/** Render one PDF page to a JPEG. */
export async function renderPdfPage(
  pdf: Uint8Array,
  pageNumber: number,
  scale = 2,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const png = await renderPageAsImage(new Uint8Array(pdf), pageNumber, {
    scale,
    canvasImport: () => import("@napi-rs/canvas") as never,
  });
  return toJpeg(new Uint8Array(png as ArrayBuffer));
}

/** How many pages a PDF has, without parsing its text. */
export async function pdfPageCount(pdf: Uint8Array): Promise<number> {
  const { getDocumentProxy } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  return doc.numPages;
}

/** Every page of a PDF, one image each. Used for scanned receipts and folios. */
export async function extractFromPdf(
  pdf: Uint8Array,
  source: string,
): Promise<ReceiptImage[]> {
  const pages = await pdfPageCount(pdf);
  const out: ReceiptImage[] = [];
  for (let page = 1; page <= pages; page++) {
    const img = await renderPdfPage(pdf, page);
    out.push({ source, index: page, ...img });
  }
  return out;
}

/**
 * The images embedded in a Word document, in document order.
 *
 * Order matters: `word/media/image7.png` sorts before `image10.png` only if the
 * numbers are compared numerically. A plain string sort would scramble the
 * sequence, and since receipts are matched partly on ordering, that would
 * quietly degrade matching.
 */
export async function extractFromDocx(
  docx: Uint8Array,
  source: string,
): Promise<ReceiptImage[]> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(docx);

  const media = Object.keys(zip.files)
    .filter((n) => n.startsWith("word/media/") && !zip.files[n].dir)
    .sort((a, b) => {
      const na = Number(/(\d+)/.exec(a)?.[1] ?? 0);
      const nb = Number(/(\d+)/.exec(b)?.[1] ?? 0);
      return na - nb || a.localeCompare(b);
    });

  const out: ReceiptImage[] = [];
  for (const [i, name] of media.entries()) {
    const bytes = await zip.file(name)!.async("uint8array");
    try {
      const img = await toJpeg(bytes);
      out.push({ source, index: i + 1, ...img });
    } catch {
      // An unreadable embedded image is reported by omission upstream rather
      // than crashing the whole extraction.
    }
  }
  return out;
}

/**
 * What we can do with a given file.
 *
 * "heic" is called out separately because iPhones produce it by default and the
 * image decoder can't read it — a silent skip there would lose a real receipt
 * someone photographed. The user gets told to export as JPEG instead.
 */
export type ReceiptFileKind = "docx" | "pdf" | "image" | "heic" | "unsupported";

export function receiptFileKind(fileName: string): ReceiptFileKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  if (/\.(jpe?g|png|webp)$/.test(lower)) return "image";
  if (/\.(heic|heif)$/.test(lower)) return "heic";
  return "unsupported";
}

/** Plain-language reason a file can't be used, or null if it can. */
export function unsupportedReason(fileName: string): string | null {
  switch (receiptFileKind(fileName)) {
    case "heic":
      return (
        `"${fileName}" is an Apple HEIC photo, which can't be read here. On your ` +
        `iPhone: Settings → Camera → Formats → "Most Compatible" saves as JPEG, ` +
        `or open the photo and share it as a JPEG.`
      );
    case "unsupported":
      return (
        `"${fileName}" isn't a file type this tool can read. Receipts can be PDF, ` +
        `Word (.docx), JPEG, PNG or WebP.`
      );
    default:
      return null;
  }
}

/** Dispatch on file type. Returns [] for anything that isn't a receipt source. */
export async function extractReceipts(
  fileName: string,
  bytes: Uint8Array,
): Promise<ReceiptImage[]> {
  switch (receiptFileKind(fileName)) {
    case "docx":
      return extractFromDocx(bytes, fileName);
    case "pdf":
      return extractFromPdf(bytes, fileName);
    case "image":
      // A photographed or scanned receipt, one image, one receipt. Passed
      // through the same re-encode as everything else so it gets the same
      // size cap, quality and upscaling.
      return [{ source: fileName, index: 1, ...(await toJpeg(bytes)) }];
    default:
      return [];
  }
}

/**
 * The statement screenshot that opens the report.
 *
 * It's the page carrying the transaction table — page 2 on every statement seen
 * so far, but found by looking for the "Location" column header rather than
 * assuming, since page 1 is the summary.
 */
export async function renderStatementScreenshot(
  statement: Uint8Array,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const { extractWordsByPage } = await import("@/lib/statement/words");
  const pages = await extractWordsByPage(statement);

  let target = 1;
  for (const [i, words] of pages.entries()) {
    if (words.some((w) => w.text === "Location")) {
      target = i + 1;
      break;
    }
  }
  // Rendered larger than a receipt: it's a dense table and has to stay readable.
  return renderPdfPage(statement, target, 2.5);
}
