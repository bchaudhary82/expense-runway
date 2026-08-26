/**
 * The typed "MISSING RECEIPT" form, read out of a Word document.
 *
 * WHY THIS EXISTS. When a receipt is genuinely gone, the team's process is to
 * type a replacement into the same .docx that carries the month's Uber
 * receipts — a small bordered box giving the date, the amount and the reason.
 * It is a formal record, and on the statement it is indistinguishable from any
 * other line: same date, same amount, needs the same evidence in the report.
 *
 * The extractor could not see it. `extractFromDocx` reads `word/media/`, which
 * holds the document's EMBEDDED IMAGES, and a form typed straight into Word is
 * text — there is no image to pull. So the form was invisible: the line it
 * covered was reported as having no receipt, and the one document that
 * explained why never reached the report. Bilal hit this on the July statement
 * on the July statement.
 *
 * WHY NOT JUST SAVE THE DOCUMENT AS A PDF. Because the same file carries the
 * month's Uber receipts as embedded images, and the current path pulls those
 * out at their own resolution. Converting the file turns each into a full Word
 * page instead — receipt marooned inside the margins — and the 1600px cap then
 * applies to the page rather than to the receipt. This app has already shipped
 * unreadable receipts once over exactly that trade.
 *
 * NO MODEL RUNS HERE, and none should. The date and the amount are typed by a
 * person as the authoritative record of the expense, so they are already exact.
 * Sending a picture of typed text to a vision model to guess back the numbers
 * we can simply read would cost money to make the answer worse. Same principle
 * that kept the statement parser deterministic.
 *
 * The form is rendered to an image afterwards only so the report has something
 * to show beneath the line, the way every other expense does.
 */
import type { ReceiptReading } from "./vision";

export interface MissingReceiptForm {
  /** Normalised to "Jul 14 2026" — the format the matcher's date maths expects. */
  date: string | null;
  /** Digits only, e.g. "4.75". */
  amount: string | null;
  reason: string | null;
}

/* ---------------------------------------------------------------------------
   Reading the text out of the document
   --------------------------------------------------------------------------- */

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXml(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, code: string) => {
    if (code.startsWith("#x") || code.startsWith("#X")) {
      return String.fromCodePoint(parseInt(code.slice(2), 16));
    }
    if (code.startsWith("#")) return String.fromCodePoint(Number(code.slice(1)));
    return XML_ENTITIES[code] ?? whole;
  });
}

/**
 * One line of text per Word paragraph.
 *
 * Word splits a single typed line into as many `<w:t>` runs as it feels like —
 * a spellcheck mark or a change of formatting is enough to break "Amount:" away
 * from its figure — so runs have to be concatenated before anything is matched
 * against them. Tabs and line breaks are their own elements OUTSIDE the runs,
 * which is why they are picked up in the same pass and turned into spaces
 * rather than stripped with the rest of the markup: "Amount:<tab/>$4.75" must
 * not come back as "Amount:$4.75" glued to the next word.
 */
export function docxParagraphs(xml: string): string[] {
  const paragraphs: string[] = [];

  for (const chunk of xml.split(/<\/w:p>/)) {
    const runs = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(?:tab|br|cr)\s*\/>/g;
    let text = "";
    let match: RegExpExecArray | null;
    while ((match = runs.exec(chunk)) !== null) {
      text += match[1] !== undefined ? match[1] : " ";
    }
    const line = decodeXml(text).replace(/\s+/g, " ").trim();
    if (line.length > 0) paragraphs.push(line);
  }

  return paragraphs;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * The first real date in the block, as "Jul 14 2026".
 *
 * Deliberately tolerant about how it is typed — "July 14, 2026", "Jul 14 2026"
 * and "Sept. 3, 2026" are all the same date to a person filling in a form, and
 * a parser that accepts only one of them turns a formatting habit into a
 * missing receipt. Candidates whose leading word is not a month are skipped
 * rather than failing the whole block, because the surrounding prose contains
 * plenty of word-number-number sequences that are not dates.
 */
export function findDate(text: string): string | null {
  for (const m of text.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})\b/g)) {
    const prefix = m[1].toLowerCase().slice(0, 3);
    const index = MONTHS.findIndex((month) => month.toLowerCase().startsWith(prefix));
    if (index < 0) continue;

    const day = Number(m[2]);
    if (day < 1 || day > 31) continue;

    return `${MONTHS[index].slice(0, 3)} ${String(day).padStart(2, "0")} ${m[3]}`;
  }
  return null;
}

/** How many paragraphs after the heading can still belong to one form. */
const BLOCK_LINES = 12;

/**
 * Every missing-receipt form in the document.
 *
 * A form starts at its heading and runs until the next heading or the end of
 * the block. Forms without an amount are dropped: the amount is the only field
 * the matcher cannot work without, and a form missing it would attach itself to
 * whatever line happened to share its date.
 */
export function findMissingReceiptForms(paragraphs: string[]): MissingReceiptForm[] {
  const blocks: string[][] = [];
  let current: string[] | null = null;

  for (const line of paragraphs) {
    if (/missing\s*receipt/i.test(line)) {
      if (current) blocks.push(current);
      current = [line];
      continue;
    }
    if (current && current.length < BLOCK_LINES) current.push(line);
  }
  if (current) blocks.push(current);

  return blocks
    .map((lines) => {
      const text = lines.join("\n");
      const amount = /Amount:?\s*\$?\s*([\d,]+\.\d{2})/i
        .exec(text)?.[1]
        ?.replace(/,/g, "");
      const reason = /Reason:?\s*(.+)/i.exec(text)?.[1]?.trim();
      return {
        date: findDate(text),
        amount: amount ?? null,
        reason: reason ?? null,
      };
    })
    .filter((form) => form.amount !== null);
}

/** What the matcher is told about a form, without a model ever running. */
export function formReading(form: MissingReceiptForm): ReceiptReading {
  return {
    date: form.date,
    amount: form.amount,
    /* Not a merchant, and it would be dishonest to invent one. The field is
       only ever a scoring bonus and a label on screen, while the date and the
       amount — which the form states exactly — are what actually find the
       line. */
    merchant: "Missing receipt form",
    legible: true,
  };
}

/* ---------------------------------------------------------------------------
   Drawing it, so the report has something to show
   --------------------------------------------------------------------------- */

/** Comfortably under MAX_EDGE, so nothing downscales it afterwards. */
const WIDTH = 1240;

interface TextContext {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textBaseline: string;
  fillRect(x: number, y: number, w: number, h: number): void;
  strokeRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

interface Canvas {
  getContext(t: "2d"): TextContext;
  toBuffer(mime: "image/jpeg", quality?: number): Buffer;
}

async function canvasLib(): Promise<(w: number, h: number) => Canvas> {
  const lib = (await import("@napi-rs/canvas")) as unknown as {
    createCanvas: (w: number, h: number) => Canvas;
  };
  return lib.createCanvas;
}

function wrap(ctx: TextContext, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";

  for (const word of text.split(/\s+/)) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(candidate).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const LEFT = 130;
const HEADING_BASELINE = 210;
const LINE_STEP = 48;

/**
 * Render the form as a receipt image.
 *
 * Kept plainly legible rather than dressed up as a till receipt: it is a
 * declaration, not a purchase, and whoever approves the report should be able
 * to see at a glance that this line has a form behind it and not a receipt.
 *
 * The height is measured rather than fixed. A fixed box left a long reason
 * clipped or a short one floating in half a page of white, and the report gives
 * each expense a page of its own — so empty space here is empty space there.
 * Wrapping needs a context to measure against, hence the throwaway canvas: the
 * text has to be laid out before the canvas it goes on can be sized.
 *
 * CALLERS MUST REGISTER THE BUNDLED FONT FIRST. This draws text, and a
 * serverless container has no fonts of its own — the failure mode is a blank
 * white box in production and a perfect one on any laptop.
 */
export async function renderMissingReceiptForm(
  form: MissingReceiptForm,
): Promise<{ data: Uint8Array; width: number; height: number }> {
  const createCanvas = await canvasLib();

  const measure = createCanvas(WIDTH, 100).getContext("2d");
  measure.font = "34px 'DejaVu Sans'";
  const reasonLines = form.reason
    ? wrap(measure, `Reason: ${form.reason}`, WIDTH - LEFT * 2)
    : [];

  /* heading -> date -> amount, then the reason block, then a bottom margin
     matching the space above the heading. */
  const lastBaseline =
    HEADING_BASELINE +
    100 +
    70 +
    (reasonLines.length > 0 ? 80 + (reasonLines.length - 1) * LINE_STEP : 0);
  const height = lastBaseline + 150;

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.strokeStyle = "#000000";
  ctx.lineWidth = 4;
  ctx.strokeRect(60, 60, WIDTH - 120, height - 120);

  ctx.fillStyle = "#000000";
  ctx.textBaseline = "alphabetic";

  let y = HEADING_BASELINE;
  ctx.font = "bold 46px 'DejaVu Sans'";
  ctx.fillText("MISSING RECEIPT", LEFT, y);
  ctx.fillRect(LEFT, y + 12, ctx.measureText("MISSING RECEIPT").width, 3);

  y += 100;
  ctx.font = "34px 'DejaVu Sans'";
  ctx.fillText(form.date ?? "Date not stated", LEFT, y);

  y += 70;
  ctx.font = "bold 34px 'DejaVu Sans'";
  ctx.fillText(`Amount:  $${form.amount ?? "\u2014"}`, LEFT, y);

  if (reasonLines.length > 0) {
    ctx.font = "34px 'DejaVu Sans'";
    y += 80;
    for (const line of reasonLines) {
      ctx.fillText(line, LEFT, y);
      y += LINE_STEP;
    }
  }

  return {
    data: new Uint8Array(canvas.toBuffer("image/jpeg", 85)),
    width: WIDTH,
    height,
  };
}
