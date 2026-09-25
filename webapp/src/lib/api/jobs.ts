import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobWithRelations, PaymentReceivedBy, PerformedBy, Receipt } from "@/lib/types";

export const JOB_SELECT = `*,
  profession:professions(id,name,technician_label,visit_fee_agorot),
  job_type:job_types(id,name,visit_fee_agorot),
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
  /**
   * Whether this closing is answering for the worker at all.
   *
   * Left out, the job keeps whatever worker and wage it already carried — a
   * closing that says nothing about a worker must not erase one.
   */
  setHelper?: boolean;
  helperId?: string | null;
  helperPayAgorot?: number | null;
}

export async function closeJob(supabase: SupabaseClient, jobId: string, input: CloseJobInput) {
  const base = {
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
  };

  const { error } = await supabase.rpc("close_job", {
    ...base,
    p_set_helper: input.setHelper ?? false,
    p_helper_id: input.helperId ?? null,
    p_helper_pay_agorot: input.helperPayAgorot ?? null,
  });
  if (!error) return;

  // The worker's wage was added to this function's arguments, and a browser
  // updates the moment it is deployed while a database waits to be told. In
  // between, the new call describes a function the old database does not have
  // — and closing a job is the one thing that must not depend on that gap.
  //
  // So the old shape is tried, and the wage written straight onto the row
  // afterwards. Nothing is lost: the same two columns end up holding the same
  // two values, by the door that is open.
  if (!isMissingFunction(error)) throw error;

  const { error: legacyError } = await supabase.rpc("close_job", base);
  if (legacyError) throw legacyError;

  if (input.setHelper) {
    const { error: helperError } = await supabase
      .from("jobs")
      .update({ helper_id: input.helperId ?? null, helper_pay_agorot: input.helperPayAgorot ?? 0 })
      .eq("id", jobId);
    // the job is closed either way; a wage that did not save is worth saying
    if (helperError) throw helperError;
  }
}

/**
 * Moves a job to a different contractor, or to you.
 *
 * On a closed job this also redoes the split from the price already frozen on
 * it, which a plain row update cannot do — that is why this is not part of the
 * ordinary edit save.
 */
export async function reassignJob(
  supabase: SupabaseClient,
  jobId: string,
  input: { performedBy: PerformedBy; contractorId: string | null; commissionPct: number | null }
) {
  const { error } = await supabase.rpc("reassign_job", {
    p_job_id: jobId,
    p_performed_by: input.performedBy,
    p_contractor_id: input.contractorId,
    p_commission_pct: input.commissionPct,
  });
  if (!error) return;
  // PostgREST keeps its own list of what the database can do, and it can sit
  // stale for a long while after the function is really there — long enough
  // that "change the contractor" stops working with nothing wrong underneath.
  // When that is what happened, do the same arithmetic here instead.
  if (!isMissingFunction(error)) throw error;
  await reassignJobDirect(supabase, jobId, input);
}

function isMissingFunction(error: unknown): boolean {
  const message = error && typeof error === "object" && "message" in error
    ? String((error as { message?: unknown }).message ?? "")
    : "";
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code ?? "")
    : "";
  return code === "PGRST202" || /could not find the function|schema cache/i.test(message);
}

/**
 * What reassign_job does, done from here.
 *
 * Only for the case above. It mirrors the function line for line — the split
 * comes off the price already frozen on the job, the referral company's cut is
 * left alone, and a job already reckoned up is refused — so the two can never
 * disagree about what a job is worth.
 */
async function reassignJobDirect(
  supabase: SupabaseClient,
  jobId: string,
  input: { performedBy: PerformedBy; contractorId: string | null; commissionPct: number | null }
) {
  const { data: job, error: readError } = await supabase
    .from("jobs")
    .select("is_closed, settlement_id, final_price_agorot, referral_fee_agorot, referral_pct, travel_km")
    .eq("id", jobId)
    .single();
  if (readError) throw readError;

  // Pulling a job out of a settlement means recomputing that settlement's
  // totals, which belongs in one place — the database. This path only exists
  // for when the API cannot reach it, so here it says so rather than leaving a
  // settlement describing a job it no longer holds.
  if (job.settlement_id) {
    throw new Error(
      "העבודה נכללה בהתחשבנות, והחלפת הקבלן צריכה לעדכן גם אותה. רעננו את הדף ונסו שוב; אם זה חוזר, יש להריץ ב-Supabase את הקוד האחרון שנשלח."
    );
  }

  let pct: number | null;
  if (input.performedBy === "self") {
    pct = 0;
  } else if (!input.contractorId) {
    pct = null;
  } else {
    pct = input.commissionPct;
    if (pct == null) {
      const { data: contractor } = await supabase
        .from("contractors")
        .select("default_commission_pct")
        .eq("id", input.contractorId)
        .single();
      pct = contractor?.default_commission_pct ?? 0;
    }
    if (pct == null || pct < 0 || pct > 100) throw new Error("אחוז הקבלן חייב להיות בין 0 ל-100");
    if (pct + (job.referral_pct ?? 0) > 100) {
      throw new Error("אחוז הקבלן ואחוז החברה יחד עולים על 100%");
    }
  }

  const patch: Record<string, unknown> = {
    performed_by: input.performedBy,
    contractor_id: input.performedBy === "self" ? null : input.contractorId,
    commission_pct: pct,
  };

  if (job.is_closed) {
    const price = job.final_price_agorot ?? 0;
    const contractorShare = Math.round((price * (pct ?? 0)) / 100);
    patch.contractor_share_agorot = contractorShare;
    patch.business_share_agorot = price - contractorShare - (job.referral_fee_agorot ?? 0);
    patch.fuel_cost_agorot =
      input.performedBy === "self" ? await fuelCostForKm(supabase, job.travel_km) : 0;
  }

  const { error } = await supabase.from("jobs").update(patch).eq("id", jobId);
  if (error) throw error;
}

/** Mirrors fuel_cost_for_km: the trip, at the fuel price the settings carry. */
async function fuelCostForKm(supabase: SupabaseClient, km: number | null): Promise<number> {
  if (!km || km <= 0) return 0;
  const { data } = await supabase
    .from("app_settings")
    .select("km_per_liter, fuel_price_per_liter_agorot")
    .eq("id", true)
    .single();
  if (!data?.km_per_liter) return 0;
  return Math.round((km / Number(data.km_per_liter)) * Number(data.fuel_price_per_liter_agorot));
}

/** The three steps of getting the visit fee agreed, in the order they happen. */
export type ConfirmationStep = "confirmation_sent_at" | "customer_confirmed_at" | "dispatch_sent_at";

/**
 * Stamp one step of the customer confirmation.
 *
 * A null clears it, which is how a step marked by mistake is taken back — the
 * confirmation is evidence, and evidence that cannot be corrected is worse
 * than none.
 */
export async function stampConfirmationStep(
  supabase: SupabaseClient,
  jobId: string,
  step: ConfirmationStep,
  at: string | null = new Date().toISOString()
) {
  const { data, error } = await supabase
    .from("jobs")
    .update({ [step]: at })
    .eq("id", jobId)
    .select(JOB_SELECT)
    .single();
  if (error) throw error;
  return data as JobWithRelations;
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
