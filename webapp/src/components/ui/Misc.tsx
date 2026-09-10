import { Loader2, type LucideIcon } from "lucide-react";

export function Spinner({ className = "h-6 w-6" }: { className?: string }) {
  return <Loader2 className={`animate-spin text-brand-500 ${className}`} />;
}

export function PageSpinner() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      {Icon && (
        <div className="mb-1 flex h-14 w-14 items-center justify-center rounded-2xl bg-ink-100 text-ink-400">
          <Icon className="h-7 w-7" />
        </div>
      )}
      <p className="font-bold text-ink-700">{title}</p>
      {description && <p className="max-w-xs text-sm text-ink-400">{description}</p>}
      {action}
    </div>
  );
}
