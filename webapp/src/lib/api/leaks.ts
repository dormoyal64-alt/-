import type { SupabaseClient } from "@supabase/supabase-js";
import { shrinkImage } from "@/lib/images";
import { RECEIPTS_BUCKET } from "@/lib/api/expenseReceipts";
import type { LeakSurvey, LeakSurveyPhoto, LeakSurveyWithPhotos } from "@/lib/types";

/**
 * Leak surveys, and the photographs that are their whole argument.
 *
 * The photographs go into the same private bucket as every other picture the
 * business keeps, under a folder of their own. That bucket's policies already
 * say owner-only, so nothing new has to be granted — and these are pictures
 * of the inside of somebody's home, which is the most private thing this
 * system holds.
 */

export const LEAK_SELECT = "*, leak_survey_photos(*)";

export async function listSurveys(
  supabase: SupabaseClient,
  limit = 100
): Promise<LeakSurveyWithPhotos[] | null> {
  const { data, error } = await supabase
    .from("leak_surveys")
    .select(LEAK_SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  // null, not empty: a database without the migration is a different thing
  // from a business that has not surveyed anything, and the screen says so
  if (error) return null;
  return (data as unknown as LeakSurveyWithPhotos[]) ?? [];
}

export async function fetchSurvey(
  supabase: SupabaseClient,
  id: string
): Promise<LeakSurveyWithPhotos | null> {
  const { data, error } = await supabase
    .from("leak_surveys")
    .select(LEAK_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return (data as unknown as LeakSurveyWithPhotos) ?? null;
}

export async function createSurvey(
  supabase: SupabaseClient,
  fields: Partial<LeakSurvey> & { customer_name: string }
): Promise<LeakSurvey> {
  const { data: auth } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from("leak_surveys")
    .insert({ ...fields, created_by: auth?.user?.id ?? null })
    .select("*")
    .single();
  if (error) throw error;
  return data as LeakSurvey;
}

export async function updateSurvey(
  supabase: SupabaseClient,
  id: string,
  fields: Partial<LeakSurvey>
): Promise<void> {
  const { error } = await supabase
    .from("leak_surveys")
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteSurvey(
  supabase: SupabaseClient,
  survey: LeakSurveyWithPhotos
): Promise<void> {
  const paths = (survey.leak_survey_photos ?? []).map((p) => p.storage_path);
  const { error } = await supabase.from("leak_surveys").delete().eq("id", survey.id);
  if (error) throw error;
  // the rows cascade; the files would not, and would sit in the bucket
  // forever with nothing left to find them by
  if (paths.length) await supabase.storage.from(RECEIPTS_BUCKET).remove(paths);
}

/**
 * Put one photograph on a survey.
 *
 * Shrunk first, like every other photograph the business files: a survey of a
 * flat runs to a dozen pictures straight off a phone, and carrying them at
 * full size would make the report too big to send and slow to build.
 *
 * The row is written only once the upload has landed — a record pointing at a
 * file that is not there is worse than no record.
 */
export async function uploadSurveyPhoto(
  supabase: SupabaseClient,
  surveyId: string,
  original: File,
  sortOrder: number
): Promise<LeakSurveyPhoto> {
  const file = await shrinkImage(original);
  const extension = (file.name.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "jpg").toLowerCase();
  const contentType = file.type || "image/jpeg";
  const path = `leaks/${surveyId}/${crypto.randomUUID()}.${extension}`;

  const { error: uploadError } = await supabase.storage
    .from(RECEIPTS_BUCKET)
    .upload(path, file, { contentType, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from("leak_survey_photos")
    .insert({
      survey_id: surveyId,
      storage_path: path,
      file_name: original.name,
      content_type: contentType,
      size_bytes: file.size,
      sort_order: sortOrder,
    })
    .select("*")
    .single();

  if (error) {
    // nothing points at the file now, so it must not be left behind
    await supabase.storage.from(RECEIPTS_BUCKET).remove([path]);
    throw error;
  }
  return data as LeakSurveyPhoto;
}

export async function updatePhoto(
  supabase: SupabaseClient,
  id: string,
  fields: Partial<LeakSurveyPhoto>
): Promise<void> {
  const { error } = await supabase.from("leak_survey_photos").update(fields).eq("id", id);
  if (error) throw error;
}

export async function deletePhoto(
  supabase: SupabaseClient,
  photo: LeakSurveyPhoto
): Promise<void> {
  const { error } = await supabase.from("leak_survey_photos").delete().eq("id", photo.id);
  if (error) throw error;
  await supabase.storage.from(RECEIPTS_BUCKET).remove([photo.storage_path]);
}

/**
 * Whether this database has the free-text notes column yet.
 *
 * Vercel deploys on push and the SQL is run by hand some time later; in
 * between, offering a box whose every keystroke fails to save is worse than
 * not offering one.
 */
export async function supportsSurveyNotes(supabase: SupabaseClient): Promise<boolean> {
  const { error } = await supabase.from("leak_surveys").select("notes").limit(1);
  return !error;
}

/** A link that opens the photograph, good for an hour and for this viewer only. */
export async function photoUrl(supabase: SupabaseClient, path: string): Promise<string | null> {
  const { data } = await supabase.storage.from(RECEIPTS_BUCKET).createSignedUrl(path, 60 * 60);
  return data?.signedUrl ?? null;
}

/** The bytes themselves, for drawing the arrow on and building the report. */
export async function photoBlob(supabase: SupabaseClient, path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).download(path);
  if (error) throw error;
  return data;
}

/** Photographs in the order they will appear, findings first. */
export function orderedPhotos(survey: LeakSurveyWithPhotos): LeakSurveyPhoto[] {
  return [...(survey.leak_survey_photos ?? [])].sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * How many leak spots, in Hebrew that reads.
 *
 * "1 מוקדים" is the kind of thing that makes a document look machine-made,
 * and this one is handed to a customer who is deciding whether to believe it.
 */
export function spotsLabel(n: number): string {
  if (n === 1) return "מוקד אחד";
  if (n === 2) return "שני מוקדים";
  return `${n} מוקדים`;
}

/** How many of a survey's photographs actually point at something. */
export function findingCount(survey: LeakSurveyWithPhotos): number {
  return (survey.leak_survey_photos ?? []).filter((p) => p.marker_x != null).length;
}
