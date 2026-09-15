import type { ContractorWithRelations } from "@/lib/types";

export type Availability = "open" | "closed" | "unknown";

export const WEEKDAYS_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

/** "08:00:00" or "08:00" → minutes since midnight */
export function toMinutes(t: string): number {
  const [h, m] = t.split(":");
  return Number(h) * 60 + Number(m);
}

export function hhmm(t: string): string {
  return t.slice(0, 5);
}

/**
 * Whether a contractor is working at a given moment.
 *
 * "unknown" is its own answer, not a synonym for closed. A contractor whose
 * hours were never filled in must not be treated as unavailable — otherwise
 * adding this feature would silently push every contractor already in the book
 * to the bottom of the list.
 */
export function availabilityAt(c: ContractorWithRelations, when: Date): Availability {
  if (c.available_247) return "open";
  const hours = c.contractor_hours ?? [];
  if (hours.length === 0) return "unknown";

  const dow = when.getDay();
  const mins = when.getHours() * 60 + when.getMinutes();

  for (const h of hours) {
    const from = toMinutes(h.starts_at);
    const to = toMinutes(h.ends_at);
    if (from <= to) {
      // an ordinary shift inside one day
      if (h.weekday === dow && mins >= from && mins < to) return "open";
    } else {
      // crosses midnight: the late half belongs to its own day, the early half
      // to the morning after
      if (h.weekday === dow && mins >= from) return "open";
      if (h.weekday === (dow + 6) % 7 && mins < to) return "open";
    }
  }
  return "closed";
}

/** "ראשון–חמישי 08:00–17:00" style summary, for showing on a card. */
export function describeHours(c: ContractorWithRelations): string {
  if (c.available_247) return "זמין 24/7";
  const hours = c.contractor_hours ?? [];
  if (hours.length === 0) return "לא הוגדרו שעות";

  const byDay = new Map<number, string[]>();
  for (const h of hours) {
    const list = byDay.get(h.weekday) ?? [];
    list.push(`${hhmm(h.starts_at)}–${hhmm(h.ends_at)}`);
    byDay.set(h.weekday, list);
  }

  // group consecutive days that share the same hours, so five identical days
  // read as one range instead of five lines
  const parts: string[] = [];
  let runStart: number | null = null;
  let runText = "";
  for (let d = 0; d <= 7; d++) {
    const text = d < 7 ? (byDay.get(d)?.sort().join(", ") ?? "") : "";
    if (text !== runText) {
      if (runStart !== null && runText) {
        const end = d - 1;
        parts.push(
          runStart === end
            ? `${WEEKDAYS_HE[runStart]} ${runText}`
            : `${WEEKDAYS_HE[runStart]}–${WEEKDAYS_HE[end]} ${runText}`
        );
      }
      runStart = d;
      runText = text;
    }
  }
  return parts.join(" · ");
}

/** The next time this contractor opens, or null if it cannot be worked out. */
export function nextOpening(c: ContractorWithRelations, from: Date): string | null {
  if (c.available_247 || (c.contractor_hours ?? []).length === 0) return null;
  for (let ahead = 0; ahead < 7; ahead++) {
    const day = (from.getDay() + ahead) % 7;
    const minsNow = ahead === 0 ? from.getHours() * 60 + from.getMinutes() : -1;
    const todays = (c.contractor_hours ?? [])
      .filter((h) => h.weekday === day && toMinutes(h.starts_at) > minsNow)
      .sort((a, b) => toMinutes(a.starts_at) - toMinutes(b.starts_at));
    if (todays.length) {
      const when = hhmm(todays[0].starts_at);
      return ahead === 0 ? `היום ב-${when}` : `ביום ${WEEKDAYS_HE[day]} ב-${when}`;
    }
  }
  return null;
}
