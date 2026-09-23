import { daysInRange } from "@/lib/adPeriods";
import { formatAgorotPlain } from "@/lib/money";
import { formatDateHe } from "@/lib/dates";
import type { AdSpend, BusinessExpense, Receipt } from "@/lib/types";

/** The first and last day of a month, as the dates the tables are keyed by. */
export function monthRange(year: number, month: number): { from: string; to: string; label: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const last = new Date(year, month + 1, 0).getDate();
  return {
    from: `${year}-${pad(month + 1)}-01`,
    to: `${year}-${pad(month + 1)}-${pad(last)}`,
    label: new Intl.DateTimeFormat("he-IL", { month: "long", year: "numeric" }).format(new Date(year, month, 1)),
  };
}

/**
 * The part of a spread expense that falls inside a month.
 *
 * A bill covering a range is felt a day at a time, so a month gets the days it
 * actually holds — the same arithmetic the reports use, so what the accountant
 * is sent and what the balance screen shows can never drift apart.
 */
export function shareInRange(
  row: { spent_on: string; covers_to: string | null; amount_agorot: number },
  from: string,
  to: string
): number {
  const end = row.covers_to ?? row.spent_on;
  if (row.spent_on > to || end < from) return 0;
  const overlapFrom = row.spent_on > from ? row.spent_on : from;
  const overlapTo = end < to ? end : to;
  const covered = daysInRange(row.spent_on, end);
  const inside = daysInRange(overlapFrom, overlapTo);
  return Math.round((row.amount_agorot / covered) * inside);
}

export interface ExpenseLine {
  date: string;
  kind: string;
  description: string;
  amount_agorot: number;
}

/** Everything that left the business in one month, in the order an accountant reads it. */
export function expenseLines(
  from: string,
  to: string,
  fixed: BusinessExpense[],
  categoryName: (id: string | null) => string,
  ads: AdSpend[],
  jobCosts: { closed_at: string; job_number: string; description: string; amount_agorot: number }[]
): ExpenseLine[] {
  const lines: ExpenseLine[] = [];

  for (const row of fixed) {
    const share = shareInRange(row, from, to);
    if (share > 0) {
      lines.push({
        date: row.spent_on > from ? row.spent_on : from,
        kind: "הוצאה קבועה",
        description: [categoryName(row.category_id), row.notes].filter(Boolean).join(" — "),
        amount_agorot: share,
      });
    }
  }

  for (const row of ads) {
    const share = shareInRange(row, from, to);
    if (share > 0) {
      lines.push({
        date: row.spent_on > from ? row.spent_on : from,
        kind: "פרסום",
        description: row.notes ?? "פרסום",
        amount_agorot: share,
      });
    }
  }

  for (const row of jobCosts) {
    lines.push({
      date: row.closed_at.slice(0, 10),
      kind: "הוצאה על עבודה",
      description: `${row.job_number} — ${row.description}`,
      amount_agorot: row.amount_agorot,
    });
  }

  return lines.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The month as an email an accountant can act on.
 *
 * Plain text rather than an attachment, because it has to survive a mail
 * client that was opened by a link: the figures are in the body, and the CSV
 * goes alongside for anyone who wants to sort it.
 */
export function buildAccountantEmail(
  label: string,
  businessName: string | null,
  receipts: Receipt[],
  expenses: ExpenseLine[]
): { subject: string; body: string } {
  const income = receipts.reduce((s, r) => s + r.amount_agorot, 0);
  const outgoing = expenses.reduce((s, e) => s + e.amount_agorot, 0);
  const who = businessName?.trim() ? ` — ${businessName.trim()}` : "";

  const lines = [
    `דוח חודשי${who}`,
    `תקופה: ${label}`,
    "",
    `הכנסות (${receipts.length} קבלות): ${formatAgorotPlain(income)}`,
    `הוצאות (${expenses.length} רישומים): ${formatAgorotPlain(outgoing)}`,
    "",
    "— קבלות —",
    ...receipts.map(
      (r) => `${formatDateHe(r.issued_at)} · קבלה ${r.receipt_number} · ${r.customer_name} · ${formatAgorotPlain(r.amount_agorot)}`
    ),
    "",
    "— הוצאות —",
    ...expenses.map((e) => `${formatDateHe(e.date)} · ${e.kind} · ${e.description} · ${formatAgorotPlain(e.amount_agorot)}`),
    "",
    "מצורפים גם קבצי CSV עם אותם נתונים.",
  ];

  return { subject: `דוח חודשי${who} — ${label}`, body: lines.join("\n") };
}

/** A mailto link, or null when there is nobody to send it to. */
export function mailtoLink(to: string | null | undefined, subject: string, body: string): string | null {
  const address = to?.trim();
  if (!address) return null;
  return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}
