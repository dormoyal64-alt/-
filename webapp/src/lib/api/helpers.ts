import { createClient } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";
import type { Helper } from "@/lib/types";

/**
 * Add a worker you can take along on a job.
 *
 * Names are unique in the database, and a worker who was archived still holds
 * their name. Typing that name again means "this person is back", so the
 * archived row is revived instead of colliding — a duplicate-key error here
 * would look, from the form, exactly like the system refusing a real worker.
 */
export async function createHelper(name: string, defaultPayAgorot: number | null): Promise<Helper> {
  const supabase = createClient();
  const trimmed = name.trim();

  const { data, error } = await supabase
    .from("helpers")
    .insert({ name: trimmed, default_pay_agorot: defaultPayAgorot })
    .select("*")
    .single();

  if (!error) return data as Helper;

  if (isDuplicateName(error)) {
    const { data: existing } = await supabase.from("helpers").select("*").eq("name", trimmed).maybeSingle();
    if (existing) {
      const { data: revived, error: reviveError } = await supabase
        .from("helpers")
        .update({
          active: true,
          // a pay typed now is what they are worth now; an empty box keeps the old figure
          ...(defaultPayAgorot === null ? {} : { default_pay_agorot: defaultPayAgorot }),
        })
        .eq("id", (existing as Helper).id)
        .select("*")
        .single();
      if (!reviveError) return revived as Helper;
    }
  }

  throw new Error(errorMessage(error, "שגיאה בהוספת העובד"));
}

function isDuplicateName(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = String((error as { code?: unknown }).code ?? "");
  const message = String((error as { message?: unknown }).message ?? "");
  return code === "23505" || /duplicate key|already exists/i.test(message);
}
