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

/** The category a tank fill is filed under; it reads as its own kind. */
export const FUEL_CATEGORY = "דלק";

export interface ExpenseLine {
  date: string;
  kind: string;
  description: string;
  amount_agorot: number;
}

/** A receipt a contractor handed over, as the month's report needs to read it. */
export interface ContractorReceiptLine {
  issued_on: string;
  contractor_name: string;
  reference: string | null;
  amount_agorot: number;
  job_number: string | null;
}

/** Everything that left the business in one month, in the order an accountant reads it. */
export function expenseLines(
  from: string,
  to: string,
  fixed: BusinessExpense[],
  categoryName: (id: string | null) => string,
  ads: AdSpend[],
  jobCosts: { closed_at: string; job_number: string; description: string; amount_agorot: number }[],
  contractorReceipts: ContractorReceiptLine[] = []
): ExpenseLine[] {
  const lines: ExpenseLine[] = [];

  for (const row of fixed) {
    const share = shareInRange(row, from, to);
    if (share > 0) {
      const category = categoryName(row.category_id);
      lines.push({
        date: row.spent_on > from ? row.spent_on : from,
        // a tank fill is a purchase on a day, not a standing monthly cost, and
        // an accountant sorting the month by kind wants it on its own
        kind: category === FUEL_CATEGORY ? FUEL_CATEGORY : "הוצאה קבועה",
        description: [category, row.notes].filter(Boolean).join(" — "),
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

  // Paid to a contractor and documented by their own receipt. The share is
  // already out of the business's profit; this is the line that lets the
  // accountant deduct it, which they cannot do on a figure with no paper.
  for (const row of contractorReceipts) {
    lines.push({
      date: row.issued_on,
      kind: "קבלה מקבלן",
      description: [row.contractor_name, row.reference ? `קבלה ${row.reference}` : null, row.job_number]
        .filter(Boolean)
        .join(" — "),
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
  return `mailto:${encodeURIComponent(address)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(trimForUrl(body))}`;
}

/**
 * Gmail's own compose window, already addressed and written.
 *
 * The message is composed in the business's own Gmail, in their browser, and
 * goes out from their address when they press send. Nothing here holds a
 * Google password or a token, and a month can be re-sent or edited before it
 * leaves — which is what a person wants from something going to their
 * accountant.
 */
export function gmailComposeLink(to: string | null | undefined, subject: string, body: string): string | null {
  const address = to?.trim();
  if (!address) return null;
  const params = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: address,
    su: subject,
    body: trimForUrl(body),
  });
  return `https://mail.google.com/mail/?${params.toString()}`;
}

/**
 * A body short enough to survive being carried in a link.
 *
 * Browsers and mail clients both give up somewhere past a few thousand
 * characters, and a busy month can pass that. Rather than let the end be cut
 * off silently — which would send an accountant a report that stops
 * mid-sentence — the detail is cut at a whole line and the message says how
 * many are missing and where to find them.
 */
export function trimForUrl(body: string, limit = 6000): string {
  if (body.length <= limit) return body;
  const lines = body.split("\n");
  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const line of lines) {
    if (used + line.length + 1 > limit - 160) {
      dropped += 1;
      continue;
    }
    kept.push(line);
    used += line.length + 1;
  }
  kept.push("", `— ועוד ${dropped} שורות. הפירוט המלא נמצא בקבצי ה-CSV המצורפים. —`);
  return kept.join("\n");
}
