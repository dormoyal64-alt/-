import type { SupabaseClient } from "@supabase/supabase-js";
import { JOB_SELECT } from "@/lib/api/jobs";
import type { JobWithRelations, Receipt } from "@/lib/types";

/**
 * The month as it will reach the accountant, and what is wrong with it.
 *
 * Sending the report is the last moment anything can be put right cheaply. An
 * hour later the figures are in somebody else's spreadsheet, and a job that
 * closed for 1,500 ₪ with no receipt behind it is no longer a thing to fix —
 * it is a correction, a second email, and a question about why the business's
 * own books disagree with its reports.
 *
 * So this assembles the month twice over. Once from the receipts, which is
 * what the accountant will be told. Once from the jobs, which is what actually
 * happened. Where the two disagree is the report's problem, and that is the
 * only thing worth putting on screen before the send button.
 *
 * All of it is read with ordinary queries rather than a database function, so
 * it works the moment it deploys — nothing here needs a migration run first.
 */

export interface MonthRow {
  receipt: Receipt;
  /** the job the receipt was issued for; null if it has been deleted since */
  job: JobWithRelations | null;
}

export interface MonthCheck {
  /** every receipt of the month, cancelled ones included, in number order */
  rows: MonthRow[];
  /** closed, priced, successful work of this month that no live receipt covers */
  missing: JobWithRelations[];
  /** of those, the ones that had a receipt and it was cancelled — the usual reason */
  cancelledJobIds: Set<string>;
  /** closed on terms with the money not in yet — no receipt is correct here */
  awaiting: JobWithRelations[];
  /** receipts cancelled in this month: a number spent, no money behind it */
  cancelled: Receipt[];
  /** numbers absent from the sequence between the month's first and last */
  gaps: string[];
  /** true once anything needs looking at */
  hasProblems: boolean;
}

/** The numeric part of a receipt number, or null if it is not a plain number. */
function numberOf(r: Receipt): number | null {
  const n = Number(r.receipt_number);
  return Number.isInteger(n) ? n : null;
}

/**
 * Whether this job's money belongs to the month being checked.
 *
 * The same rule the receipt itself follows: a job on terms is counted on the
 * day the money landed, everything else on the day it closed. Reading it any
 * other way would have the check disagree with the document it is checking.
 */
function inMonth(job: JobWithRelations, fromIso: string, toIso: string): boolean {
  const when = job.paid_at ?? job.closed_at;
  return !!when && when >= fromIso && when <= toIso;
}

export async function fetchMonthCheck(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string
): Promise<MonthCheck> {
  // Receipts first, cancelled ones included — a cancelled receipt is exactly
  // the kind of thing worth seeing before the accountant asks about the hole
  // it left in the numbering.
  const withCancelled = await supabase
    .from("receipts")
    .select("*")
    .gte("issued_at", fromIso)
    .lte("issued_at", toIso);
  const receipts =
    (withCancelled.error
      ? ((
          await supabase.from("receipts").select("*").gte("issued_at", fromIso).lte("issued_at", toIso)
        ).data as Receipt[])
      : (withCancelled.data as Receipt[])) ?? [];

  // Jobs whose money is this month's. Two queries rather than one because the
  // rule is "paid_at, or closed_at where there is no paid_at", and that is a
  // coalesce — which is not something a URL filter can say.
  const closedInMonth = supabase
    .from("jobs")
    .select(JOB_SELECT)
    .eq("is_closed", true)
    .gte("closed_at", fromIso)
    .lte("closed_at", toIso);
  const paidInMonth = supabase
    .from("jobs")
    .select(JOB_SELECT)
    .eq("is_closed", true)
    .gte("paid_at", fromIso)
    .lte("paid_at", toIso);

  const [closedRes, paidRes] = await Promise.all([closedInMonth, paidInMonth]);
  // paid_at arrived with a migration; a database without it still checks the
  // half of the month it can see rather than showing nothing
  const byId = new Map<string, JobWithRelations>();
  for (const list of [closedRes.data, paidRes.error ? [] : paidRes.data]) {
    for (const j of ((list as unknown as JobWithRelations[]) ?? [])) byId.set(j.id, j);
  }
  const jobs = [...byId.values()].filter((j) => inMonth(j, fromIso, toIso));

  // the receipts, each with the job behind it
  const jobOf = (id: string) => byId.get(id) ?? null;
  const rows: MonthRow[] = receipts
    .map((receipt) => ({ receipt, job: jobOf(receipt.job_id) }))
    .sort((a, b) => {
      const na = numberOf(a.receipt);
      const nb = numberOf(b.receipt);
      if (na != null && nb != null) return na - nb;
      return a.receipt.receipt_number.localeCompare(b.receipt.receipt_number);
    });

  const live = receipts.filter((r) => !r.cancelled_at);
  const covered = new Set(live.map((r) => r.job_id));

  // Work that earned money this month and has no receipt behind it. A job
  // still waiting on its terms is not one of these — it has no receipt
  // because it has not been paid, which is correct and is listed separately.
  const earning = jobs.filter(
    (j) => j.status?.is_success && (j.final_price_agorot ?? 0) > 0
  );
  const awaiting = earning.filter((j) => (j.payment_terms_days ?? 0) > 0 && !j.paid_at);
  const awaitingIds = new Set(awaiting.map((j) => j.id));
  const missing = earning.filter((j) => !covered.has(j.id) && !awaitingIds.has(j.id));

  const cancelled = receipts.filter((r) => !!r.cancelled_at);
  // a job appearing under "no receipt" because its receipt was cancelled is
  // not a second problem — it is the reason for the first, and saying so on
  // the row is what stops the same job being read as two
  const cancelledJobIds = new Set(cancelled.map((r) => r.job_id));

  // Holes in the numbering. Only within this month's own span — a gap at the
  // month boundary belongs to the month that spent the number, not this one.
  const numbers = receipts.map(numberOf).filter((n): n is number => n != null);
  const gaps: string[] = [];
  if (numbers.length > 1) {
    const present = new Set(numbers);
    const width = receipts.find((r) => numberOf(r) != null)!.receipt_number.length;
    for (let n = Math.min(...numbers); n <= Math.max(...numbers); n++) {
      if (!present.has(n)) gaps.push(String(n).padStart(width, "0"));
    }
  }

  return {
    rows,
    missing,
    cancelledJobIds,
    awaiting,
    cancelled,
    gaps,
    hasProblems: missing.length > 0 || cancelled.length > 0 || gaps.length > 0,
  };
}

/** What the work was, for a line the accountant may ask about. */
export function describeJob(job: JobWithRelations | null): string | null {
  if (!job) return null;
  return (
    [job.profession?.name, job.job_type?.name].filter(Boolean).join(" — ") || null
  );
}
