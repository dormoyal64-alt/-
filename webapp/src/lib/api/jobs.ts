import type { SupabaseClient } from "@supabase/supabase-js";
import type { JobWithRelations, PaymentReceivedBy } from "@/lib/types";

export const JOB_SELECT = `*,
  profession:professions(id,name),
  job_type:job_types(id,name),
  city:cities(id,name),
  contractor:contractors(id,name,phone,whatsapp),
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
  address_full?: string | null;
  address_street?: string | null;
  address_house_number?: string | null;
  address_city?: string | null;
  lat?: number | null;
  lng?: number | null;
  quoted_price_agorot?: number | null;
  payment_method_id?: string | null;
  contractor_id?: string | null;
  commission_pct?: number | null;
  lead_source_id?: string | null;
  notes?: string | null;
  status_id: string;
  opened_at: string;
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
