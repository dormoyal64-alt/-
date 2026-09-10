import clsx from "clsx";
import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  changePct,
  tone = "brand",
  subtitle,
}: {
  label: string;
  value: string;
  icon?: LucideIcon;
  changePct?: number | null;
  tone?: "brand" | "success" | "warning" | "danger";
  subtitle?: string;
}) {
  const toneClass = {
    brand: "bg-brand-50 text-brand-600",
    success: "bg-success-50 text-success-600",
    warning: "bg-warning-50 text-warning-600",
    danger: "bg-danger-50 text-danger-600",
  }[tone];

  return (
    <div className="card p-4 sm:p-5">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-ink-500">{label}</p>
        {Icon && (
          <div className={clsx("flex h-9 w-9 items-center justify-center rounded-xl", toneClass)}>
            <Icon className="h-[18px] w-[18px]" />
          </div>
        )}
      </div>
      <p className="mt-2 text-2xl font-extrabold tracking-tight text-ink-900">{value}</p>
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
      </div>
    </div>
  );
}
