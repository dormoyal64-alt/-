/**
 * A message a person can act on, out of whatever was thrown.
 *
 * Supabase hands back a plain object rather than an Error, so an
 * `instanceof Error` check quietly turns every failure into the same shrug —
 * which is how a missing database function came out as "שגיאה בעדכון העבודה"
 * with nothing to go on.
 *
 * One case is worth naming: the database not knowing a function or a column
 * means the SQL for the latest change was never run, and no wording PostgREST
 * produces says that.
 */
export function errorMessage(e: unknown, fallback: string): string {
  const raw =
    typeof e === "string"
      ? e
      : e && typeof e === "object" && "message" in e
        ? String((e as { message?: unknown }).message ?? "")
        : "";
  if (!raw.trim()) return fallback;
  if (/could not find the function|schema cache|does not exist/i.test(raw)) {
    return "חסר עדכון בבסיס הנתונים — יש להריץ ב-Supabase את הקוד האחרון שנשלח, ואז לרענן את הדף.";
  }
  return raw;
}
