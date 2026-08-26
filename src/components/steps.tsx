"use client";

/**
 * Step 1 — Upload.
 *
 * The other three steps are their own files: ReconcileStep, PurposesStep and
 * DownloadStep. This one stayed here because it owns the drop zone, the file
 * list and the "here's what we read" confirmation.
 *
 * No real statement or receipt data is hard-coded anywhere in src/, and none
 * ever should be — that data belongs only in evals/, which is gitignored.
 */
import { useRef, useState, type DragEvent } from "react";
import type { ParseResponse } from "@/app/api/parse-statement/route";
import {
  billedTotal,
  checkAgainstDeclared,
  formatMoney,
} from "@/lib/statement/format";
import {
  checkFilesReadable,
  checkUploadSize,
  describeTransportFailure,
  formatBytes,
  looksLikeAFinishedReport,
  readError,
  timeoutSignal,
} from "@/lib/uploadLimits";
import { LineItemsTable } from "./LineItemsTable";
import { Button, Card, IconCircle, StatusTag } from "./ui";

const fileKey = (f: File) => `${f.name}:${f.size}`;

function StepHeading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-5">
      <h1 className="font-display text-[24px] font-bold text-ink">{title}</h1>
      <p className="mt-1 text-[15px] text-body">{blurb}</p>
    </div>
  );
}

export function UploadStep({
  parsed,
  onParsed,
  onFiles,
  onReset,
  onContinue,
}: {
  parsed: ParseResponse | null;
  onParsed: (result: ParseResponse) => void;
  onFiles: (files: File[]) => void;
  onReset: () => void;
  /** Move on to Reconcile. Only offered once a statement has parsed. */
  onContinue: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  /** Keys of files that are named here but whose contents are still in OneDrive. */
  const [unavailable, setUnavailable] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Check availability the moment files are NAMED, not when the upload starts.
   *
   * The first version of this check ran on submit, which was still too late to
   * be useful: the one file that had not been copied to the desktop sailed
   * through Upload and Reconcile and only announced itself at the download
   * step, after the whole month had been reconciled by hand. The browser can
   * answer this question the instant a file is dropped, so it should.
   */
  async function addFiles(incoming: FileList | null) {
    if (!incoming) return;
    setError(null);

    const dropped = Array.from(incoming);
    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      return [...current, ...dropped.filter((f) => !seen.has(fileKey(f)))];
    });

    setChecking(true);
    try {
      const check = await checkFilesReadable(dropped);
      setUnavailable((current) => {
        const next = new Set(current);
        for (const f of dropped) next.delete(fileKey(f));
        for (const f of check.unreadableFiles) next.add(fileKey(f));
        return next;
      });
    } finally {
      setChecking(false);
    }
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    addFiles(e.dataTransfer.files);
  }

  async function readFiles() {
    // Check the size BEFORE uploading. The server can only reject an oversized
    // request after it has all been sent, and it does so with a plain-text
    // error that isn't ours — so the user waits, then gets told something
    // unhelpful. The browser already knows the total.
    const size = checkUploadSize(files);
    if (!size.ok) {
      setError(size.message);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      /* And check the files are actually HERE before sending any of them.
         The size check above is satisfied by metadata, which a cloud-only
         OneDrive placeholder supplies in full while holding no contents. */
      /* Re-checked here as well as on drop, because a file can be evicted back
         to the cloud between being added and being sent. */
      const readable = await checkFilesReadable(files);
      if (!readable.ok) {
        setUnavailable(new Set(readable.unreadableFiles.map(fileKey)));
        setError(readable.message);
        return;
      }

      const body = new FormData();
      for (const f of files) body.append("files", f);

      const res = await fetch("/api/parse-statement", {
        method: "POST",
        body,
        signal: timeoutSignal(),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      onFiles(files);
      onParsed((await res.json()) as ParseResponse);
    } catch (failure) {
      setError(describeTransportFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setFiles([]);
    setError(null);
    onReset();
  }

  /* ---- after a successful parse ---- */
  if (parsed) {
    const total = billedTotal(parsed.rows);
    const selfCheck = checkAgainstDeclared(parsed.rows, parsed.declared);
    return (
      <>
        <StepHeading
          title="Here's what we read"
          blurb={`From ${parsed.statementFile}. Check the total against your statement before going on.`}
        />

        {parsed.skipped.length > 0 && (
          <Card className="mb-4 border-l-4 border-l-block p-6">
            <StatusTag tone="block" icon="!">
              {parsed.skipped.length === 1
                ? "1 line couldn't be read"
                : `${parsed.skipped.length} lines couldn't be read`}
            </StatusTag>
            <p className="mt-2 text-[15px] text-ink">
              These lines are on your statement but are{" "}
              <span className="font-semibold">not in the report below</span>, and
              the total doesn&rsquo;t include them. Add them by hand, or send the
              statement over so the parser can be fixed.
            </p>
            <ul className="mt-3 space-y-1">
              {parsed.skipped.map((s) => (
                <li
                  key={`${s.page}-${s.text}`}
                  className="rounded-[4px] bg-canvas px-3 py-2 font-mono text-[13px] text-ink"
                >
                  {s.text}
                  <span className="ml-2 font-sans text-body">(page {s.page})</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        <Card className="mb-4 p-6">
          <div className="grid gap-6 sm:grid-cols-3">
            <div>
              <div className="font-display text-[28px] font-bold tabular-nums text-ink">
                {parsed.rows.length}
              </div>
              <div className="text-[14px] text-body">line items</div>
            </div>
            <div>
              <div className="font-display text-[28px] font-bold tabular-nums text-ink">
                {formatMoney(total)}
              </div>
              <div className="text-[14px] text-body">total billed, CAD</div>
            </div>
            <div>
              <div className="mt-1.5">
                {selfCheck.ok ? (
                  <StatusTag tone="ok" icon="✓">
                    Balances to the statement
                  </StatusTag>
                ) : (
                  <StatusTag tone="block" icon="!">
                    Doesn&rsquo;t balance
                  </StatusTag>
                )}
              </div>
              <div className="mt-1 text-[14px] text-body">
                {selfCheck.ok
                  ? `matches the ${parsed.declared?.transactionCount} transactions and total printed on the statement`
                  : selfCheck.reason}
              </div>
            </div>
          </div>

          {parsed.otherFiles.length > 0 && (
            <p className="mt-6 border-t border-line pt-4 text-[13px] text-body">
              Set aside for the reconcile step: {parsed.otherFiles.join(", ")}
            </p>
          )}

          {parsed.notices.map((n) => (
            <p key={n} className="mt-4 text-[13px] text-warn">
              {n}
            </p>
          ))}
        </Card>

        <Card className="overflow-hidden">
          <LineItemsTable rows={parsed.rows} showPurpose={false} />
        </Card>

        {/* The way forward.
            This block only renders once a statement has parsed, so the button
            can never lead to an empty Reconcile screen. Before this existed the
            only route on was the stepper at the top, which reads as navigation
            rather than as the next thing to do — Reconcile and Purposes have
            always ended in a Continue button, and this screen was the one that
            didn't. It adds no capability the stepper lacked, including when the
            statement doesn't balance: that warning sits above, unchanged, and
            is the more visible thing on the screen. */}
        <div className="mt-6 flex flex-wrap items-center gap-4">
          <Button onClick={onContinue}>Continue to receipts</Button>
          <Button variant="secondary" onClick={startOver}>
            Start over with different files
          </Button>
          <span className="text-[14px] text-body">
            Nothing was saved. Refreshing this page clears everything.
          </span>
        </div>
      </>
    );
  }

  /* Named in the list, but the contents aren't on this computer. */
  const blocked = files.filter((f) => unavailable.has(fileKey(f)));

  /* ---- before parsing ---- */
  return (
    <>
      <StepHeading
        title="Upload your month"
        blurb="Drop in the corporate card statement plus any receipts — Uber summaries, scanned paper receipts, hotel folios."
      />

      <Card className="p-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-stretch">
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`flex flex-1 flex-col items-center justify-center rounded-[8px] border-2 border-dashed px-6 py-12 text-center transition-colors ${
              dragging ? "border-teal bg-teal/5" : "border-line bg-canvas"
            }`}
          >
            <IconCircle>
              <span aria-hidden="true" className="text-[18px] text-teal">
                ↑
              </span>
            </IconCircle>
            <p className="mt-3 text-[15px] font-semibold text-ink">
              Drag your files here
            </p>
            <p className="mt-1 text-[14px] text-body">
              or{" "}
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="font-semibold text-teal underline-offset-2 hover:underline"
              >
                browse
              </button>{" "}
              — PDF, Word, or a photo of a receipt
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              accept=".pdf,.docx,.jpg,.jpeg,.png,.webp,application/pdf,image/*"
              className="hidden"
              onChange={(e) => {
                addFiles(e.target.files);
                e.target.value = "";
              }}
            />
          </div>

          <div className="flex flex-col justify-center gap-3 lg:w-[240px]">
            {checking && (
              /* Explain the pause. Touching a cloud-only file is what makes
                 OneDrive start downloading it, so this wait IS the download —
                 measured at slightly over fifteen seconds on a real month. A
                 silent pause that long reads as the app having hung. */
              <p className="text-[13px] text-body">
                Fetching anything still stored in OneDrive. This can take a
                minute the first time.
              </p>
            )}
            <Button
              onClick={readFiles}
              disabled={
                files.length === 0 ||
                busy ||
                checking ||
                blocked.length > 0 ||
                !checkUploadSize(files).ok
              }
              className="w-full"
            >
              {checking ? "Getting your files…" : busy ? "Reading…" : "Read my files"}
            </Button>
            <p className="text-center text-[13px] text-body">
              Nothing is saved. Files are read in memory and cleared when you
              refresh.
            </p>
          </div>
        </div>

        {files.length > 0 && (
          <ul className="mt-5 divide-y divide-line border-t border-line">
            {files.map((f) => (
              <li
                key={`${f.name}:${f.size}`}
                className="flex items-center gap-3 py-2.5 text-[14px]"
              >
                <span className="flex-1 truncate text-ink">
                  {f.name}
                  {unavailable.has(fileKey(f)) && (
                    <span className="ml-2 text-[13px] font-semibold text-block">
                      — still in the cloud, not on this computer
                    </span>
                  )}
                  {looksLikeAFinishedReport(f.name) && (
                    <span className="ml-2 text-[13px] font-semibold text-warn">
                      — looks like a finished report, not an input
                    </span>
                  )}
                </span>
                <span className="tabular-nums text-body">
                  {(f.size / 1024).toFixed(0)} KB
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setFiles((c) =>
                      c.filter((x) => !(x.name === f.name && x.size === f.size)),
                    )
                  }
                  className="rounded-[4px] px-2 text-[13px] font-semibold text-teal hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {blocked.length > 0 && (
          <p className="mt-3 text-[13px] font-semibold text-block">
            {blocked.length === 1
              ? "1 file is still in the cloud"
              : `${blocked.length} files are still in the cloud`}
            . Open the folder in File Explorer, wait for the solid green check
            beside each one — not the cloud outline — then remove them here and
            add them again.
          </p>
        )}

        {files.length > 0 && (
          <p
            className={`mt-3 text-[13px] ${
              checkUploadSize(files).ok ? "text-body" : "font-semibold text-block"
            }`}
          >
            {formatBytes(checkUploadSize(files).totalBytes)} total
            {!checkUploadSize(files).ok && " — too large to upload"}
          </p>
        )}
      </Card>

      {error && (
        <Card className="mt-4 border-l-4 border-l-block p-6">
          <StatusTag tone="block" icon="!">
            Couldn&rsquo;t read that
          </StatusTag>
          <p className="mt-2 text-[15px] text-ink">{error}</p>
        </Card>
      )}

      <p className="mt-4 text-[13px] text-body">
        The statement is required. Everything else is optional — anything missing
        gets flagged in the next step.
      </p>
    </>
  );
}
