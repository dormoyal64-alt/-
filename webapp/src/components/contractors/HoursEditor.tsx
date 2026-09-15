"use client";

import { Clock, Copy } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { WEEKDAYS_HE, hhmm } from "@/lib/availability";

export interface DayHours {
  /** false = day off */
  on: boolean;
  from: string;
  to: string;
}

export const DEFAULT_WEEK: DayHours[] = WEEKDAYS_HE.map((_, d) => ({
  // Sunday–Thursday is the ordinary Israeli working week; Friday and Saturday
  // start off, and whoever works them turns them on.
  on: d <= 4,
  from: "08:00",
  to: "17:00",
}));

/** The rota as rows for the database; days that are off simply have no row. */
export function weekToRows(week: DayHours[]) {
  return week
    .map((d, weekday) => ({ ...d, weekday }))
    .filter((d) => d.on && d.from && d.to && d.from !== d.to)
    .map((d) => ({ weekday: d.weekday, starts_at: `${d.from}:00`, ends_at: `${d.to}:00` }));
}

/** And back again, for editing a contractor who already has hours. */
export function rowsToWeek(rows: { weekday: number; starts_at: string; ends_at: string }[]): DayHours[] {
  if (!rows.length) return DEFAULT_WEEK.map((d) => ({ ...d }));
  return WEEKDAYS_HE.map((_, d) => {
    const row = rows.find((r) => r.weekday === d);
    return row
      ? { on: true, from: hhmm(row.starts_at), to: hhmm(row.ends_at) }
      : { on: false, from: "08:00", to: "17:00" };
  });
}

export function HoursEditor({
  week,
  onChange,
  always,
  onAlwaysChange,
}: {
  week: DayHours[];
  onChange: (week: DayHours[]) => void;
  always: boolean;
  onAlwaysChange: (v: boolean) => void;
}) {
  function setDay(index: number, patch: Partial<DayHours>) {
    onChange(week.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }

  /** Copy the first working day onto every other day that is on. */
  function copyDown() {
    const source = week.find((d) => d.on);
    if (!source) return;
    onChange(week.map((d) => (d.on ? { ...d, from: source.from, to: source.to } : d)));
  }

  return (
    <div className="space-y-2.5">
      <button
        type="button"
        onClick={() => onAlwaysChange(!always)}
        className={`flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-3 text-right transition ${
          always ? "border-success-100 bg-success-50" : "border-ink-100 bg-white hover:bg-ink-50"
        }`}
      >
        <Clock className={`h-[18px] w-[18px] shrink-0 ${always ? "text-success-600" : "text-ink-400"}`} />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink-900">
            {always ? "זמין 24/7" : "זמין בשעות מסוימות"}
          </span>
          <span className="block text-xs text-ink-500">
            {always ? "המערכת תציע אותו בכל שעה" : "סמנו למטה את הימים והשעות"}
          </span>
        </span>
      </button>

      {!always && (
        <>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={copyDown}
              className="flex items-center gap-1.5 text-xs font-semibold text-brand-600 hover:underline"
            >
              <Copy className="h-3.5 w-3.5" />
              העתקת השעות של היום הראשון לכל הימים
            </button>
          </div>

          <div className="space-y-1.5">
            {week.map((d, i) => (
              <div
                key={i}
                className={`flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 ${
                  d.on ? "border-ink-100 bg-white" : "border-ink-100 bg-ink-50/60"
                }`}
              >
                <button
                  type="button"
                  onClick={() => setDay(i, { on: !d.on })}
                  className={`w-[72px] shrink-0 rounded-lg px-2 py-1.5 text-sm font-bold transition ${
                    d.on ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-400"
                  }`}
                >
                  {WEEKDAYS_HE[i]}
                </button>
                {d.on ? (
                  <div className="flex flex-1 items-center gap-2">
                    <Input
                      type="time"
                      value={d.from}
                      onChange={(e) => setDay(i, { from: e.target.value })}
                      className="w-auto flex-1 py-1.5"
                      dir="ltr"
                    />
                    <span className="text-ink-400">–</span>
                    <Input
                      type="time"
                      value={d.to}
                      onChange={(e) => setDay(i, { to: e.target.value })}
                      className="w-auto flex-1 py-1.5"
                      dir="ltr"
                    />
                  </div>
                ) : (
                  <span className="flex-1 text-sm text-ink-400">לא עובד</span>
                )}
              </div>
            ))}
          </div>

          <p className="text-xs text-ink-400">
            שעת סיום מוקדמת משעת ההתחלה נחשבת משמרת לילה שנמשכת אחרי חצות — למשל 22:00–06:00.
          </p>
        </>
      )}
    </div>
  );
}
