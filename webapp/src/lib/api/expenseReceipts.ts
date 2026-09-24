import type { SupabaseClient } from "@supabase/supabase-js";
import { shrinkImage } from "@/lib/images";
import type { ExpenseReceipt } from "@/lib/types";

export const RECEIPTS_BUCKET = "receipts";

/**
 * Which record the paper belongs to.
 *
 * Two kinds of document end up in the same bucket — a purchase the business
 * made, and a receipt a contractor handed over — and the row records exactly
 * one of them. Naming the parent once here keeps the upload, the folder and
 * the column from being decided separately and drifting apart.
 */
export type ReceiptParent =
  | { kind: "expense"; id: string }
  | { kind: "contractor"; id: string };

/** The folder a parent's files live in, so deleting it takes them along. */
function folder(parent: ReceiptParent): string {
  return parent.kind === "expense" ? parent.id : `contractor-receipts/${parent.id}`;
}

function parentColumn(parent: ReceiptParent): Record<string, string> {
  return parent.kind === "expense"
    ? { business_expense_id: parent.id }
    : { contractor_receipt_id: parent.id };
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
 * Put one photograph on whatever it is proof of.
 *
 * The file is shrunk before it leaves the phone, then stored under its
 * parent's own folder so removing the parent takes its paperwork with it. The
 * row is written only once the upload has landed: a record pointing at a file
 * that is not there is worse than no record.
 */
export async function uploadReceiptFile(
  supabase: SupabaseClient,
  parent: ReceiptParent,
  original: File
): Promise<ExpenseReceipt> {
  const file = await shrinkImage(original);
  const extension = file.name.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "jpg";
  const path = `${folder(parent)}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, file, { contentType: file.type || "image/jpeg", upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("expense_receipts")
    .insert({
      ...parentColumn(parent),
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
