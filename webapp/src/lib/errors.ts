/**
 * A message a person can act on, out of whatever was thrown.
 *
 * Supabase hands back a plain object rather than an Error, so an
 * `instanceof Error` check quietly turns every failure into the same shrug.
 *
 * Two shapes are worth naming, because no wording PostgREST produces explains
 * either to the person reading it, and because they are told apart by exactly
 * the words that made the first version of this get it wrong: a missing COLUMN
 * also reports "in the schema cache", which sent a database that was simply
 * behind on its updates off to refresh a cache that was never the problem. So
 * the column case is checked first, and both say which name is missing.
 */
export function errorMessage(e: unknown, fallback: string): string {
  const raw = readMessage(e);
  if (!raw.trim()) return fallback;

  const column =
    // PostgREST: Could not find the 'scheduled_at' column of 'jobs' in the schema cache
    raw.match(/could not find the '([^']+)' column/i)?.[1] ??
    // Postgres: column jobs.scheduled_at does not exist
    raw.match(/column [\w.]*?\.?(\w+) does not exist/i)?.[1];
  if (column) {
    return `בסיס הנתונים חסר את השדה "${column}". יש להריץ ב-Supabase את הקוד האחרון שנשלח, ואז לרענן את הדף.`;
  }

  const fn = raw.match(/could not find the function (?:public\.)?(\w+)/i)?.[1];
  if (fn || /could not find the function|schema cache/i.test(raw)) {
    return fn
      ? `בסיס הנתונים לא מכיר את הפעולה "${fn}". יש להריץ ב-Supabase את הקוד האחרון שנשלח, ואז לרענן את הדף.`
      : "בסיס הנתונים לא מכיר את הפעולה הזו. יש להריץ ב-Supabase את הקוד האחרון שנשלח, ואז לרענן את הדף.";
  }

  return raw;
}

function readMessage(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object" && "message" in e) {
    return String((e as { message?: unknown }).message ?? "");
  }
  return "";
}
