/**
 * POST /api/reconcile
 *
 * Extracts the receipts, reads them, matches them to statement lines, and
 * returns everything the user has to decide about — with a thumbnail of each
 * receipt so they can see what they're deciding.
 *
 * This is where the model runs, ONCE. Its readings come back with the response
 * and get handed to /api/build-report, so generation costs nothing extra and,
 * more importantly, can't reach a different conclusion than the screen showed.
 *
 * NOTHING IS STORED. Held in memory for the request, dropped on response.
 */
import { NextResponse } from "next/server";
import { thumbnail } from "@/lib/receipts/extract";
import { runPipeline } from "@/lib/receipts/pipeline";
import { readReceipt } from "@/lib/receipts/vision";
import type { ReceiptCandidate } from "@/lib/receipts/match";
import { reconcile, stripThumb, type ReconcileState } from "@/lib/receipts/reconcile";
import type { StatementRow } from "@/lib/statement/parseStatement";

export const runtime = "nodejs";
export const maxDuration = 120;

export interface ReconcileReceipt extends ReceiptCandidate {
  /** Small preview, as a data URI. The full image never leaves the server. */
  thumb: string;
}

export interface ReconcileResponse {
  rows: StatementRow[];
  receipts: ReconcileReceipt[];
  state: ReconcileState;
  unreadable: string[];
}

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ error: "No files were uploaded." }, { status: 400 });
  }

  const input = await runPipeline(files);
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 422 });
  }

  const readings = await Promise.all(
    input.images.map(async (img, i) => ({
      i,
      source: img.source,
      page: img.index,
      documentGroup: img.documentGroup,
      /* A typed missing-receipt form already states its date and amount
         exactly. Nothing to read, nothing to pay for, nothing to misread. */
      reading: img.known ?? (await readReceipt(img.data)),
      thumb: await thumbnail(img.data),
    })),
  );

  const receipts: ReconcileReceipt[] = readings.map(
    ({ i, source, page, documentGroup, reading, thumb }) => ({
    ...reading,
    imageIndex: i,
    source,
    page,
    documentGroup,
    thumb: `data:image/jpeg;base64,${Buffer.from(thumb.data).toString("base64")}`,
    }),
  );

  const candidates: ReceiptCandidate[] = receipts.map((r) => stripThumb(r));

  const response: ReconcileResponse = {
    rows: input.rows,
    receipts,
    state: reconcile(input.rows, candidates),
    unreadable: input.unreadable,
  };

  return NextResponse.json(response);
}
