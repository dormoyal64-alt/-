import type { SupabaseClient } from "@supabase/supabase-js";

export interface ContractorFormInput {
  name: string;
  phone: string;
  whatsapp: string;
  default_commission_pct: number;
  active: boolean;
  notes: string;
  professionIds: string[];
  cityIds: string[];
  // job_type_id -> commission override (null = use default)
  jobTypeCommissions: Record<string, number | null>;
}

async function saveAssignments(supabase: SupabaseClient, contractorId: string, input: ContractorFormInput) {
  await Promise.all([
    supabase.from("contractor_professions").delete().eq("contractor_id", contractorId),
    supabase.from("contractor_cities").delete().eq("contractor_id", contractorId),
    supabase.from("contractor_job_types").delete().eq("contractor_id", contractorId),
  ]);

  const jobTypeIds = Object.keys(input.jobTypeCommissions);

  await Promise.all([
    input.professionIds.length
      ? supabase
          .from("contractor_professions")
          .insert(input.professionIds.map((profession_id) => ({ contractor_id: contractorId, profession_id })))
      : Promise.resolve(),
    input.cityIds.length
      ? supabase.from("contractor_cities").insert(input.cityIds.map((city_id) => ({ contractor_id: contractorId, city_id })))
      : Promise.resolve(),
    jobTypeIds.length
      ? supabase.from("contractor_job_types").insert(
          jobTypeIds.map((job_type_id) => ({
            contractor_id: contractorId,
            job_type_id,
            commission_pct: input.jobTypeCommissions[job_type_id],
          }))
        )
      : Promise.resolve(),
  ]);
}

export async function createContractor(supabase: SupabaseClient, input: ContractorFormInput) {
  const { data, error } = await supabase
    .from("contractors")
    .insert({
      name: input.name,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      default_commission_pct: input.default_commission_pct,
      active: input.active,
      notes: input.notes || null,
    })
    .select()
    .single();

  if (error) throw error;
  await saveAssignments(supabase, data.id, input);
  return data;
}

export async function updateContractor(supabase: SupabaseClient, id: string, input: ContractorFormInput) {
  const { error } = await supabase
    .from("contractors")
    .update({
      name: input.name,
      phone: input.phone || null,
      whatsapp: input.whatsapp || null,
      default_commission_pct: input.default_commission_pct,
      active: input.active,
      notes: input.notes || null,
    })
    .eq("id", id);

  if (error) throw error;
  await saveAssignments(supabase, id, input);
}
