"use client";

import { CheckCircle2, Star, Briefcase, TrendingUp } from "lucide-react";
import { formatPercent } from "@/lib/money";
import type { MatchedContractor } from "@/hooks/useContractorMatch";
import { EmptyState } from "@/components/ui/Misc";

export function ContractorMatchList({
  matches,
  selectedId,
  onSelect,
}: {
  matches: MatchedContractor[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (matches.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="אין קבלנים מתאימים"
        description="אין קבלן פעיל המשויך לתחום, סוג העבודה והעיר שנבחרו. ניתן להמשיך בלי קבלן ולשייך מאוחר יותר, או לעדכן שיוכי קבלנים."
      />
    );
  }

  return (
    <div className="space-y-2">
      {matches.map((c, i) => {
        const selected = c.id === selectedId;
        return (
          <button
            type="button"
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`flex w-full items-center gap-3 rounded-2xl border p-3.5 text-right transition ${
              selected ? "border-brand-600 bg-brand-50/60 ring-2 ring-brand-500/20" : "border-ink-100 bg-white hover:bg-ink-50"
            } ${!c.active ? "opacity-50" : ""}`}
          >
            <div
              className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                selected ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600"
              }`}
            >
              {i === 0 && c.closeRate > 0 ? <Star className="h-5 w-5" /> : c.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate font-bold text-ink-900">{c.name}</p>
                {!c.active && <span className="badge bg-ink-100 text-ink-500">לא פעיל</span>}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-500">
                <span className="flex items-center gap-1 font-semibold text-success-600">
                  <TrendingUp className="h-3.5 w-3.5" />
                  {formatPercent(c.closeRate)} סגירה
                </span>
                <span>{c.jobsClosedSuccess} סגורות</span>
                <span>{c.openJobsCount} פתוחות כרגע</span>
                <span>{formatPercent(c.commissionPct)} עמלה</span>
              </div>
            </div>
            {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-600" />}
          </button>
        );
      })}
    </div>
  );
}
