/**
 * Top bar — #152D32, white 600-weight text, 14–16px (DESIGN.md).
 *
 * The wordmark splits: "Expense" in white, "Runway" in teal. The teal is
 * --brand-teal-on-dark, not the primary --brand-teal: the primary only reaches 3:1
 * against this bar, which fails at this text size. Same hue, lifted to 5.1:1.
 *
 * Deliberately NOT a copy of the airline's header: own wordmark, no logo, no maple leaf,
 * no airline imagery, and no company name in the product name.
 */
export function TopBar() {
  return (
    <header className="bg-ink-deep">
      <div className="mx-auto flex h-14 max-w-[1100px] items-center justify-between px-6">
        <span className="font-display text-[16px] font-bold tracking-tight text-white">
          Expense <span className="font-normal text-teal-on-dark">Runway</span>
        </span>
        <span className="hidden text-[14px] font-semibold text-white/70 sm:block">
          File your month in five minutes.
        </span>
      </div>
    </header>
  );
}
