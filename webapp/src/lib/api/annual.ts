import type { SupabaseClient } from "@supabase/supabase-js";
import { JOB_SELECT } from "@/lib/api/jobs";
import type { AnnualByMethod, AnnualByMonth, AnnualInstitutions, JobWithRelations } from "@/lib/types";

/**
 * The year against the exemption ceiling, and the money still out.
 *
 * All of it is counted in the database, by the same two functions the screen
 * and anything else that asks will use, so there is one answer to "how much
 * have I taken in this year" rather than one per screen.
 *
 * Every call survives a database that has not had the migration yet: the
 * screen shows an empty year and says so, rather than breaking.
 */

export const PAYMENT_TERMS = [
  { days: 0, label: "תשלום במקום" },
  { days: 30, label: "שוטף + 30" },
  { days: 60, label: "שוטף + 60" },
  { days: 90, label: "שוטף + 90" },
] as const;

export function termsLabel(days: number): string {
  return PAYMENT_TERMS.find((t) => t.days === days)?.label ?? `שוטף + ${days}`;
}

export async function fetchAnnualByMethod(
  supabase: SupabaseClient,
  year: number
): Promise<AnnualByMethod[] | null> {
  const { data, error } = await supabase.rpc("annual_income_by_method", { p_year: year });
  if (error) return null;
  return (data as AnnualByMethod[]) ?? [];
}

export async function fetchAnnualByMonth(
  supabase: SupabaseClient,
  year: number
): Promise<AnnualByMonth[] | null> {
  const { data, error } = await supabase.rpc("annual_income_by_month", { p_year: year });
  if (error) return null;
  return (data as AnnualByMonth[]) ?? [];
}

/**
 * What of the year came from institutions.
 *
 * Read beside the channels rather than among them: the same shekel arrives by
 * PayBox and comes from a school, and it belongs in the PayBox line once, with
 * this as "of which".
 */
export async function fetchAnnualInstitutions(
  supabase: SupabaseClient,
  year: number
): Promise<AnnualInstitutions | null> {
  const { data, error } = await supabase.rpc("annual_institution_totals", { p_year: year });
  if (error) return null;
  const row = Array.isArray(data) ? data[0] : data;
  return (row as AnnualInstitutions) ?? { received_agorot: 0, pending_agorot: 0, jobs: 0 };
}

/** Closed jobs on terms whose money has not landed, the oldest debt first. */
export async function fetchAwaitingPayment(
  supabase: SupabaseClient
): Promise<JobWithRelations[] | null> {
  const { data, error } = await supabase
    .from("jobs")
    .select(JOB_SELECT)
    .eq("is_closed", true)
    .is("paid_at", null)
    .gt("payment_terms_days", 0)
    .order("payment_due_on");
  if (error) return null;
  return (data as unknown as JobWithRelations[]) ?? [];
}

/** The money arrived. A day of null means today. */
export async function markJobPaid(supabase: SupabaseClient, jobId: string, paidOn: string | null) {
  const { error } = await supabase.rpc("mark_job_paid", { p_job_id: jobId, p_paid_on: paidOn });
  if (error) throw error;
}

export async function markJobUnpaid(supabase: SupabaseClient, jobId: string) {
  const { error } = await supabase.rpc("mark_job_unpaid", { p_job_id: jobId });
  if (error) throw error;
}

/** Days until payment is due; negative once it is late. */
export function daysUntil(due: string): number {
  const d = new Date(due + "T12:00:00");
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

/** How a waiting payment should read on screen. */
export function dueLabel(due: string | null): { text: string; late: boolean; soon: boolean } {
  if (!due) return { text: "ללא תאריך", late: false, soon: false };
  const days = daysUntil(due);
  if (days < 0) return { text: `באיחור של ${Math.abs(days)} ימים`, late: true, soon: false };
  if (days === 0) return { text: "אמור להיכנס היום", late: false, soon: true };
  if (days === 1) return { text: "אמור להיכנס מחר", late: false, soon: true };
  return { text: `עוד ${days} ימים`, late: false, soon: days <= 7 };
}
