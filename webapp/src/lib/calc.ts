// Client-side preview only — the authoritative calculation happens server-side
// in the `close_job` Postgres function (see supabase/schema.sql) so money math
// is never trusted from the browser.

export interface CommissionPreview {
  contractorShareAgorot: number;
  businessShareAgorot: number;
  contractorOwesBusinessAgorot: number;
  businessOwesContractorAgorot: number;
}

export function previewCommission(
  finalPriceAgorot: number,
  commissionPct: number,
  paymentReceivedBy: "contractor" | "business"
): CommissionPreview {
  const contractorShareAgorot = Math.round((finalPriceAgorot * commissionPct) / 100);
  const businessShareAgorot = finalPriceAgorot - contractorShareAgorot;

  return {
    contractorShareAgorot,
    businessShareAgorot,
    contractorOwesBusinessAgorot: paymentReceivedBy === "contractor" ? businessShareAgorot : 0,
    businessOwesContractorAgorot: paymentReceivedBy === "business" ? contractorShareAgorot : 0,
  };
}
