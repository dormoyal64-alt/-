/**
 * A message a person can act on, out of whatever was thrown.
 *
 * Supabase hands back a plain object rather than an Error, so an
 * `instanceof Error` check quietly turns every failure into the same shrug —
 * which is how a missing database function came out as "שגיאה בעדכון העבודה"
 * with nothing to go on.
 *
 * One case is worth naming: PostgREST answering that it has no such function
 * means the SQL for the latest change was never run, or its schema cache has
 * not caught up — and no wording it produces says either. Everything else
 * keeps its own text, including a fault inside a function that does exist,
 * which "does not exist" would otherwise disguise as the same thing.
 */
export function errorMessage(e: unknown, fallback: string): string {
  const raw =
    typeof e === "string"
      ? e
      : e && typeof e === "object" && "message" in e
        ? String((e as { message?: unknown }).message ?? "")
        : "";
  if (!raw.trim()) return fallback;
  if (/could not find the function|schema cache/i.test(raw)) {
    return "בסיס הנתונים לא מכיר את הפעולה הזו. הריצו ב-Supabase את הקוד האחרון שנשלח, ואם כבר הרצתם — רעננו את ה-schema cache (Settings ← API ← Reload schema cache).";
  }
  return raw;
}
