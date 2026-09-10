import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subDays,
} from "date-fns";

export type PeriodKey = "today" | "week" | "month" | "year" | "custom";

export interface DateRange {
  from: Date;
  to: Date;
}

export function getPeriodRange(period: PeriodKey, custom?: DateRange): DateRange {
  const now = new Date();
  switch (period) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "week":
      return { from: startOfWeek(now, { weekStartsOn: 0 }), to: endOfWeek(now, { weekStartsOn: 0 }) };
    case "month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "year":
      return { from: startOfYear(now), to: endOfYear(now) };
    case "custom":
      return custom ?? { from: startOfDay(now), to: endOfDay(now) };
  }
}

export function getPreviousPeriodRange(period: PeriodKey, range: DateRange): DateRange {
  const diffMs = range.to.getTime() - range.from.getTime();
  return {
    from: new Date(range.from.getTime() - diffMs - 1),
    to: new Date(range.from.getTime() - 1),
  };
}

export function isoRange(range: DateRange) {
  return { from: range.from.toISOString(), to: range.to.toISOString() };
}

export function formatDateHe(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatDateTimeHe(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatTimeHe(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return new Intl.DateTimeFormat("he-IL", { hour: "2-digit", minute: "2-digit" }).format(d);
}

export function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60);
}

export function relativeTimeHe(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "עכשיו";
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `לפני ${hours} שע׳`;
  const days = Math.floor(hours / 24);
  return `לפני ${days} ימים`;
}

export function last7Days(): Date {
  return subDays(new Date(), 7);
}

/** How long a job ran / has been running, in words: "3 שע׳ ו-20 דק׳" */
export function formatDurationHe(fromIso: string, toIso?: string | null): string {
  const from = new Date(fromIso).getTime();
  const to = toIso ? new Date(toIso).getTime() : Date.now();
  const mins = Math.max(0, Math.round((to - from) / 60000));
  if (mins < 60) return `${mins} דק׳`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 24) return rest ? `${hours} שע׳ ו-${rest} דק׳` : `${hours} שע׳`;
  const days = Math.floor(hours / 24);
  return `${days} ימים`;
}

/** Same shape, from a raw minute count (used for contractor averages) */
export function formatMinutesHe(mins: number | null | undefined): string {
  if (mins == null || isNaN(mins)) return "—";
  const rounded = Math.round(mins);
  if (rounded < 60) return `${rounded} דק׳`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (hours < 24) return rest ? `${hours} שע׳ ו-${rest} דק׳` : `${hours} שע׳`;
  return `${Math.floor(hours / 24)} ימים`;
}

export function customDateRange(fromStr: string, toStr: string): DateRange {
  return { from: startOfDay(new Date(fromStr)), to: endOfDay(new Date(toStr)) };
}

export { startOfDay, endOfDay };
