"use client";

import { Input } from "@/components/ui/Input";
import type { PeriodKey } from "@/lib/dates";

const OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: "today", label: "היום" },
  { key: "week", label: "השבוע" },
  { key: "month", label: "החודש" },
  { key: "year", label: "השנה" },
  { key: "custom", label: "טווח מותאם" },
];

export function PeriodPicker({
  period,
  onChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
}: {
  period: PeriodKey;
  onChange: (p: PeriodKey) => void;
  customFrom?: string;
  customTo?: string;
  onCustomFromChange?: (v: string) => void;
  onCustomToChange?: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-xl border border-ink-200">
        {OPTIONS.map((opt) => (
          <button
            key={opt.key}
            onClick={() => onChange(opt.key)}
            className={`px-3.5 py-2 text-sm font-semibold transition ${
              period === opt.key ? "bg-brand-600 text-white" : "bg-white text-ink-600 hover:bg-ink-50"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {period === "custom" && (
        <div className="flex items-center gap-2">
          <Input type="date" value={customFrom} onChange={(e) => onCustomFromChange?.(e.target.value)} className="py-2" />
          <span className="text-ink-400">—</span>
          <Input type="date" value={customTo} onChange={(e) => onCustomToChange?.(e.target.value)} className="py-2" />
        </div>
      )}
    </div>
  );
}
