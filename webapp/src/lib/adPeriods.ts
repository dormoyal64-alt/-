import { todayLocalDate } from "@/lib/dates";

export type SpendPeriod = "day" | "week" | "month" | "year" | "custom";

export const SPEND_PERIODS: { key: SpendPeriod; label: string }[] = [
  { key: "day", label: "יום" },
  { key: "week", label: "שבוע" },
  { key: "month", label: "חודש" },
  { key: "year", label: "שנה" },
  { key: "custom", label: "טווח" },
];

function iso(d: Date): string {
  return todayLocalDate(d);
}

/**
 * The days a spend covers, from the day it starts.
 *
 * A week is the seven days from that date, a month the calendar month it falls
 * in, a year the calendar year — so "₪3,000 for September" entered on any day
 * in September covers the whole of September, not thirty days from the 14th.
 */
export function periodRange(period: SpendPeriod, start: string, customEnd?: string): { from: string; to: string } {
  const d = new Date(start + "T00:00:00");
  switch (period) {
    case "day":
      return { from: start, to: start };
    case "week": {
      const end = new Date(d);
      end.setDate(end.getDate() + 6);
      return { from: start, to: iso(end) };
    }
    case "month": {
      const from = new Date(d.getFullYear(), d.getMonth(), 1);
      const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
      return { from: iso(from), to: iso(to) };
    }
    case "year": {
      return { from: iso(new Date(d.getFullYear(), 0, 1)), to: iso(new Date(d.getFullYear(), 11, 31)) };
    }
    case "custom":
      return { from: start, to: customEnd && customEnd >= start ? customEnd : start };
  }
}

export function daysInRange(from: string, to: string): number {
  const a = new Date(from + "T00:00:00").getTime();
  const b = new Date(to + "T00:00:00").getTime();
  return Math.max(Math.round((b - a) / 86_400_000) + 1, 1);
}

/** How a covered range should read on screen. */
export function describeRange(from: string, to: string): string {
  const fmt = (s: string) =>
    new Intl.DateTimeFormat("he-IL", { day: "2-digit", month: "2-digit", year: "numeric" }).format(
      new Date(s + "T00:00:00")
    );
  return from === to ? fmt(from) : `${fmt(from)} — ${fmt(to)}`;
}

/**
 * A yearly amount, split into the twelve months it is really felt in.
 *
 * Each row covers one calendar month, so a month's report shows exactly a
 * twelfth — not the 28/365 that spreading one row across the year would give
 * February. The remainder is handed out an agora at a time to the earliest
 * months, so the twelve add back to the figure that was typed.
 */
export function monthlyInstalments(
  totalAgorot: number,
  year: number
): { from: string; to: string; amount_agorot: number }[] {
  const base = Math.floor(totalAgorot / 12);
  let remainder = totalAgorot - base * 12;
  return Array.from({ length: 12 }, (_, month) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return {
      from: iso(new Date(year, month, 1)),
      to: iso(new Date(year, month + 1, 0)),
      amount_agorot: base + extra,
    };
  });
}
