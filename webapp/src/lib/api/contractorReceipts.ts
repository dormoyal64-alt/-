import type { SupabaseClient } from "@supabase/supabase-js";
import { RECEIPTS_BUCKET } from "@/lib/api/expenseReceipts";
import type { ContractorReceiptLine } from "@/lib/accountant";
import type { ContractorReceipt, ExpenseReceipt } from "@/lib/types";

/**
 * The receipts a contractor handed over for one job.
 *
 * Read on the job screen, because that is where the paper changes hands and
 * the only place the contractor, the job and the amount are all already known.
 */
export async function listContractorReceipts(
  supabase: SupabaseClient,
  jobId: string
): Promise<ContractorReceipt[]> {
  const { data, error } = await supabase
    .from("contractor_receipts")
    .select("*")
    .eq("job_id", jobId)
    .order("issued_on")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ContractorReceipt[];
}

/** Every file filed against a set of contractor receipts, oldest first. */
export async function listContractorReceiptFiles(
  supabase: SupabaseClient,
  receiptIds: string[]
): Promise<ExpenseReceipt[]> {
  if (receiptIds.length === 0) return [];
  const { data, error } = await supabase
    .from("expense_receipts")
    .select("*")
    .in("contractor_receipt_id", receiptIds)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ExpenseReceipt[];
}

export interface NewContractorReceipt {
  job_id: string;
  contractor_id: string | null;
  contractor_name: string;
  amount_agorot: number;
  issued_on: string;
  reference: string | null;
}

/**
 * Record a receipt a contractor handed over.
 *
 * The contractor's name is written onto the row rather than only referenced,
 * so a contractor who is later renamed or removed cannot change what a report
 * already sent to the accountant said.
 */
export async function createContractorReceipt(
  supabase: SupabaseClient,
  row: NewContractorReceipt
): Promise<ContractorReceipt> {
  const { data, error } = await supabase.from("contractor_receipts").insert(row).select("*").single();
  if (error) throw error;
  return data as ContractorReceipt;
}

/**
 * Remove a contractor's receipt, paperwork and all.
 *
 * The rows go by way of the cascade, but storage keeps no foreign keys, so the
 * files have to be named before the row that points at them is gone — or they
 * stay in the bucket forever with nothing left to find them by.
 */
export async function deleteContractorReceipt(supabase: SupabaseClient, id: string) {
  const files = await listContractorReceiptFiles(supabase, [id]).catch(() => [] as ExpenseReceipt[]);
  const { error } = await supabase.from("contractor_receipts").delete().eq("id", id);
  if (error) throw error;
  if (files.length > 0) {
    await supabase.storage.from(RECEIPTS_BUCKET).remove(files.map((f) => f.storage_path));
  }
}

/**
 * The contractor receipts dated inside one month, ready for the report.
 *
 * Keyed by the date on the contractor's own paper rather than by when the job
 * closed: that is the date the accountant files it under, and a receipt written
 * in October for a job closed in September belongs to October.
 *
 * Both the accountant screen and the send route read the month through here,
 * so what is shown and what is emailed cannot drift apart.
 */
export async function contractorReceiptLines(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<ContractorReceiptLine[]> {
  const { data, error } = await supabase
    .from("contractor_receipts")
    .select("issued_on, contractor_name, reference, amount_agorot, job:jobs(job_number)")
    .gte("issued_on", from)
    .lte("issued_on", to)
    .order("issued_on");
  // the table arrives with a migration; before it does the month simply has none
  if (error) return [];
  return ((data as unknown as {
    issued_on: string;
    contractor_name: string;
    reference: string | null;
    amount_agorot: number;
    job: { job_number: string } | null;
  }[]) ?? []).map((r) => ({
    issued_on: r.issued_on,
    contractor_name: r.contractor_name,
    reference: r.reference,
    amount_agorot: r.amount_agorot,
    job_number: r.job?.job_number ?? null,
  }));
}

/**
 * The files behind the contractor receipts dated inside one month.
 *
 * Attached to the month's email beside the purchase receipts, because a
 * contractor's receipt is the only proof the payment happened.
 */
export async function contractorReceiptFilesInMonth(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<ExpenseReceipt[]> {
  const { data, error } = await supabase
    .from("expense_receipts")
    .select("*, receipt:contractor_receipts!inner(issued_on)")
    .gte("receipt.issued_on", from)
    .lte("receipt.issued_on", to)
    .order("created_at");
  if (error) return [];
  return (data ?? []) as ExpenseReceipt[];
}
