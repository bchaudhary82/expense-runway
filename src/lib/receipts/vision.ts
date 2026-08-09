/**
 * The only place in this tool that uses AI.
 *
 * Haiku 4.5 reads a receipt image and reports the date, amount and merchant it
 * can see. That is ALL it does. Those three values exist solely to work out
 * which statement line the receipt belongs to.
 *
 * NOTHING THE MODEL RETURNS IS EVER WRITTEN INTO THE REPORT. Every number in
 * the report comes from the deterministic statement parser. If the model
 * misreads a receipt, the worst case is a receipt matched to the wrong line or
 * left unmatched — both visible and flagged — never a wrong amount on a filed
 * document. Keep it that way.
 *
 * The corporate card statement never reaches this file.
 */
import Anthropic from "@anthropic-ai/sdk";

export const RECEIPT_MODEL = "claude-haiku-4-5-20251001";

export interface ReceiptReading {
  /** As printed on the receipt, normalised to "Jun 08 2026". Null if unreadable. */
  date: string | null;
  /** Total paid, digits only, e.g. "31.04". Null if unreadable. */
  amount: string | null;
  /** Merchant name as printed. Null if unreadable. */
  merchant: string | null;
  /** The model's own view of whether the image was legible. */
  legible: boolean;
}

const SYSTEM = `You read expense receipts. Report only what is printed on the image.

Rules:
- Report the TOTAL actually charged, including tax and tip. Not the subtotal.
- Give the amount as digits only: "31.04", not "$31.04" or "CA$31.04".
- Give the date as "Mmm DD YYYY", e.g. "Jun 08 2026".
- Give the merchant exactly as printed at the top of the receipt.
- If a field is genuinely unreadable, return null for it. Never guess, never
  estimate, never infer a value from context. A null is far more useful than a
  plausible invention.
- Set legible to false if the image is too poor to read with confidence.`;

/*
 * Prompt changes here are load-bearing — re-run `npm run eval:receipts` after
 * any edit and compare the match count rather than reasoning about wording.
 *
 * Two things learned the expensive way:
 *
 * 1. A shorter version of the last rule was tried because it looked better on
 *    one image. Measured across all 25 it was worse (23/25 vs 24/25). Tuning a
 *    prompt on a single example is tuning on noise.
 *
 * 2. A rule was added spelling out that currency prefixes aren't digits, and it
 *    included the WRONG value as an illustration of what not to produce. The
 *    model produced exactly that value. Never put an incorrect example in a
 *    prompt — a model reads it as a thing worth writing.
 */

const TOOL = {
  name: "report_receipt",
  description: "Report the fields visible on the receipt image.",
  input_schema: {
    type: "object" as const,
    properties: {
      date: { type: ["string", "null"], description: 'e.g. "Jun 08 2026"' },
      amount: { type: ["string", "null"], description: 'digits only, e.g. "31.04"' },
      merchant: { type: ["string", "null"], description: "as printed" },
      legible: { type: "boolean" },
    },
    required: ["date", "amount", "merchant", "legible"],
  },
};

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Add it to .env.local — see FIRST_SESSION.md.",
      );
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

export interface ReadResult extends ReceiptReading {
  inputTokens: number;
  outputTokens: number;
}

/** Read one receipt image. Never throws for a bad reading — returns nulls. */
export async function readReceipt(
  jpeg: Uint8Array,
  signal?: AbortSignal,
): Promise<ReadResult> {
  const message = await getClient().messages.create(
    {
      model: RECEIPT_MODEL,
      max_tokens: 300,
      // This is transcription, not writing. Sampling variety buys nothing and
      // costs consistency: at the default temperature, two runs over the same
      // 25 receipts disagreed — one read $34.42 as $834.42, another misread a
      // merchant name. Same input should give the same answer.
      temperature: 0,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "report_receipt" },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/jpeg",
                data: Buffer.from(jpeg).toString("base64"),
              },
            },
            { type: "text", text: "Read this receipt." },
          ],
        },
      ],
    },
    { signal },
  );

  const use = message.content.find((c) => c.type === "tool_use");
  const raw = (use?.type === "tool_use" ? use.input : {}) as Partial<ReceiptReading>;

  return {
    date: normaliseDate(raw.date ?? null),
    amount: normaliseAmount(raw.amount ?? null),
    merchant: raw.merchant?.trim() || null,
    legible: raw.legible !== false,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}

const MONTHS: Record<string, string> = {
  jan: "Jan", feb: "Feb", mar: "Mar", apr: "Apr", may: "May", jun: "Jun",
  jul: "Jul", aug: "Aug", sep: "Sep", oct: "Oct", nov: "Nov", dec: "Dec",
};

/** Accept the several shapes a model might return; reject anything else. */
function normaliseDate(value: string | null): string | null {
  if (!value) return null;
  const text = value.trim();

  let m = /^([A-Za-z]{3,})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(text);
  if (m) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()];
    return mon ? `${mon} ${m[2].padStart(2, "0")} ${m[3]}` : null;
  }

  m = /^(\d{1,2})[-/\s]([A-Za-z]{3,})[-/\s](\d{4})$/.exec(text);
  if (m) {
    const mon = MONTHS[m[2].slice(0, 3).toLowerCase()];
    return mon ? `${mon} ${m[1].padStart(2, "0")} ${m[3]}` : null;
  }

  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (m) {
    const mon = Object.values(MONTHS)[Number(m[2]) - 1];
    return mon ? `${mon} ${m[3]} ${m[1]}` : null;
  }

  return null;
}

/** "CA$31.04" / "$31.04" / "31,04" -> "31.04". Null if it isn't a number. */
function normaliseAmount(value: string | null): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[^\d.,-]/g, "").replace(/,/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.abs(n).toFixed(2) : null;
}
