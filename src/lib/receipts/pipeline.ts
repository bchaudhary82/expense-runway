/**
 * The shared server-side pipeline: files in, statement + receipt images out.
 *
 * Both /api/reconcile and /api/build-report go through here so they can't drift
 * apart. That matters more than it sounds: reconciliation decides which receipt
 * belongs to which line, and the report has to embed exactly those receipts.
 * If the two endpoints extracted images differently, `imageIndex` would mean
 * different things in each and receipts would land under the wrong expenses —
 * silently, and looking entirely plausible.
 *
 * Extraction is deterministic: same files in, same images in the same order.
 * That's what lets the model run ONCE, during reconciliation, with its readings
 * carried forward to generation instead of paying for them twice.
 */
import { parseStatement, type StatementRow } from "@/lib/statement/parseStatement";
import {
  extractReceipts,
  unsupportedReason,
  type ReceiptImage,
} from "./extract";

export interface PipelineInput {
  statementBytes: Uint8Array;
  rows: StatementRow[];
  images: ReceiptImage[];
  /** Files we couldn't read, reported rather than dropped. */
  unreadable: string[];
}

export async function runPipeline(files: File[]): Promise<PipelineInput | { error: string }> {
  let statementBytes: Uint8Array | null = null;
  let rows: StatementRow[] = [];
  const receiptFiles: { name: string; bytes: Uint8Array }[] = [];

  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isPdf =
      file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");

    if (isPdf && !statementBytes) {
      try {
        const parsed = await parseStatement(bytes);
        if (parsed.rows.length > 0) {
          statementBytes = bytes;
          rows = parsed.rows;
          continue;
        }
      } catch {
        // Not the statement — treat it as a receipt source.
      }
    }
    receiptFiles.push({ name: file.name, bytes });
  }

  if (!statementBytes) {
    return { error: "No corporate card statement found among those files." };
  }

  const images: ReceiptImage[] = [];
  const unreadable: string[] = [];
  for (const { name, bytes } of receiptFiles) {
    if (unsupportedReason(name)) {
      unreadable.push(name);
      continue;
    }
    images.push(...(await extractReceipts(name, bytes)));
  }

  return { statementBytes, rows, images, unreadable };
}
