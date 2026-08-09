"use client";

/**
 * The four-step stepper, mirroring the airline's booking flow
 * (Search → Select → Extras → Payment → Confirmation).
 *
 * Teal  = done
 * Ink   = current
 * Grey  = upcoming
 *
 * Status is never signalled by colour alone: every step carries its number,
 * a title and a sub-label, and the current one is marked aria-current.
 */

export const STEPS = [
  { title: "Upload", sub: ["receipts +", "statement"] },
  { title: "Reconcile", sub: ["match receipts", "to statement"] },
  { title: "Add purposes", sub: ["one line", "each"] },
  { title: "Download", sub: ["your", "report"] },
] as const;

export function Stepper({
  current,
  onSelect,
}: {
  current: number;
  onSelect: (index: number) => void;
}) {
  return (
    <nav aria-label="Progress" className="bg-surface border-b border-line">
      {/* Desktop-first. On a narrow screen the stepper scrolls sideways on its
          own rather than pushing the whole page out of the viewport. */}
      <ol className="mx-auto flex max-w-[1100px] items-start gap-2 overflow-x-auto px-6 py-5 md:overflow-x-visible">
        {STEPS.map((step, i) => {
          const state = i < current ? "done" : i === current ? "current" : "upcoming";

          const circle =
            state === "done"
              ? "bg-teal text-white"
              : state === "current"
                ? "bg-ink text-white"
                : "bg-canvas text-body border border-line";

          const title =
            state === "upcoming"
              ? "text-body"
              : state === "done"
                ? "text-teal"
                : "text-ink";

          return (
            <li
              key={step.title}
              className="flex shrink-0 items-start gap-2 md:flex-1 md:shrink"
            >
              <button
                type="button"
                onClick={() => onSelect(i)}
                aria-current={state === "current" ? "step" : undefined}
                className="flex items-start gap-3 whitespace-nowrap rounded-[4px] text-left"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold ${circle}`}
                >
                  {state === "done" ? "✓" : i + 1}
                </span>
                <span className="leading-tight">
                  <span
                    className={`block font-display text-[15px] font-semibold ${title}`}
                  >
                    {step.title}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-body">
                    {step.sub[0]}
                    <br />
                    {step.sub[1]}
                  </span>
                </span>
              </button>

              {/* connector rule between steps */}
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden="true"
                  className={`mt-4 hidden h-px flex-1 md:block ${
                    i < current ? "bg-teal" : "bg-line"
                  }`}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
