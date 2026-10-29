import type { SupabaseClient } from "@supabase/supabase-js";
import type { Quote, QuoteStatus, QuoteWithLines } from "@/lib/types";

/**
 * Reading and writing quotes.
 *
 * The total is deliberately never sent from here: the database sums it from the
 * lines on every change, so a quote cannot be stored saying one thing while its
 * own breakdown says another. Every write that touches lines therefore reads
 * the quote back rather than assuming what it now holds.
 */

export const QUOTE_SELECT = "*, quote_lines(*)";

/** One line as the form holds it, before it has an id. */
export interface QuoteLineDraft {
  description: string;
  qty: number;
  unit_price_agorot: number;
}

export interface QuoteDraft {
  customer_name: string;
  customer_phone: string | null;
  customer_address: string | null;
  customer_tax_id: string | null;
  profession_id: string | null;
  job_type_id: string | null;
  title: string | null;
  valid_until: string | null;
  notes: string | null;
  /** the name heading this one quote; null uses the trade's, then the business's */
  business_name_override: string | null;
  /** what the customer is asked to pay; null means the sum of the lines */
  final_total_agorot: number | null;
  /** null says nothing on the quote, false says not yet, true says already done */
  work_done: boolean | null;
  lines: QuoteLineDraft[];
}

/** Which of the later columns this database has. The screen works without any. */
export interface QuoteColumns {
  nameOverride: boolean;
  /** final_total_agorot and work_done; they arrived together */
  finalTotal: boolean;
}

/**
 * Whether this database has the per-quote name yet.
 *
 * Vercel deploys the moment the code is pushed; the SQL is run by hand some
 * minutes or days later. In between, naming a column the database has not got
 * fails the whole insert — so the screen asks first and simply leaves the
 * field out until the answer is yes.
 */
export async function probeQuoteColumns(supabase: SupabaseClient): Promise<QuoteColumns> {
  const [name, final] = await Promise.all([
    supabase.from("quotes").select("business_name_override").limit(1),
    supabase.from("quotes").select("final_total_agorot,work_done").limit(1),
  ]);
  // asked separately because they shipped separately: a database that has had
  // one script and not the next should lose one field, not both
  return { nameOverride: !name.error, finalTotal: !final.error };
}

export async function listQuotes(
  supabase: SupabaseClient,
  limit = 100
): Promise<QuoteWithLines[] | null> {
  const { data, error } = await supabase
    .from("quotes")
    .select(QUOTE_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  // null, not an empty list: a database that has not had the migration yet is
  // a different thing from a business with no quotes, and the screen says so
  if (error) return null;
  return (data as unknown as QuoteWithLines[]) ?? [];
}

export async function fetchQuote(supabase: SupabaseClient, id: string): Promise<QuoteWithLines | null> {
  const { data, error } = await supabase.from("quotes").select(QUOTE_SELECT).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as unknown as QuoteWithLines) ?? null;
}

function quoteColumns(draft: QuoteDraft, has: QuoteColumns) {
  return {
    customer_name: draft.customer_name.trim(),
    customer_phone: draft.customer_phone?.trim() || null,
    customer_address: draft.customer_address?.trim() || null,
    customer_tax_id: draft.customer_tax_id?.trim() || null,
    profession_id: draft.profession_id || null,
    job_type_id: draft.job_type_id || null,
    title: draft.title?.trim() || null,
    valid_until: draft.valid_until || null,
    notes: draft.notes?.trim() || null,
    ...(has.nameOverride
      ? { business_name_override: draft.business_name_override?.trim() || null }
      : {}),
    ...(has.finalTotal
      ? { final_total_agorot: draft.final_total_agorot, work_done: draft.work_done }
      : {}),
  };
}

function lineRows(quoteId: string, lines: QuoteLineDraft[]) {
  return lines
    .filter((l) => l.description.trim())
    .map((l, i) => ({
      quote_id: quoteId,
      description: l.description.trim(),
      qty: l.qty,
      unit_price_agorot: l.unit_price_agorot,
      sort_order: i,
    }));
}

export async function createQuote(
  supabase: SupabaseClient,
  draft: QuoteDraft,
  has: QuoteColumns
): Promise<QuoteWithLines> {
  const { data: auth } = await supabase.auth.getUser();
  const { data: quote, error } = await supabase
    .from("quotes")
    .insert({ ...quoteColumns(draft, has), created_by: auth?.user?.id ?? null })
    .select("*")
    .single();
  if (error) throw error;

  const rows = lineRows((quote as Quote).id, draft.lines);
  if (rows.length) {
    const { error: lineError } = await supabase.from("quote_lines").insert(rows);
    // a quote whose lines failed to save is a quote with no breakdown behind
    // its price — so the half-written row goes rather than being left behind
    if (lineError) {
      await supabase.from("quotes").delete().eq("id", (quote as Quote).id);
      throw lineError;
    }
  }

  const fresh = await fetchQuote(supabase, (quote as Quote).id);
  if (!fresh) throw new Error("ההצעה נשמרה אך לא נמצאה");
  return fresh;
}

/**
 * Rewriting a quote that has not been answered yet.
 *
 * The lines are replaced rather than matched up one by one: a quote is short,
 * and reconciling which line the owner meant to edit is a good deal more
 * likely to get a price wrong than writing the three of them again.
 */
export async function updateQuote(
  supabase: SupabaseClient,
  id: string,
  draft: QuoteDraft,
  has: QuoteColumns
): Promise<QuoteWithLines> {
  const { error } = await supabase.from("quotes").update(quoteColumns(draft, has)).eq("id", id);
  if (error) throw error;

  const { error: clearError } = await supabase.from("quote_lines").delete().eq("quote_id", id);
  if (clearError) throw clearError;

  const rows = lineRows(id, draft.lines);
  if (rows.length) {
    const { error: lineError } = await supabase.from("quote_lines").insert(rows);
    if (lineError) throw lineError;
  }

  const fresh = await fetchQuote(supabase, id);
  if (!fresh) throw new Error("ההצעה לא נמצאה");
  return fresh;
}

/** The quote went out. Recorded on the first send; a resend does not move it. */
export async function markQuoteSent(supabase: SupabaseClient, quote: Quote): Promise<void> {
  const patch: Record<string, unknown> = {
    status: quote.status === "draft" || quote.status === "expired" ? "sent" : quote.status,
    sent_to: quote.customer_phone,
    updated_at: new Date().toISOString(),
  };
  if (!quote.sent_at) patch.sent_at = new Date().toISOString();
  const { error } = await supabase.from("quotes").update(patch).eq("id", quote.id);
  if (error) throw error;
}

export async function setQuoteStatus(
  supabase: SupabaseClient,
  id: string,
  status: QuoteStatus
): Promise<void> {
  const answered = status === "accepted" || status === "declined";
  const { error } = await supabase
    .from("quotes")
    .update({
      status,
      answered_at: answered ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteQuote(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("quotes").delete().eq("id", id);
  if (error) throw error;
}
