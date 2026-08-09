/**
 * POST /api/parse-statement
 *
 * Takes the uploaded files, finds the corporate card statement among them, and
 * returns its line items.
 *
 * NOTHING IS STORED. Files are read into memory, parsed, and dropped when the
 * response is sent. Nothing is written to disk, no database, no log line
 * containing a merchant name or an amount. Refreshing the browser is a clean
 * slate because there is nothing anywhere to come back to.
 *
 * NO AI. The statement is parsed deterministically by our own code and is never
 * sent to the Claude API or anywhere else off this server. This is the
 * non-negotiable in CLAUDE.md.
 *
 * HOW THE STATEMENT IS IDENTIFIED: not by filename — a renamed file would break
 * that. Every PDF is run through the parser, and the statement is the one that
 * actually yields transaction rows. Hotel folios and scanned receipts yield
 * none, so they rule themselves out.
 */
import { NextResponse } from "next/server";
import { unsupportedReason } from "@/lib/receipts/extract";
import {
  parseStatement,
  type DeclaredTotals,
  type SkippedLine,
  type StatementRow,
} from "@/lib/statement/parseStatement";

// unpdf needs the Node runtime, not the Edge one.
export const runtime = "nodejs";

export interface ParseResponse {
  rows: StatementRow[];
  /** Name of the file identified as the statement. */
  statementFile: string;
  /** Files that were accepted but aren't the statement — receipts, handled later. */
  otherFiles: string[];
  /** Per-file problems, in plain language. Never a silent drop. */
  notices: string[];
  /**
   * Statement lines that begin with a date but couldn't be read. These are NOT
   * in `rows` and therefore NOT in the report — the user has to be told, loudly.
   */
  skipped: SkippedLine[];
  /** What the statement says about itself — used to check our own work. */
  declared: DeclaredTotals | null;
}

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Couldn't read the uploaded files. Try again." },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  if (files.length === 0) {
    return NextResponse.json(
      { error: "No files were uploaded." },
      { status: 400 },
    );
  }

  const notices: string[] = [];
  const otherFiles: string[] = [];
  const candidates: {
    name: string;
    rows: StatementRow[];
    skipped: SkippedLine[];
    declared: DeclaredTotals | null;
  }[] = [];

  for (const file of files) {
    const isPdf =
      file.type === "application/pdf" ||
      file.name.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      // Uber .docx, photos and scans arrive here — they're receipts, handled
      // when the report is built. Anything we genuinely can't read is called
      // out now rather than disappearing quietly.
      const problem = unsupportedReason(file.name);
      if (problem) notices.push(problem);
      else otherFiles.push(file.name);
      continue;
    }

    try {
      const { rows, skipped, declared } = await parseStatement(
        new Uint8Array(await file.arrayBuffer()),
      );
      if (rows.length > 0)
        candidates.push({ name: file.name, rows, skipped, declared });
      else otherFiles.push(file.name);
    } catch {
      notices.push(
        `Couldn't read "${file.name}". It may be password-protected or damaged — ` +
          `try re-downloading it, or leave it out and add it manually later.`,
      );
    }
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      {
        error:
          "None of those files looks like a corporate card statement. The " +
          "statement is the PDF with the transaction table — its filename " +
          "usually starts with Corporate_CC.",
        notices,
      },
      { status: 422 },
    );
  }

  if (candidates.length > 1) {
    return NextResponse.json(
      {
        error:
          `More than one file looks like a statement ` +
          `(${candidates.map((c) => `"${c.name}"`).join(", ")}). ` +
          `Upload one month at a time so the report covers a single period.`,
        notices,
      },
      { status: 422 },
    );
  }

  const statement = candidates[0];

  const response: ParseResponse = {
    rows: statement.rows,
    statementFile: statement.name,
    otherFiles,
    notices,
    skipped: statement.skipped,
    declared: statement.declared,
  };

  return NextResponse.json(response);
}
