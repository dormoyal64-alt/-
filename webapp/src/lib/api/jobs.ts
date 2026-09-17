import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobWithRelations, PaymentReceivedBy, PerformedBy, Receipt } from "@/lib/types";

export const JOB_SELECT = `*,
  profession:professions(id,name,technician_label),
  job_type:job_types(id,name),
  city:cities!jobs_city_id_fkey(id,name),
  contractor:contractors(id,name,phone,whatsapp),
  helper:helpers(id,name,phone),
  referral_company:referral_companies(id,name,phone),
  origin_city:cities!jobs_origin_city_id_fkey(id,name),
  payment_method:payment_methods!jobs_payment_method_id_fkey(id,name),
  final_payment_method:payment_methods!jobs_final_payment_method_id_fkey(id,name),
  lead_source:lead_sources(id,name),
  status:job_statuses(id,name,color,is_success,is_terminal)`;

export interface CreateJobInput {
  profession_id: string;
  job_type_id: string;
  city_id: string;
  customer_name: string;
  customer_phone: string;
  /** null follows the standing setting */
  send_customer_phone?: boolean | null;
  /** false opens the job without messaging the contractor */
  notify_contractor?: boolean;
  address_full?: string | null;
  address_street?: string | null;
  address_house_number?: string | null;
  address_city?: string | null;
  lat?: number | null;
  lng?: number | null;
  quoted_price_agorot?: number | null;
  payment_method_id?: string | null;
  referral_company_id?: string | null;
  referral_pct?: number | null;
  performed_by?: PerformedBy;
  contractor_id?: string | null;
  commission_pct?: number | null;
  origin_city_id?: string | null;
  travel_km?: number | null;
  helper_id?: string | null;
  helper_pay_agorot?: number | null;
  lead_source_id?: string | null;
  notes?: string | null;
  status_id: string;
  opened_at: string;
  /** when the customer wants it done; null means as soon as possible */
  scheduled_at?: string | null;
}

export async function createJob(supabase: SupabaseClient, input: CreateJobInput) {
  const { data, error } = await supabase.from("jobs").insert(input).select(JOB_SELECT).single();
  if (error) throw error;
  return data as unknown as JobWithRelations;
}

export async function fetchJob(supabase: SupabaseClient, id: string) {
  const { data, error } = await supabase.from("jobs").select(JOB_SELECT).eq("id", id).single();
  if (error) throw error;
  return data as unknown as JobWithRelations;
}

export async function changeJobStatus(supabase: SupabaseClient, jobId: string, statusId: string, note?: string) {
  const { error } = await supabase.rpc("change_job_status", { p_job_id: jobId, p_status_id: statusId, p_note: note ?? null });
  if (error) throw error;
}

export interface CloseJobInput {
  closedSuccessfully: boolean;
  finalPriceAgorot: number;
  finalPaymentMethodId: string | null;
  paymentReceivedBy: PaymentReceivedBy;
  closingNotes: string | null;
  closedAt: string;
  /** split for this job only; omit to use the percentage stored on the job */
  commissionPct?: number | null;
  referralPct?: number | null;
  /** a receipt was given, so the job is declared and carries tax */
  withReceipt?: boolean;
}

export async function closeJob(supabase: SupabaseClient, jobId: string, input: CloseJobInput) {
  const { error } = await supabase.rpc("close_job", {
    p_job_id: jobId,
    p_closed_successfully: input.closedSuccessfully,
    p_final_price_agorot: input.finalPriceAgorot,
    p_final_payment_method_id: input.finalPaymentMethodId,
    p_payment_received_by: input.paymentReceivedBy,
    p_closing_notes: input.closingNotes,
    p_closed_at: input.closedAt,
    p_commission_pct: input.commissionPct ?? null,
    p_referral_pct: input.referralPct ?? null,
    p_with_receipt: input.withReceipt ?? false,
  });
  if (error) throw error;
}

export async function reopenJob(supabase: SupabaseClient, jobId: string, statusId: string) {
  const { error } = await supabase.rpc("reopen_job", { p_job_id: jobId, p_status_id: statusId });
  if (error) throw error;
}

export async function duplicateJob(supabase: SupabaseClient, job: JobWithRelations, newStatusId: string) {
  const input: CreateJobInput = {
    profession_id: job.profession_id!,
    job_type_id: job.job_type_id!,
    city_id: job.city_id!,
    customer_name: job.customer_name,
    customer_phone: job.customer_phone,
    send_customer_phone: job.send_customer_phone,
    notify_contractor: job.notify_contractor,
    address_full: job.address_full,
    address_street: job.address_street,
    address_house_number: job.address_house_number,
    address_city: job.address_city,
    lat: job.lat,
    lng: job.lng,
    quoted_price_agorot: job.quoted_price_agorot,
    payment_method_id: job.payment_method_id,
    contractor_id: job.contractor_id,
    commission_pct: job.commission_pct,
    lead_source_id: job.lead_source_id,
    notes: job.notes,
    status_id: newStatusId,
    opened_at: new Date().toISOString(),
  };
  return createJob(supabase, input);
}

/**
 * Why a job can't be deleted, or null when it can. Deleting a job that has
 * already been reckoned up with someone would leave that settlement's totals
 * describing jobs that no longer exist, so those two cases are refused
 * outright — everything else is fair game, including closed jobs.
 */
export function deleteJobBlockedReason(job: JobWithRelations): string | null {
  if (job.settlement_id) {
    return "העבודה כבר נכללה בהתחשבנות עם הקבלן. כדי למחוק אותה, בטלו קודם את ההתחשבנות.";
  }
  if (job.referral_settled_at) {
    return "העבודה כבר נכללה בהתחשבנות עם החברה המפנה, ולכן לא ניתן למחוק אותה.";
  }
  return null;
}

/**
 * Removes the job for good. job_status_history and notifications are wiped
 * along with it by their `on delete cascade`, so nothing is orphaned.
 */
export async function deleteJob(supabase: SupabaseClient, job: JobWithRelations) {
  const blocked = deleteJobBlockedReason(job);
  if (blocked) throw new Error(blocked);

  const { error } = await supabase.from("jobs").delete().eq("id", job.id);
  if (error) throw error;
}

/**
 * Issues the receipt for a job, or returns the one it already has.
 * Numbering and the snapshot of business details are done in the database, so
 * two people closing jobs at once cannot land on the same number.
 */
export async function issueReceipt(supabase: SupabaseClient, jobId: string) {
  const { data, error } = await supabase.rpc("issue_receipt", { p_job_id: jobId });
  if (error) throw error;
  // the function returns a single row; PostgREST may hand it back either way
  return (Array.isArray(data) ? data[0] : data) as Receipt;
}

export async function fetchReceipt(supabase: SupabaseClient, jobId: string) {
  const { data } = await supabase
    .from("receipts")
    .select("*")
    .eq("job_id", jobId)
    .order("issued_at")
    .limit(1)
    .maybeSingle();
  return (data as Receipt) ?? null;
}
