// Hand-written types mirroring supabase/schema.sql.
// Money is always stored/returned as integer אגורות (agorot) — never floats.

export type PaymentReceivedBy = "contractor" | "business";
export type SettlementStatus = "open" | "settled";

export interface Profession {
  id: string;
  name: string;
  /** how the customer hears about the tradesperson: "טכנאי האינסטלציה" */
  technician_label: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface JobType {
  id: string;
  profession_id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type CityRegion = "צפון" | "מרכז" | "דרום";

export interface City {
  id: string;
  name: string;
  region: CityRegion | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaymentMethod {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface LeadSource {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
}

export interface JobStatus {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  is_active: boolean;
  is_success: boolean;
  is_terminal: boolean;
  created_at: string;
}

export interface Contractor {
  id: string;
  name: string;
  phone: string | null;
  whatsapp: string | null;
  default_commission_pct: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractorProfession {
  contractor_id: string;
  profession_id: string;
}
export interface ContractorCity {
  contractor_id: string;
  city_id: string;
}
export interface ContractorJobType {
  contractor_id: string;
  job_type_id: string;
  commission_pct: number | null;
}

export interface Settlement {
  id: string;
  contractor_id: string;
  period_start: string;
  period_end: string;
  total_jobs: number;
  total_revenue_agorot: number;
  contractor_share_agorot: number;
  business_share_agorot: number;
  contractor_received_agorot: number;
  business_received_agorot: number;
  contractor_owes_business_agorot: number;
  business_owes_contractor_agorot: number;
  net_agorot: number;
  status: SettlementStatus;
  settled_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface Job {
  id: string;
  job_number: string;
  profession_id: string | null;
  job_type_id: string | null;
  city_id: string | null;
  customer_name: string;
  customer_phone: string;
  address_full: string | null;
  address_street: string | null;
  address_house_number: string | null;
  address_city: string | null;
  lat: number | null;
  lng: number | null;
  quoted_price_agorot: number | null;
  payment_method_id: string | null;
  contractor_id: string | null;
  commission_pct: number | null;
  lead_source_id: string | null;
  notes: string | null;
  status_id: string;
  opened_at: string;
  is_closed: boolean;
  final_price_agorot: number | null;
  final_payment_method_id: string | null;
  payment_received_by: PaymentReceivedBy | null;
  closing_notes: string | null;
  closed_at: string | null;
  contractor_share_agorot: number | null;
  business_share_agorot: number | null;
  settlement_id: string | null;
  reminder_sent_at: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface JobStatusHistory {
  id: string;
  job_id: string;
  status_id: string | null;
  note: string | null;
  changed_at: string;
}

export interface AppNotification {
  id: string;
  job_id: string | null;
  type: string;
  message: string;
  is_read: boolean;
  created_at: string;
}

export interface AppSettings {
  id: boolean;
  reminder_minutes: number;
  on_the_way_template: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string;
  created_at: string;
}

// ---- Enriched / joined shapes used across the UI ----

export interface JobWithRelations extends Job {
  profession: Pick<Profession, "id" | "name" | "technician_label"> | null;
  job_type: Pick<JobType, "id" | "name"> | null;
  city: Pick<City, "id" | "name"> | null;
  contractor: Pick<Contractor, "id" | "name" | "phone" | "whatsapp"> | null;
  payment_method: Pick<PaymentMethod, "id" | "name"> | null;
  final_payment_method: Pick<PaymentMethod, "id" | "name"> | null;
  lead_source: Pick<LeadSource, "id" | "name"> | null;
  status: Pick<JobStatus, "id" | "name" | "color" | "is_success" | "is_terminal"> | null;
}

export interface ContractorWithRelations extends Contractor {
  contractor_professions: { profession_id: string }[];
  contractor_cities: { city_id: string }[];
  contractor_job_types: { job_type_id: string; commission_pct: number | null }[];
}

// ---- RPC result row shapes ----

export interface ContractorStatsRow {
  contractor_id: string;
  jobs_sent: number;
  jobs_closed_success: number;
  jobs_not_closed: number;
  close_rate: number | null;
  total_revenue_agorot: number;
  contractor_share_agorot: number;
  business_share_agorot: number;
  avg_price_agorot: number | null;
  avg_close_minutes: number | null;
  contractor_received_agorot: number;
  business_received_agorot: number;
  contractor_owes_business_agorot: number;
  business_owes_contractor_agorot: number;
}

export interface ProfessionStatsRow {
  profession_id: string;
  profession_name: string;
  jobs_count: number;
  closed_success: number;
  revenue_agorot: number;
  profit_agorot: number;
}

export interface CityStatsRow {
  city_id: string;
  city_name: string;
  jobs_count: number;
  closed_success: number;
  revenue_agorot: number;
  profit_agorot: number;
}

export interface JobTypeStatsRow {
  job_type_id: string;
  job_type_name: string;
  profession_id: string;
  jobs_count: number;
  closed_success: number;
  revenue_agorot: number;
}

export interface LeadSourceStatsRow {
  lead_source_id: string;
  lead_source_name: string;
  jobs_count: number;
  closed_success: number;
  revenue_agorot: number;
  profit_agorot: number;
}

export interface DayStatsRow {
  day: string;
  jobs_count: number;
  closed_success: number;
  revenue_agorot: number;
  profit_agorot: number;
}

export interface PeriodTotalsRow {
  jobs_count: number;
  jobs_closed_success: number;
  jobs_closed_failed: number;
  close_rate: number | null;
  revenue_agorot: number;
  profit_agorot: number;
  contractor_payable_agorot: number;
  contractor_receivable_agorot: number;
  avg_price_agorot: number | null;
}

// Minimal Database type so `@supabase/ssr` generics are happy.
// (We rely on hand-written row types above for real app code instead of
// generating a fully strict Supabase Database type.)
export type Database = any;
