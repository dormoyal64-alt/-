import type { SupabaseClient } from "@supabase/supabase-js";

export interface UnsettledSummary {
  contractorId: string;
  jobsCount: number;
  totalRevenueAgorot: number;
  contractorShareAgorot: number;
  businessShareAgorot: number;
  contractorReceivedAgorot: number;
  businessReceivedAgorot: number;
  contractorOwesBusinessAgorot: number;
  businessOwesContractorAgorot: number;
}

export async function fetchUnsettledByContractor(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string
): Promise<Record<string, UnsettledSummary>> {
  const { data, error } = await supabase
    .from("jobs")
    .select("contractor_id, final_price_agorot, contractor_share_agorot, business_share_agorot, payment_received_by")
    .eq("is_closed", true)
    .is("settlement_id", null)
    .not("contractor_id", "is", null)
    .gte("closed_at", fromIso)
    .lte("closed_at", toIso);

  if (error) throw error;

  const map: Record<string, UnsettledSummary> = {};
  for (const row of data ?? []) {
    const id = row.contractor_id as string;
    if (!map[id]) {
      map[id] = {
        contractorId: id,
        jobsCount: 0,
        totalRevenueAgorot: 0,
        contractorShareAgorot: 0,
        businessShareAgorot: 0,
        contractorReceivedAgorot: 0,
        businessReceivedAgorot: 0,
        contractorOwesBusinessAgorot: 0,
        businessOwesContractorAgorot: 0,
      };
    }
    const s = map[id];
    s.jobsCount += 1;
    s.totalRevenueAgorot += row.final_price_agorot ?? 0;
    s.contractorShareAgorot += row.contractor_share_agorot ?? 0;
    s.businessShareAgorot += row.business_share_agorot ?? 0;
    if (row.payment_received_by === "contractor") {
      s.contractorReceivedAgorot += row.final_price_agorot ?? 0;
      s.contractorOwesBusinessAgorot += row.business_share_agorot ?? 0;
    } else if (row.payment_received_by === "business") {
      s.businessReceivedAgorot += row.final_price_agorot ?? 0;
      s.businessOwesContractorAgorot += row.contractor_share_agorot ?? 0;
    }
  }
  return map;
}

export async function settleContractor(
  supabase: SupabaseClient,
  contractorId: string,
  fromIso: string,
  toIso: string,
  notes?: string
) {
  const { data, error } = await supabase.rpc("settle_contractor", {
    p_contractor_id: contractorId,
    p_period_start: fromIso,
    p_period_end: toIso,
    p_notes: notes ?? null,
  });
  if (error) throw error;
  return data;
}
