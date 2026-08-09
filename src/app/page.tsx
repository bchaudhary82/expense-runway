"use client";

/**
 * The shell, plus everything the session knows.
 *
 * All of it lives HERE, in React state, and nowhere else. Not in a database, not
 * in localStorage, not on the server — the API routes hold files in memory for
 * the length of a request and drop them. Closing or refreshing the tab is a
 * genuine clean slate.
 *
 * The receipt readings from the reconcile step are carried forward to
 * generation, so the model runs once and the document can't reach a different
 * conclusion than the screen the user approved.
 */
import { useState } from "react";
import type { ParseResponse } from "@/app/api/parse-statement/route";
import type { ReconcileResponse } from "@/app/api/reconcile/route";
import type { Resolutions } from "@/lib/receipts/reconcile";
import { Stepper } from "@/components/Stepper";
import { TopBar } from "@/components/TopBar";
import { ReconcileStep } from "@/components/ReconcileStep";
import { DownloadStep } from "@/components/DownloadStep";
import { PurposesStep } from "@/components/PurposesStep";
import { UploadStep } from "@/components/steps";
import type { AmountOverride } from "@/lib/report/edits";
import type { Purposes } from "@/lib/report/reportFormat";

export default function Home() {
  const [step, setStep] = useState(0);
  const [parsed, setParsed] = useState<ParseResponse | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [reconciled, setReconciled] = useState<ReconcileResponse | null>(null);
  const [resolutions, setResolutions] = useState<Resolutions>({});
  const [purposes, setPurposes] = useState<Purposes>({});
  const [excluded, setExcluded] = useState<number[]>([]);
  const [overrides, setOverrides] = useState<Record<number, AmountOverride>>({});

  const rows = parsed?.rows ?? [];

  function reset() {
    setParsed(null);
    setFiles([]);
    setReconciled(null);
    setResolutions({});
    setPurposes({});
    setExcluded([]);
    setOverrides({});
  }

  return (
    <>
      <TopBar />
      <Stepper current={step} onSelect={setStep} />

      <main className="mx-auto w-full max-w-[1100px] flex-1 px-6 py-10">
        {step === 0 && (
          <UploadStep
            parsed={parsed}
            onParsed={setParsed}
            onFiles={setFiles}
            onReset={reset}
          />
        )}
        {step === 1 && (
          <ReconcileStep
            files={files}
            data={reconciled}
            onReconciled={setReconciled}
            resolutions={resolutions}
            onResolve={setResolutions}
            onContinue={() => setStep(2)}
          />
        )}
        {step === 2 && (
          <PurposesStep
            rows={rows}
            purposes={purposes}
            onPurposes={setPurposes}
            excluded={excluded}
            onExcluded={setExcluded}
            overrides={overrides}
            onOverrides={setOverrides}
            onContinue={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <DownloadStep
            rows={rows}
            files={files}
            reconciled={reconciled}
            resolutions={resolutions}
            purposes={purposes}
            excluded={excluded}
            overrides={overrides}
          />
        )}
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto max-w-[1100px] px-6 py-5 text-[13px] text-body">
          Expense Runway is a personal tool for preparing expense reports. It is
          not an official corporate system and is not affiliated with any
          employer or airline.
        </div>
      </footer>
    </>
  );
}
