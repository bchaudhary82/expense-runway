"use client";

/**
 * Step 4 — Download.
 *
 * DESIGN.md calls this the "confirmation" screen: a reconciliation summary and a
 * single primary button, the same shape as a booking confirmation.
 *
 * Everything that could make the report wrong is stated here BEFORE the button:
 * lines with no receipt, deleted rows, hand-typed amounts. This is the last
 * screen before something gets filed, so it's the right place to be blunt.
 */
import { useState } from "react";
import type { ReconcileResponse } from "@/app/api/reconcile/route";
import type { StatementRow } from "@/lib/statement/parseStatement";
import type { AmountOverride } from "@/lib/report/edits";
import { applyEdits } from "@/lib/report/edits";
import { applyResolutions, type Resolutions } from "@/lib/receipts/reconcile";
import type { Purposes } from "@/lib/report/reportFormat";
import { reportFileName } from "@/lib/report/reportFormat";
import { billedTotal, formatMoney } from "@/lib/statement/format";
import { checkUploadSize, readError } from "@/lib/uploadLimits";
import { Button, Card, StatusTag } from "./ui";

export function DownloadStep({
  rows,
  files,
  reconciled,
  resolutions,
  purposes,
  excluded,
  overrides,
}: {
  rows: StatementRow[];
  files: File[];
  reconciled: ReconcileResponse | null;
  resolutions: Resolutions;
  purposes: Purposes;
  excluded: number[];
  overrides: Record<number, AmountOverride>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (rows.length === 0) {
    return (
      <Card className="p-10 text-center">
        <p className="font-display text-[18px] font-semibold text-ink">
          Nothing uploaded yet
        </p>
        <p className="mt-1 text-[15px] text-body">
          Go back to the Upload step and read in your statement first.
        </p>
      </Card>
    );
  }

  const applied = reconciled
    ? applyResolutions(reconciled.state, resolutions)
    : null;
  const outstanding = applied?.outstanding ?? [];

  // Rows removed here plus rows marked personal during reconciliation.
  const allExcluded = [...new Set([...excluded, ...(applied?.excludedRows ?? [])])];
  const edits = applyEdits(rows, applied?.assignments ?? {}, {
    purposes,
    excluded: allExcluded,
    overrides,
  });

  const withReceipt = Object.keys(edits.assignments).length;
  const withoutReceipt = edits.rows.length - withReceipt;
  const blocked = !reconciled || outstanding.length > 0;

  async function download() {
    // The files are sent up a second time to build the document, so the same
    // ceiling applies here.
    const size = checkUploadSize(files);
    if (!size.ok) {
      setError(size.message);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const body = new FormData();
      for (const f of files) body.append("files", f);
      body.append("purposes", JSON.stringify(purposes));
      body.append("resolutions", JSON.stringify(resolutions));
      body.append("excluded", JSON.stringify(excluded));
      body.append("overrides", JSON.stringify(overrides));
      body.append(
        "readings",
        JSON.stringify(
          (reconciled?.receipts ?? []).map((r) => {
            const copy = { ...r } as Partial<typeof r>;
            delete copy.thumb;
            return copy;
          }),
        ),
      );

      const res = await fetch("/api/build-report", { method: "POST", body });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = reportFileName(edits.rows);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone(reportFileName(edits.rows));
    } catch {
      setError("Couldn't build the document. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-5">
        <h1 className="font-display text-[24px] font-bold text-ink">
          {blocked ? "Not ready yet" : "Your report is ready"}
        </h1>
        <p className="mt-1 text-[15px] text-body">
          {blocked
            ? "There's still something to decide on an earlier step."
            : "Check this over, then download it and key it into JD Edwards."}
        </p>
      </div>

      <Card className="p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <Stat value={String(edits.rows.length)} label="expenses" />
          <Stat
            value={formatMoney(billedTotal(edits.rows))}
            label="total billed, CAD"
          />
          <div>
            <div className="mt-1.5">
              {blocked ? (
                <StatusTag tone="block" icon="!">
                  {outstanding.length || "Receipts not matched"}
                  {outstanding.length ? " still to decide" : ""}
                </StatusTag>
              ) : (
                <StatusTag tone="ok" icon="✓">
                  Every statement line accounted for
                </StatusTag>
              )}
            </div>
            <div className="mt-1 text-[14px] text-body">
              {withReceipt} with a receipt
              {withoutReceipt > 0 && `, ${withoutReceipt} without`}
            </div>
          </div>
        </div>

        {/* Everything worth knowing before this is filed */}
        <ul className="mt-6 space-y-2 border-t border-line pt-5 text-[14px]">
          <Line
            ok
            text={`${withReceipt} of ${edits.rows.length} expenses have their receipt attached`}
          />
          {withoutReceipt > 0 && (
            <Line
              text={`${withoutReceipt} included with no receipt — you marked those as lost`}
            />
          )}
          {allExcluded.length > 0 && (
            <Line
              text={`${allExcluded.length} line${allExcluded.length === 1 ? "" : "s"} deleted as personal — not in the report or the total`}
            />
          )}
          {edits.overriddenRows.length > 0 && (
            <Line
              warn
              text={`${edits.overriddenRows.length} amount${edits.overriddenRows.length === 1 ? "" : "s"} typed by hand — these no longer match the statement`}
            />
          )}
          <Line
            ok
            text="Every amount not listed above came straight from the statement, unchanged"
          />
        </ul>

        <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-line pt-6">
          <Button onClick={download} disabled={busy || blocked}>
            {busy ? "Building…" : "Download Word document"}
          </Button>
          <span className="text-[14px] text-body">
            {blocked
              ? !reconciled
                ? "Match your receipts on the Reconcile step first."
                : `${outstanding.length} thing${outstanding.length === 1 ? "" : "s"} still need${outstanding.length === 1 ? "s" : ""} a decision on the Reconcile step.`
              : reportFileName(edits.rows)}
          </span>
        </div>

        {error && <p className="mt-4 text-[14px] text-block">{error}</p>}
        {done && (
          <p className="mt-4 text-[14px] text-body">
            <span className="font-semibold text-ink">Downloaded.</span> {done} —
            nothing was saved anywhere; refreshing this page clears everything.
          </p>
        )}
      </Card>
    </>
  );
}

function Line({ text, ok, warn }: { text: string; ok?: boolean; warn?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span
        aria-hidden="true"
        className={ok ? "text-ok" : warn ? "text-warn" : "text-body"}
      >
        {ok ? "✓" : warn ? "!" : "•"}
      </span>
      <span className={warn ? "text-ink" : "text-body"}>{text}</span>
    </li>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="font-display text-[28px] font-bold tabular-nums text-ink">
        {value}
      </div>
      <div className="text-[14px] text-body">{label}</div>
    </div>
  );
}
