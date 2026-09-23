import type { SupabaseClient } from "@supabase/supabase-js";
import { shrinkImage } from "@/lib/images";
import type { ExpenseReceipt } from "@/lib/types";

export const RECEIPTS_BUCKET = "receipts";

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
 * Put one photograph on one expense.
 *
 * The file is shrunk before it leaves the phone, then stored under the
 * expense's own folder so removing the expense takes its paperwork with it.
 * The row is written only once the upload has landed: a record pointing at a
 * file that is not there is worse than no record.
 */
export async function uploadExpenseReceipt(
  supabase: SupabaseClient,
  expenseId: string,
  original: File
): Promise<ExpenseReceipt> {
  const file = await shrinkImage(original);
  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "jpg";
  const path = `${expenseId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("expense_receipts")
    .insert({
      business_expense_id: expenseId,
      storage_path: path,
      file_name: original.name,
      content_type: file.type || "image/jpeg",
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

/** Take a photograph off an expense, file and record together. */
export async function deleteExpenseReceipt(supabase: SupabaseClient, receipt: ExpenseReceipt) {
  const { error } = await supabase.from("expense_receipts").delete().eq("id", receipt.id);
  if (error) throw error;
  await supabase.storage.from(RECEIPTS_BUCKET).remove([receipt.storage_path]);
}

/** A link that opens the photograph, good for an hour and for this viewer only. */
export async function receiptUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}
