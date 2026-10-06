import type { SupabaseClient } from "@supabase/supabase-js";
import { shrinkImage } from "@/lib/images";
import type { ExpenseReceipt } from "@/lib/types";

export const RECEIPTS_BUCKET = "receipts";

/**
 * Which record the paper belongs to.
 *
 * Four kinds of document end up in the same bucket — a purchase the business
 * made, a receipt a contractor handed over, the invoice behind an advertising
 * spend, and the counter receipt for something bought for one job — and the row
 * records exactly one of them. Naming the parent once here keeps the upload,
 * the folder and the column from being decided separately and drifting apart.
 */
export type ReceiptParent =
  | { kind: "expense"; id: string }
  | { kind: "contractor"; id: string }
  | { kind: "ad"; id: string }
  | { kind: "job"; id: string };

/** The folder a parent's files live in, so deleting it takes them along. */
function folder(parent: ReceiptParent): string {
  if (parent.kind === "expense") return parent.id;
  if (parent.kind === "contractor") return `contractor-receipts/${parent.id}`;
  if (parent.kind === "ad") return `ad-spend/${parent.id}`;
  return `job-expenses/${parent.id}`;
}

function parentColumn(parent: ReceiptParent): Record<string, string> {
  if (parent.kind === "expense") return { business_expense_id: parent.id };
  if (parent.kind === "contractor") return { contractor_receipt_id: parent.id };
  if (parent.kind === "ad") return { ad_spend_id: parent.id };
  return { job_expense_id: parent.id };
}

/** Every photograph filed against one expense, oldest first. */
export async function listExpenseReceipts(
  supabase: SupabaseClient,
  expenseIds: string[]
): Promise<ExpenseReceipt[]> {
  if (expenseIds.length === 0) return [];
  const { data, error } = await supabase
    .from("expense_receipts")
    .select("*")
    .in("business_expense_id", expenseIds)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ExpenseReceipt[];
}

/**
 * What to call the stored copy, and what to say it is.
 *
 * A photograph is the common case and the old assumptions were built around it,
 * but a supplier's invoice arrives as a PDF — and a scan, a spreadsheet or
 * whatever else a supplier chose to send is still the paper behind an expense.
 * Guessing "jpg" for those would hand the browser a file it opens as a broken
 * picture, so the extension and the type follow the file rather than the hope.
 */
function storedAs(file: File): { extension: string; contentType: string } {
  const fromName = file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  const type = file.type || (fromName === "pdf" ? "application/pdf" : "");
  if (fromName) return { extension: fromName, contentType: type || "application/octet-stream" };
  // no extension at all: fall back to the browser's own word for it
  if (type.startsWith("image/")) return { extension: type.slice(6) || "jpg", contentType: type };
  if (type === "application/pdf") return { extension: "pdf", contentType: type };
  return { extension: "bin", contentType: type || "application/octet-stream" };
}

/**
 * Put one piece of paper on whatever it is proof of.
 *
 * A photograph is shrunk before it leaves the phone; anything else is stored
 * exactly as it came, because re-encoding a document is not a thing that can go
 * well. It lands under its parent's own folder so removing the parent takes its
 * paperwork with it, and the row is written only once the upload has landed: a
 * record pointing at a file that is not there is worse than no record.
 */
export async function uploadReceiptFile(
  supabase: SupabaseClient,
  parent: ReceiptParent,
  original: File
): Promise<ExpenseReceipt> {
  const file = await shrinkImage(original);
  const { extension, contentType } = storedAs(file);
  const path = `${folder(parent)}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("expense_receipts")
    .insert({
      ...parentColumn(parent),
      storage_path: path,
      file_name: original.name,
      content_type: contentType,
      size_bytes: file.size,
    })
    .select("*")
    .single();

  if (error) {
    // nothing points at the file now, so it must not be left behind
    await supabase.storage.from(RECEIPTS_BUCKET).remove([path]);
    throw error;
  }
  return data as ExpenseReceipt;
}

/** Take a photograph off whatever it was proof of, file and record together. */
export async function deleteReceiptFile(supabase: SupabaseClient, receipt: ExpenseReceipt) {
  const { error } = await supabase.from("expense_receipts").delete().eq("id", receipt.id);
  if (error) throw error;
  await supabase.storage.from(RECEIPTS_BUCKET).remove([receipt.storage_path]);
}

/** A link that opens the photograph, good for an hour and for this viewer only. */
export async function receiptUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

/**
 * Every document filed against a set of advertising spends, oldest first.
 *
 * Throws rather than returning nothing when the column is missing, so the
 * caller can tell "no receipts yet" apart from "the database has not been
 * updated yet" and hide the camera instead of offering one that cannot work.
 */
export async function listAdSpendReceipts(
  supabase: SupabaseClient,
  adSpendIds: string[]
): Promise<ExpenseReceipt[]> {
  if (adSpendIds.length === 0) return [];
  const { data, error } = await supabase
    .from("expense_receipts")
    .select("*")
    .in("ad_spend_id", adSpendIds)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ExpenseReceipt[];
}

/**
 * The documents behind the advertising that touches one month.
 *
 * A spend can cover a range — a campaign paid once for thirty days — so the
 * invoice belongs to every month that range reaches into, the same way the
 * figure itself is spread. Returns nothing rather than failing when the column
 * is not there yet: a month simply has no advertising paper until it is.
 */
export async function adSpendReceiptFilesInMonth(
  supabase: SupabaseClient,
  from: string,
  to: string
): Promise<ExpenseReceipt[]> {
  const { data, error } = await supabase
    .from("expense_receipts")
    .select("*, spend:ad_spend!inner(spent_on, covers_to)")
    .lte("spend.spent_on", to)
    .order("created_at");
  if (error) return [];
  return ((data ?? []) as (ExpenseReceipt & {
    spend: { spent_on: string; covers_to: string | null } | null;
  })[]).filter((r) => {
    const end = r.spend?.covers_to ?? r.spend?.spent_on;
    return !!end && end >= from;
  });
}

/**
 * Remove an advertising spend, paperwork and all.
 *
 * The rows go by way of the cascade, but storage keeps no foreign keys, so the
 * files have to be named before the row that points at them is gone — or they
 * stay in the bucket forever with nothing left to find them by.
 */
export async function deleteAdSpend(supabase: SupabaseClient, id: string) {
  const files = await listAdSpendReceipts(supabase, [id]).catch(() => [] as ExpenseReceipt[]);
  const { error } = await supabase.from("ad_spend").delete().eq("id", id);
  if (error) throw error;
  if (files.length > 0) {
    await supabase.storage.from(RECEIPTS_BUCKET).remove(files.map((f) => f.storage_path));
  }
}

/**
 * Every document filed against a set of one job's own costs, oldest first.
 *
 * Throws rather than returning nothing when the column is missing, so the
 * caller can tell "no receipts yet" apart from "the database has not been
 * updated yet" and hide the camera instead of offering one that cannot work.
 */
export async function listJobExpenseReceipts(
  supabase: SupabaseClient,
  jobExpenseIds: string[]
): Promise<ExpenseReceipt[]> {
  if (jobExpenseIds.length === 0) return [];
  const { data, error } = await supabase
    .from("expense_receipts")
    .select("*")
    .in("job_expense_id", jobExpenseIds)
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as ExpenseReceipt[];
}

/**
 * Remove one of a job's costs, paperwork and all.
 *
 * The row goes by way of the cascade, but storage keeps no foreign keys, so the
 * files have to be named before the row that points at them is gone.
 */
export async function deleteJobExpense(supabase: SupabaseClient, id: string) {
  const files = await listJobExpenseReceipts(supabase, [id]).catch(() => [] as ExpenseReceipt[]);
  const { error } = await supabase.from("job_expenses").delete().eq("id", id);
  if (error) throw error;
  if (files.length > 0) {
    await supabase.storage.from(RECEIPTS_BUCKET).remove(files.map((f) => f.storage_path));
  }
}

/**
 * The receipts behind the job costs that belong to one month.
 *
 * Keyed by when the job closed, because that is how the accountant report
 * counts the costs themselves — the paper has to travel with the line it
 * proves. Returns nothing rather than failing when the column is not there yet.
 */
export async function jobExpenseReceiptFilesInMonth(
  supabase: SupabaseClient,
  fromIso: string,
  toIso: string
): Promise<ExpenseReceipt[]> {
  const { data, error } = await supabase
    .from("expense_receipts")
    .select("*, cost:job_expenses!inner(job:jobs!inner(closed_at))")
    .gte("cost.job.closed_at", fromIso)
    .lte("cost.job.closed_at", toIso)
    .order("created_at");
  if (error) return [];
  return (data ?? []) as ExpenseReceipt[];
}
