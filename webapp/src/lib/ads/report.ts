import { toCsv } from "@/lib/csv";
import { agorotToShekels, formatAgorotPlain } from "@/lib/money";
import { formatDateHe } from "@/lib/dates";
import type { AdSpend } from "@/lib/types";

/**
 * One month of advertising, as the accountant needs to read it.
 *
 * A spend belongs to the month of the date on the form, not the day it was
 * typed in: a campaign that ran on 30 September is September's even when it is
 * entered on 6 October. spent_on is a plain date with no hour, so there is no
 * time zone that can drag the 1st of a month into the one before.
 *
 * Deliberately NOT the per-day share the profit screens use. A campaign that
 * covers two months is felt a day at a time when working out what a month
 * earned, but what the accountant is being sent is the expense as it was
 * incurred, in one line, on the date it carries. Two different questions, two
 * different answers, and mixing them would make the report disagree with the
 * screen it came from.
 */

export interface AdMonth {
  /** the first of the month, which is how the month is keyed everywhere */
  month: string;
  label: string;
  rows: AdSpend[];
  byChannel: { name: string; total: number }[];
  total: number;
}

/** The first of a month, from anything that names one. */
export function monthKey(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d + "T00:00:00") : d;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-01`;
}

/** The month a date falls in, in Hebrew, for a heading or a subject line. */
export function monthLabel(month: string): string {
  return new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(
    new Date(month + "T00:00:00")
  );
}

/** The last day of the month that starts on this date. */
export function monthEnd(month: string): string {
  const d = new Date(month + "T00:00:00");
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return monthKey(last).slice(0, 8) + String(last.getDate()).padStart(2, "0");
}

/** Group one month's rows the way the screen and the email both show them. */
export function buildAdMonth(
  month: string,
  rows: AdSpend[],
  channelName: (id: string | null) => string
): AdMonth {
  const byChannel = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const name = channelName(row.lead_source_id);
    byChannel.set(name, (byChannel.get(name) ?? 0) + row.amount_agorot);
    total += row.amount_agorot;
  }
  return {
    month,
    label: monthLabel(month),
    rows,
    byChannel: [...byChannel.entries()]
      .map(([name, t]) => ({ name, total: t }))
      .sort((a, b) => b.total - a.total),
    total,
  };
}

/** The spreadsheet, as a CSV that Excel opens with the Hebrew intact. */
export function adMonthCsv(report: AdMonth, channelName: (id: string | null) => string): string {
  // toCsv puts a UTF-8 BOM in front, which is the whole difference between
  // Excel showing "פרסום" and showing "×¤×¨×¡×•×"
  return toCsv(
    report.rows.map((r) => ({
      date: formatDateHe(r.spent_on),
      covers:
        r.covers_to && r.covers_to !== r.spent_on
          ? `${formatDateHe(r.spent_on)} — ${formatDateHe(r.covers_to)}`
          : "",
      channel: channelName(r.lead_source_id),
      amount: agorotToShekels(r.amount_agorot),
      notes: r.notes ?? "",
    })),
    [
      { key: "date", label: "תאריך" },
      { key: "covers", label: "תקופה" },
      { key: "channel", label: "ערוץ" },
      { key: "amount", label: "סכום (₪)" },
      { key: "notes", label: "הערה" },
    ]
  );
}

/** The message itself: the lines, the per-channel summary, and the total. */
export function buildAdMonthEmail(
  report: AdMonth,
  businessName: string | null,
  channelName: (id: string | null) => string,
  /** what paper came with the figures, so it is named before the signature */
  paperNote?: string
): { subject: string; body: string } {
  const who = businessName?.trim() || "העסק";
  const lines = report.rows.map((r) => {
    const period =
      r.covers_to && r.covers_to !== r.spent_on
        ? ` (${formatDateHe(r.spent_on)} — ${formatDateHe(r.covers_to)})`
        : "";
    const note = r.notes?.trim() ? ` · ${r.notes.trim()}` : "";
    return `${formatDateHe(r.spent_on)}${period} · ${channelName(r.lead_source_id)} · ${formatAgorotPlain(
      r.amount_agorot
    )}${note}`;
  });

  const summary = report.byChannel.map((c) => `${c.name}: ${formatAgorotPlain(c.total)}`);

  const body = [
    `שלום,`,
    ``,
    `להלן הוצאות הפרסום של ${who} לחודש ${report.label}.`,
    ``,
    report.rows.length ? `פירוט (${report.rows.length} רישומים):` : `לא נרשמו הוצאות פרסום בחודש הזה.`,
    ...lines,
    ...(report.rows.length ? [``, `סיכום לפי ערוץ:`, ...summary] : []),
    ``,
    `סך הכל: ${formatAgorotPlain(report.total)}`,
    ``,
    `מצורף גם קובץ CSV עם אותם נתונים, שנפתח באקסל.`,
    ...(paperNote?.trim() ? [paperNote.trim()] : []),
    ``,
    who,
  ].join("\n");

  return { subject: `הוצאות פרסום — ${report.label} — ${who}`, body };
}

/** The line that tells the accountant what paper came with the figures. */
export function adMonthPaperNote(attached: number, skipped: number): string {
  if (!attached && !skipped) return "";
  const lines: string[] = [];
  if (attached === 1) lines.push("מצורפת גם חשבונית אחת שצולמה.");
  else if (attached > 1) lines.push(`מצורפות גם ${attached} חשבוניות שצולמו.`);
  if (skipped === 1) lines.push("חשבונית אחת נוספת לא צורפה כדי לא לחרוג ממגבלת הגודל של המייל — אפשר לראות אותה במערכת.");
  else if (skipped > 1) lines.push(`${skipped} חשבוניות נוספות לא צורפו כדי לא לחרוג ממגבלת הגודל של המייל — אפשר לראות אותן במערכת.`);
  return lines.join(" ");
}
