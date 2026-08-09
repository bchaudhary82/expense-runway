"use client";

/**
 * Step 3 — Add purposes.
 *
 * DESIGN.md calls this the "guest details" step: the editable table, tabular
 * numerals, one purpose field per row, with "copy purpose down".
 *
 * Amounts are READ-ONLY by default. They come from the statement parser, which
 * is the thing that makes the numbers trustworthy, so changing one has to be a
 * deliberate act rather than an accident of clicking in the wrong cell. An
 * override is available per row, and every override is listed on the download
 * screen — a hand-typed amount is exactly the kind of thing that should be
 * visible before a report is filed.
 */
import { useState } from "react";
import type { StatementRow } from "@/lib/statement/parseStatement";
import type { Purposes } from "@/lib/report/reportFormat";
import type { AmountOverride } from "@/lib/report/edits";
import { EMPTY_PURPOSE } from "@/lib/report/reportFormat";
import { billedTotal, formatMoney } from "@/lib/statement/format";
import { Button, Card, StatusTag } from "./ui";

export function PurposesStep({
  rows,
  purposes,
  onPurposes,
  excluded,
  onExcluded,
  overrides,
  onOverrides,
  onContinue,
}: {
  rows: StatementRow[];
  purposes: Purposes;
  onPurposes: (next: Purposes) => void;
  excluded: number[];
  onExcluded: (next: number[]) => void;
  overrides: Record<number, AmountOverride>;
  onOverrides: (next: Record<number, AmountOverride>) => void;
  onContinue: () => void;
}) {
  const [editingAmount, setEditingAmount] = useState<number | null>(null);

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

  const gone = new Set(excluded);
  const kept = rows.filter((_, i) => !gone.has(i));
  const filled = rows.filter((_, i) => !gone.has(i) && purposes[i]?.trim()).length;

  /** Copy this row's purpose into every row below it that's still included. */
  function copyDown(fromIndex: number) {
    const value = purposes[fromIndex]?.trim();
    if (!value) return;
    const next = { ...purposes };
    for (let i = fromIndex + 1; i < rows.length; i++) {
      if (!gone.has(i)) next[i] = value;
    }
    onPurposes(next);
  }

  function toggleExcluded(i: number) {
    onExcluded(gone.has(i) ? excluded.filter((x) => x !== i) : [...excluded, i]);
  }

  function setOverride(i: number, field: keyof AmountOverride, value: string) {
    const next = { ...overrides, [i]: { ...overrides[i], [field]: value } };
    onOverrides(next);
  }

  function clearOverride(i: number) {
    const next = { ...overrides };
    delete next[i];
    onOverrides(next);
    setEditingAmount(null);
  }

  return (
    <>
      <div className="mb-5">
        <h1 className="font-display text-[24px] font-bold text-ink">
          Add a purpose to each line
        </h1>
        <p className="mt-1 text-[15px] text-body">
          One short business reason per expense. Anything left blank comes out as{" "}
          <span className="font-semibold">{EMPTY_PURPOSE}</span> for you to fill in
          later.
        </p>
      </div>

      <Card className="mb-4 p-6">
        <div className="grid gap-6 sm:grid-cols-3">
          <Stat value={String(kept.length)} label="expenses in the report" />
          <Stat value={formatMoney(billedTotal(kept))} label="total billed, CAD" />
          <div>
            <div className="mt-1.5">
              {filled === kept.length ? (
                <StatusTag tone="ok" icon="✓">
                  Every line has a purpose
                </StatusTag>
              ) : (
                <StatusTag tone="warn" icon="•">
                  {kept.length - filled} still blank
                </StatusTag>
              )}
            </div>
            <div className="mt-1 text-[14px] text-body">
              blank ones are fine — they come out as placeholders
            </div>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[14px]">
            <thead>
              <tr className="bg-canvas text-left text-[12px] font-semibold uppercase tracking-wide text-body">
                <th className="px-6 py-2.5 font-semibold">Date</th>
                <th className="px-3 py-2.5 text-right font-semibold">Expensed</th>
                <th className="px-3 py-2.5 text-right font-semibold">Billed</th>
                <th className="px-3 py-2.5 font-semibold">Vendor</th>
                <th className="px-3 py-2.5 font-semibold">Purpose</th>
                <th className="px-6 py-2.5 font-semibold">
                  <span className="sr-only">Row actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const isGone = gone.has(i);
                const override = overrides[i];
                const editing = editingAmount === i;
                return (
                  <tr
                    key={`${row.date}-${row.vendor}-${i}`}
                    className={`border-t border-line ${isGone ? "opacity-45" : ""}`}
                  >
                    <td className="px-6 py-3 whitespace-nowrap tabular-nums">
                      {row.date}
                    </td>

                    <td className="px-3 py-3 text-right tabular-nums">
                      {editing ? (
                        <input
                          value={override?.expenseAmount ?? row.expenseAmount}
                          onChange={(e) => setOverride(i, "expenseAmount", e.target.value)}
                          className="w-[90px] rounded-[4px] border border-warn bg-surface px-2 py-1 text-right tabular-nums"
                        />
                      ) : (
                        <span className={override?.expenseAmount ? "text-warn" : ""}>
                          {formatMoney(override?.expenseAmount ?? row.expenseAmount)}
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-3 text-right font-semibold tabular-nums text-ink">
                      {editing ? (
                        <input
                          value={override?.billedAmount ?? row.billedAmount}
                          onChange={(e) => setOverride(i, "billedAmount", e.target.value)}
                          className="w-[90px] rounded-[4px] border border-warn bg-surface px-2 py-1 text-right tabular-nums"
                        />
                      ) : (
                        <span className={override?.billedAmount ? "text-warn" : ""}>
                          {formatMoney(override?.billedAmount ?? row.billedAmount)}
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-3 font-semibold text-ink">{row.vendor}</td>

                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <input
                          disabled={isGone}
                          value={purposes[i] ?? ""}
                          onChange={(e) =>
                            onPurposes({ ...purposes, [i]: e.target.value })
                          }
                          placeholder={EMPTY_PURPOSE}
                          className="w-full min-w-[220px] rounded-[4px] border border-line bg-surface px-3 py-2 text-[14px] placeholder:text-body disabled:bg-canvas"
                        />
                        <button
                          type="button"
                          onClick={() => copyDown(i)}
                          disabled={isGone || !purposes[i]?.trim()}
                          title="Copy this purpose into every line below"
                          className="shrink-0 rounded-[4px] border border-line px-2 py-2 text-[13px] font-semibold text-teal disabled:text-body disabled:opacity-50"
                        >
                          ↓ copy down
                        </button>
                      </div>
                    </td>

                    <td className="px-6 py-3 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() =>
                          editing ? clearOverride(i) : setEditingAmount(i)
                        }
                        className="mr-3 text-[13px] font-semibold text-teal hover:underline"
                      >
                        {editing ? "cancel" : override ? "edit amount" : "override"}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleExcluded(i)}
                        className="text-[13px] font-semibold text-teal hover:underline"
                      >
                        {isGone ? "restore" : "delete"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {Object.keys(overrides).length > 0 && (
        <Card className="mt-4 border-l-4 border-l-warn p-6">
          <StatusTag tone="warn" icon="!">
            {Object.keys(overrides).length} amount
            {Object.keys(overrides).length === 1 ? "" : "s"} typed by hand
          </StatusTag>
          <p className="mt-2 text-[15px] text-ink">
            These no longer come from the statement, so the report won&rsquo;t balance
            to the statement total any more. They&rsquo;re listed again on the
            download screen.
          </p>
        </Card>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        <Button onClick={onContinue}>Continue</Button>
        <span className="text-[14px] text-body">
          {excluded.length > 0
            ? `${excluded.length} line${excluded.length === 1 ? "" : "s"} deleted — they won't appear in the report or the total.`
            : "Nothing deleted. Every statement line is in the report."}
        </span>
      </div>
    </>
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
