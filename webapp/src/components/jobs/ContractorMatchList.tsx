"use client";

import { CheckCircle2, Star, Briefcase, TrendingUp, MapPin, Clock, MoonStar } from "lucide-react";
import { formatPercent } from "@/lib/money";
import { MATCH_TIER_HINT, MATCH_TIER_LABEL, type MatchedContractor, type MatchTier } from "@/hooks/useContractorMatch";
import { EmptyState } from "@/components/ui/Misc";

const TIER_STYLE: Record<MatchTier, string> = {
  exact: "bg-success-50 text-success-700",
  city: "bg-brand-50 text-brand-700",
  region: "bg-warning-50 text-warning-600",
  profession: "bg-ink-100 text-ink-500",
  other: "bg-danger-50 text-danger-600",
};

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
        title="אין קבלנים בתחום הזה"
        description="עדיין לא רשום אף קבלן לתחום שנבחר. אפשר להמשיך בלי קבלן ולשייך מאוחר יותר, או להוסיף קבלן במסך ״קבלנים״."
      />
    );
  }

  // The best fit is first, but every contractor in the trade is on the list —
  // the badge says how close each one is so the choice stays yours.
  const exactCount = matches.filter((m) => m.tier === "exact").length;
  const availableNow = matches.filter((m) => m.availability === "open").length;

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-500">
        {matches.filter((m) => m.tier !== "other").length} קבלנים בתחום — ממוינים לפי זמינות והתאמה
        {availableNow > 0 ? `, ${availableNow} זמינים עכשיו` : ""}
        {exactCount > 0 ? `, ${exactCount} בהתאמה מלאה` : ""}
      </p>
      {matches.map((c, i) => {
        const selected = c.id === selectedId;
        return (
          <button
            type="button"
            key={c.id}
            onClick={() => onSelect(c.id)}
            title={MATCH_TIER_HINT[c.tier]}
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
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-bold text-ink-900">{c.name}</p>
                <span className={`badge ${TIER_STYLE[c.tier]}`}>{MATCH_TIER_LABEL[c.tier]}</span>
                {c.availability === "open" && <span className="badge bg-success-50 text-success-700">זמין עכשיו</span>}
                {c.availability === "closed" && <span className="badge bg-ink-100 text-ink-500">מחוץ לשעות</span>}
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
              {(c.availability !== "unknown" || c.hoursLabel !== "לא הוגדרו שעות") && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-400">
                  {c.hoursLabel === "זמין 24/7" ? <MoonStar className="h-3 w-3 shrink-0" /> : <Clock className="h-3 w-3 shrink-0" />}
                  {c.hoursLabel}
                  {c.availability === "closed" && c.opensAt ? ` · נפתח ${c.opensAt}` : ""}
                </p>
              )}
              {c.tier === "region" && c.nearbyCities.length > 0 && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-400">
                  <MapPin className="h-3 w-3 shrink-0" />
                  עובד ב{c.nearbyCities.join(", ")}
                </p>
              )}
            </div>
            {selected && <CheckCircle2 className="h-5 w-5 shrink-0 text-brand-600" />}
          </button>
        );
      })}
    </div>
  );
}
