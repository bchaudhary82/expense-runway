/**
 * POST /api/build-report
 *
 * Files + the readings from /api/reconcile + the user's decisions, in. Finished
 * Word document out.
 *
 * NOTHING IS STORED. Held in memory for the request, dropped on response.
 *
 * THE MODEL DOES NOT RUN HERE. Receipt readings are passed in from the reconcile
 * step. Two reasons, and the second is the important one:
 *   - it isn't paid for twice
 *   - the document cannot disagree with the screen the user just approved
 *
 * GENERATION IS BLOCKED while any reconciliation flag is unresolved. The
 * disabled button in the UI is a courtesy; this is the actual control. A request
 * that arrives with outstanding flags is refused with a list of them.
 */
import { NextResponse } from "next/server";
import { Packer } from "docx";
import { renderStatementScreenshot } from "@/lib/receipts/extract";
import { runPipeline } from "@/lib/receipts/pipeline";
import type { ReceiptCandidate } from "@/lib/receipts/match";
import {
  applyResolutions,
  reconcile,
  type Resolutions,
} from "@/lib/receipts/reconcile";
import {
  buildReportDocument,
  type EmbeddedImage,
  type ReportImages,
} from "@/lib/report/buildReport";
import { applyEdits, type AmountOverride } from "@/lib/report/edits";
import { reportFileName, type Purposes } from "@/lib/report/reportFormat";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const form = await request.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  const purposes: Purposes = JSON.parse((form.get("purposes") as string) ?? "{}");
  const resolutions: Resolutions = JSON.parse(
    (form.get("resolutions") as string) ?? "{}",
  );
  const readings: ReceiptCandidate[] = JSON.parse(
    (form.get("readings") as string) ?? "[]",
  );
  // Deleted rows and hand-typed amounts from the review step.
  const excluded: number[] = JSON.parse((form.get("excluded") as string) ?? "[]");
  const overrides: Record<number, AmountOverride> = JSON.parse(
    (form.get("overrides") as string) ?? "{}",
  );

  if (files.length === 0) {
    return NextResponse.json({ error: "No files were uploaded." }, { status: 400 });
  }

  /* Timed, because this route has failed intermittently in production while
     completing in 10s locally, and every explanation offered for it so far has
     been a guess. The numbers come back on the response so a real run reports
     what it actually cost, rather than what a laptop says it should. */
  const startedAt = Date.now();
  const input = await runPipeline(files);
  const extractedAt = Date.now();
  if ("error" in input) {
    return NextResponse.json({ error: input.error }, { status: 422 });
  }

  /* The readings arrive from /api/reconcile keyed by position in the extracted
     image list. That only holds if the SAME files are sent to both endpoints.
     Send fewer, and every index past the missing file points at a different
     receipt — which would attach receipts to the wrong expenses while looking
     entirely normal. Extraction is deterministic, so a count mismatch is a
     reliable signal that the file set changed. Refuse rather than guess. */
  if (readings.length !== input.images.length) {
    return NextResponse.json(
      {
        error:
          `These files don't match the ones that were reconciled ` +
          `(${input.images.length} receipt images now, ${readings.length} then). ` +
          `Go back to the Reconcile step and match again.`,
      },
      { status: 409 },
    );
  }

  const state = reconcile(input.rows, readings);
  const applied = applyResolutions(state, resolutions);

  if (applied.outstanding.length > 0) {
    return NextResponse.json(
      {
        error:
          applied.outstanding.length === 1
            ? "1 thing still needs a decision before the report can be built."
            : `${applied.outstanding.length} things still need a decision before the report can be built.`,
        outstanding: applied.outstanding.map((f) => f.message),
      },
      { status: 409 },
    );
  }

  /* The same receipt under two expenses builds a report that looks finished
     and is wrong. The screen stops this happening; this stops it being possible
     at all, including for a request that never went through the screen. */
  if (applied.conflicts.length > 0) {
    return NextResponse.json(
      {
        error:
          `The same receipt is attached to more than one statement line. ` +
          `Go back to Reconcile and give each line its own receipt.`,
        outstanding: applied.conflicts.map(
          (c) =>
            `One receipt is attached to ${c.rowIndexes.length} lines: ` +
            c.rowIndexes
              .map((i) => `${input.rows[i]?.vendor ?? "a line"} on ${input.rows[i]?.date ?? "an unknown date"}`)
              .join(", "),
        ),
      },
      { status: 409 },
    );
  }

  /* Deletions and overrides, applied through one tested function.

     Removing a row shifts every index after it, and receipts and purposes are
     keyed by index — so this re-keying is where a receipt could silently end up
     under the wrong expense. It lives in applyEdits() and is exercised by
     `npm run verify:blocking` rather than being written inline here twice. */
  const edits = applyEdits(input.rows, applied.assignments, {
    purposes,
    excluded: [...new Set([...excluded, ...applied.excludedRows])],
    overrides,
  });

  const receiptsByRowIndex: Record<number, EmbeddedImage> = {};
  for (const [rowIndexText, imageIndex] of Object.entries(edits.assignments)) {
    const img = input.images[imageIndex];
    if (img) {
      receiptsByRowIndex[Number(rowIndexText)] = {
        data: img.data,
        width: img.width,
        height: img.height,
      };
    }
  }

  const reportImages: ReportImages = {
    statement: await renderStatementScreenshot(input.statementBytes),
    receiptsByRowIndex,
  };

  const renderedAt = Date.now();

  const buffer = await Packer.toBuffer(
    buildReportDocument(edits.rows, edits.purposes, reportImages),
  );
  const finishedAt = Date.now();

  console.log(
    `[build-report] ${edits.rows.length} rows, ${input.images.length} images, ` +
      `${(buffer.length / 1024 / 1024).toFixed(2)} MB out — ` +
      `extract ${extractedAt - startedAt}ms, screenshot ${renderedAt - extractedAt}ms, ` +
      `docx ${finishedAt - renderedAt}ms, total ${finishedAt - startedAt}ms`,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "content-type":
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "content-disposition": `attachment; filename="${encodeURIComponent(reportFileName(edits.rows, input.statementDate))}"`,
      "x-expenses": String(edits.rows.length),
      "x-with-receipt": String(Object.keys(receiptsByRowIndex).length),
      "x-excluded": String(edits.excludedCount),
      "x-overridden": String(edits.overriddenRows.length),
      "x-unreadable-files": String(input.unreadable.length),
      "x-ms-total": String(finishedAt - startedAt),
      "x-ms-extract": String(extractedAt - startedAt),
      "x-ms-screenshot": String(renderedAt - extractedAt),
      "x-ms-docx": String(finishedAt - renderedAt),
      "x-images": String(input.images.length),
    },
  });
}
