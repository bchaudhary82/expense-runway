"use client";

/**
 * Step 2 — Reconcile.
 *
 * DESIGN.md: this is the "select your flight" step. Cleanly matched lines stay
 * quiet with a green tick; anything needing a decision is a bordered card with a
 * plain problem statement and explicit choices. Flags read like disruption
 * messaging — calm, specific, tells you what to do next. Never a modal, never a
 * red wall, never an error code.
 *
 * Blocking lives at the bottom: the Continue button is disabled with a
 * plain-language reason beside it, and each unresolved item is anchor-linked
 * from that message.
 */
import { useState } from "react";
import type { ReconcileResponse } from "@/app/api/reconcile/route";
import type { Flag, FlagChoice, Resolutions } from "@/lib/receipts/reconcile";
import { applyResolutions, claimsExcluding } from "@/lib/receipts/reconcile";
import type { StatementRow } from "@/lib/statement/parseStatement";
import { formatMoney } from "@/lib/statement/format";
import {
  checkFilesReadable,
  describeTransportFailure,
  readError,
  timeoutSignal,
} from "@/lib/uploadLimits";
import { Button, Card, StatusTag } from "./ui";

const TONE: Record<Flag["kind"], { tone: "warn" | "block"; label: string }> = {
  "missing-receipt": { tone: "block", label: "Receipt missing" },
  "extra-receipt": { tone: "warn", label: "Receipt with no matching line" },
  ambiguous: { tone: "warn", label: "Which line is this?" },
  duplicate: { tone: "warn", label: "Same receipt twice" },
  "amount-mismatch": { tone: "warn", label: "Amounts don't match" },
};

/**
 * Why a choice can't be taken — or null when it can.
 *
 * Every spare receipt is offered inside every "receipt missing" card at once,
 * because the flag list is built once on the server and never re-derived as
 * decisions come in. That is survivable as long as the same receipt cannot end
 * up under two expenses, which until now it could: two lines could each claim
 * it, generation embedded it under both, and the report came out looking
 * deliberate. Offering a receipt that is already spoken for is the moment to
 * stop it, since that is where a person would otherwise make the mistake.
 */
function blockedReason(
  flag: Flag,
  choice: FlagChoice,
  claimed: Map<number, number>,
  rows: StatementRow[],
): string | null {
  let imageIndex: number | undefined;
  let rowIndex: number | undefined;

  if (choice.id.startsWith("attach:") && flag.rowIndex !== undefined) {
    imageIndex = Number(choice.id.slice("attach:".length));
    rowIndex = flag.rowIndex;
  } else if (choice.id.startsWith("row:") && flag.imageIndex !== undefined) {
    imageIndex = flag.imageIndex;
    rowIndex = Number(choice.id.slice("row:".length));
  }
  // Everything else — "receipt lost", "set aside", "remove this line" — takes
  // no receipt and can never collide.
  if (imageIndex === undefined || rowIndex === undefined) return null;

  const holder = claimed.get(imageIndex);
  if (holder === undefined || holder === rowIndex) return null;

  const row = rows[holder];
  return row
    ? `Already attached to ${row.vendor} on ${row.date}`
    : "Already attached to another line";
}

export function ReconcileStep({
  files,
  data,
  onReconciled,
  resolutions,
  onResolve,
  onContinue,
}: {
  files: File[];
  data: ReconcileResponse | null;
  onReconciled: (r: ReconcileResponse) => void;
  resolutions: Resolutions;
  onResolve: (next: Resolutions) => void;
  onContinue: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      /* A file can go back to the cloud between steps, and finding out from a
         failed upload gives no clue which file or why. */
      const readable = await checkFilesReadable(files, "midflow");
      if (!readable.ok) {
        setError(readable.message);
        return;
      }

      const body = new FormData();
      for (const f of files) body.append("files", f);
      const res = await fetch("/api/reconcile", {
        method: "POST",
        body,
        signal: timeoutSignal(),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      onReconciled((await res.json()) as ReconcileResponse);
    } catch (failure) {
      setError(describeTransportFailure(failure));
    } finally {
      setBusy(false);
    }
  }

  if (files.length === 0) {
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

  if (!data) {
    return (
      <>
        <Heading
          title="Match receipts to the statement"
          blurb="Every line on the card statement needs a receipt before a report can be built."
        />
        <Card className="p-8 text-center">
          <p className="text-[15px] text-body">
            {files.length} file{files.length === 1 ? "" : "s"} ready. Reading the
            receipts takes about fifteen seconds.
          </p>
          <div className="mt-5 flex justify-center">
            <Button onClick={run} disabled={busy}>
              {busy ? "Reading receipts…" : "Match my receipts"}
            </Button>
          </div>
          {error && <p className="mt-4 text-[14px] text-block">{error}</p>}
        </Card>
      </>
    );
  }

  const applied = applyResolutions(data.state, resolutions);
  const outstanding = applied.outstanding;
  const matchedRows = new Set(Object.keys(applied.assignments).map(Number));
  const excluded = new Set(applied.excludedRows);

  return (
    <>
      <Heading
        title="Match receipts to the statement"
        blurb="Every line needs a receipt, or a reason it hasn't got one."
      />

      {/* Quiet summary of what needed no decision */}
      <Card className="mb-4 p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <Stat value={String(data.rows.length)} label="statement lines" />
          <Stat value={String(matchedRows.size)} label="with a receipt attached" />
          <div>
            <div className="mt-1.5">
              {outstanding.length === 0 ? (
                <StatusTag tone="ok" icon="✓">
                  Everything accounted for
                </StatusTag>
              ) : (
                <StatusTag tone="warn" icon="!">
                  {outstanding.length} need{outstanding.length === 1 ? "s" : ""} a
                  decision
                </StatusTag>
              )}
            </div>
            <div className="mt-1 text-[14px] text-body">
              {data.receipts.length} receipts read
            </div>
          </div>
        </div>
      </Card>

      {data.unreadable.length > 0 && (
        <Card className="mb-4 border-l-4 border-l-warn p-6">
          <StatusTag tone="warn" icon="!">
            Couldn&rsquo;t read {data.unreadable.length} file
            {data.unreadable.length === 1 ? "" : "s"}
          </StatusTag>
          <p className="mt-2 text-[15px] text-ink">
            {data.unreadable.join(", ")} — these aren&rsquo;t in the report.
          </p>
        </Card>
      )}

      {/* The things that need deciding */}
      {data.state.flags.map((flag) => {
        const chosen = resolutions[flag.id];
        const tone = TONE[flag.kind];
        const receipt =
          flag.imageIndex !== undefined
            ? data.receipts.find((r) => r.imageIndex === flag.imageIndex)
            : undefined;
        const claimed = claimsExcluding(data.state, resolutions, flag.id);

        return (
          <Card
            key={flag.id}
            id={flag.id}
            className={`mb-4 border-l-4 p-6 ${
              chosen ? "border-l-ok" : tone.tone === "block" ? "border-l-block" : "border-l-warn"
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <StatusTag tone={chosen ? "ok" : tone.tone} icon={chosen ? "✓" : "!"}>
                {chosen ? "Resolved" : tone.label}
              </StatusTag>
              {chosen && (
                <button
                  type="button"
                  onClick={() => {
                    const next = { ...resolutions };
                    delete next[flag.id];
                    onResolve(next);
                  }}
                  className="text-[13px] font-semibold text-teal hover:underline"
                >
                  Change
                </button>
              )}
            </div>

            <div className="mt-2 flex gap-4">
              {receipt && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={receipt.thumb}
                  alt={`Receipt from ${receipt.source}`}
                  className="h-[120px] w-auto rounded-[4px] border border-line object-contain"
                />
              )}
              <div className="flex-1">
                <p className="text-[15px] text-ink">{flag.message}</p>

                {chosen ? (
                  <p className="mt-2 text-[14px] text-body">
                    {flag.choices.find((c) => c.id === chosen)?.effect}
                  </p>
                ) : (
                  <div className="mt-4 flex flex-col gap-2">
                    {flag.choices.map((choice) => {
                      const preview =
                        choice.imageIndex !== undefined
                          ? data.receipts.find((r) => r.imageIndex === choice.imageIndex)
                          : undefined;
                      const blocked = blockedReason(
                        flag,
                        choice,
                        claimed,
                        data.rows,
                      );
                      return (
                        <button
                          key={choice.id}
                          type="button"
                          disabled={blocked !== null}
                          onClick={() =>
                            onResolve({ ...resolutions, [flag.id]: choice.id })
                          }
                          title={blocked ?? choice.effect}
                          className={
                            blocked
                              ? "flex cursor-not-allowed items-center gap-3 rounded-[4px] border border-line px-3 py-2 text-left text-[14px] font-semibold text-body opacity-70"
                              : "flex items-center gap-3 rounded-[4px] border border-teal px-3 py-2 text-left text-[14px] font-semibold text-teal hover:bg-canvas"
                          }
                        >
                          {preview && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={preview.thumb}
                              alt=""
                              className="h-14 w-11 shrink-0 rounded-[2px] border border-line bg-surface object-contain"
                            />
                          )}
                          <span>
                            {choice.label}
                            {blocked && (
                              <span className="mt-0.5 block text-[13px] font-normal">
                                {blocked}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}

      {/* Everything that matched cleanly, kept quiet */}
      <Card className="mb-6 divide-y divide-line">
        {data.rows.map((row, i) => {
          if (!matchedRows.has(i) && !excluded.has(i)) return null;
          return (
            <div key={`${row.date}-${i}`} className="flex items-center gap-4 px-6 py-3">
              {excluded.has(i) ? (
                <StatusTag tone="warn" icon="—">
                  Excluded
                </StatusTag>
              ) : (
                <StatusTag tone="ok" icon="✓">
                  Matched
                </StatusTag>
              )}
              <span className="w-[110px] text-[14px] tabular-nums text-body">
                {row.date}
              </span>
              <span className="flex-1 text-[14px] font-semibold text-ink">
                {row.vendor}
              </span>
              <span className="text-[14px] tabular-nums text-ink">
                {formatMoney(row.billedAmount)}
              </span>
            </div>
          );
        })}
      </Card>

      {/* Blocking, per DESIGN.md: disabled button, plain reason, anchor links */}
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={onContinue} disabled={outstanding.length > 0}>
          Continue
        </Button>
        {outstanding.length > 0 ? (
          <span className="text-[14px] text-body">
            {outstanding.length === 1
              ? "1 thing still needs a decision"
              : `${outstanding.length} things still need a decision`}
            {" — "}
            {outstanding.slice(0, 3).map((f, i) => (
              <span key={f.id}>
                {i > 0 && ", "}
                <a href={`#${f.id}`} className="font-semibold text-teal hover:underline">
                  {TONE[f.kind].label.toLowerCase()}
                </a>
              </span>
            ))}
            {outstanding.length > 3 && ` and ${outstanding.length - 3} more`}
          </span>
        ) : (
          <span className="text-[14px] text-body">
            Every statement line is accounted for.
          </span>
        )}
      </div>
    </>
  );
}

function Heading({ title, blurb }: { title: string; blurb: string }) {
  return (
    <div className="mb-5">
      <h1 className="font-display text-[24px] font-bold text-ink">{title}</h1>
      <p className="mt-1 text-[15px] text-body">{blurb}</p>
    </div>
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
