import clsx from "clsx";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronLeft, type LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  changePct,
  tone = "brand",
  subtitle,
  href,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  changePct?: number | null;
  tone?: "brand" | "success" | "warning" | "danger";
  subtitle?: string;
  /** where the number came from — tapping the card opens it */
  href?: string;
}) {
  const toneClass = {
    brand: "bg-brand-50 text-brand-600",
    success: "bg-success-50 text-success-600",
    warning: "bg-warning-50 text-warning-600",
    danger: "bg-danger-50 text-danger-600",
  }[tone];

  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium leading-snug text-ink-500 sm:text-sm">{label}</p>
        {Icon && (
          <div className={clsx("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg sm:h-9 sm:w-9 sm:rounded-xl", toneClass)}>
            <Icon className="h-4 w-4 sm:h-[18px] sm:w-[18px]" />
          </div>
        )}
      </div>
      <p className="mt-1.5 text-xl font-extrabold tracking-tight text-ink-900 sm:mt-2 sm:text-2xl">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {subtitle && <span className="text-xs text-ink-400">{subtitle}</span>}
        {changePct !== undefined && changePct !== null && isFinite(changePct) && (
          <span
            className={clsx(
              "inline-flex items-center gap-0.5 text-xs font-bold",
              changePct >= 0 ? "text-success-600" : "text-danger-600"
            )}
          >
            {changePct >= 0 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            {Math.abs(changePct).toFixed(0)}%
          </span>
        )}
        {href && <ChevronLeft className="mr-auto h-4 w-4 text-ink-300" aria-hidden />}
      </div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="card block p-3 text-right transition hover:border-brand-200 hover:shadow-card-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 sm:p-5"
      >
        {body}
      </Link>
    );
  }

  return <div className="card p-3 sm:p-5">{body}</div>;
}
