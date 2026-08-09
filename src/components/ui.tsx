/**
 * Shared building blocks, matched to the measured values in DESIGN.md.
 *
 * Buttons: 4px radius, 600 weight, 14px, generous horizontal padding.
 * Cards:   white, 8px radius, no shadow, sitting on the #F7F7F7 canvas.
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Card({
  children,
  className = "",
  id,
}: {
  children: ReactNode;
  className?: string;
  /** Set so the blocking message can anchor-link straight to a flag. */
  id?: string;
}) {
  return (
    <div
      id={id}
      className={`bg-surface border border-line rounded-[8px] scroll-mt-6 ${className}`}
    >
      {children}
    </div>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary";
};

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-[4px] px-6 py-3 " +
    "text-[14px] font-semibold transition-colors " +
    "disabled:cursor-not-allowed";

  const looks =
    variant === "primary"
      ? "bg-teal text-white hover:bg-teal-hover disabled:bg-line disabled:text-body"
      : "bg-surface text-teal border border-teal hover:bg-canvas " +
        "disabled:border-line disabled:text-body";

  return <button className={`${base} ${looks} ${className}`} {...props} />;
}

/** The #F7F7F7 circle the site uses behind small icons. */
export function IconCircle({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-canvas">
      {children}
    </span>
  );
}

/** Status pill. Never colour alone — always an icon plus a text label. */
export function StatusTag({
  tone,
  icon,
  children,
}: {
  tone: "ok" | "warn" | "block";
  icon: string;
  children: ReactNode;
}) {
  const colour =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-block";

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[13px] font-semibold ${colour}`}
    >
      <span aria-hidden="true">{icon}</span>
      {children}
    </span>
  );
}
