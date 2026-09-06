import type { Country, DayProgress, ReadingDivisionSchemeId, StreakState } from '@/types';
import { addDaysIso, getDailyReadingPlan, todayIsoDate } from '@/services/calendar';

export type IsRestDayFn = (date: string) => boolean;

export function makeIsRestDayFn(country: Country, scheme: ReadingDivisionSchemeId): IsRestDayFn {
  const cache = new Map<string, boolean>();
  return (date: string) => {
    const cached = cache.get(date);
    if (cached !== undefined) return cached;
    const plan = getDailyReadingPlan(date, country, scheme);
    cache.set(date, plan.isRestDay);
    return plan.isRestDay;
  };
}

function isDayDone(days: Record<string, DayProgress>, date: string): boolean {
  return Boolean(days[date]?.completedAt);
}

/**
 * Walks backward from `fromDate` (inclusive) counting a consecutive run of
 * completed reading-days, skipping rest days (Shabbat under most schemes,
 * or holiday weeks with no shnayim-mikra portion) without breaking the run.
 * Stops at the first *required* day that was not completed.
 */
function countRunEndingAt(
  days: Record<string, DayProgress>,
  fromDate: string,
  isRestDay: IsRestDayFn,
  minDate?: string
): number {
  let count = 0;
  let cursor = fromDate;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (minDate && cursor < minDate) break;
    if (isRestDay(cursor)) {
      cursor = addDaysIso(cursor, -1);
      continue;
    }
    if (isDayDone(days, cursor)) {
      count += 1;
      cursor = addDaysIso(cursor, -1);
      continue;
    }
    break;
  }
  return count;
}

export function computeCurrentStreak(
  days: Record<string, DayProgress>,
  isRestDay: IsRestDayFn,
  today: string = todayIsoDate()
): number {
  if (isDayDone(days, today) || isRestDay(today)) {
    return countRunEndingAt(days, today, isRestDay);
  }
  // Today isn't done yet and isn't a rest day — the streak isn't broken
  // until today ends, so count the run ending yesterday.
  return countRunEndingAt(days, addDaysIso(today, -1), isRestDay);
}

export function computeLongestStreak(
  days: Record<string, DayProgress>,
  isRestDay: IsRestDayFn
): number {
  const completedDates = Object.keys(days)
    .filter((d) => isDayDone(days, d))
    .sort();
  if (completedDates.length === 0) return 0;

  let longest = 0;
  for (const date of completedDates) {
    const run = countRunEndingAt(days, date, isRestDay, completedDates[0]);
    if (run > longest) longest = run;
  }
  return longest;
}

export function computeStreakState(
  days: Record<string, DayProgress>,
  country: Country,
  scheme: ReadingDivisionSchemeId,
  today: string = todayIsoDate()
): StreakState {
  const isRestDay = makeIsRestDayFn(country, scheme);
  const completedDates = Object.keys(days).filter((d) => isDayDone(days, d));
  const lastCompletedDate = completedDates.sort().pop() ?? null;
  return {
    currentStreak: computeCurrentStreak(days, isRestDay, today),
    longestStreak: computeLongestStreak(days, isRestDay),
    lastCompletedDate,
    totalDaysCompleted: completedDates.length,
  };
}

/** True once every required (non-rest) reading day of the shnayim-mikra week ending at `shabbatDate` is complete. */
export function isWeekFullyCompleted(
  shabbatDate: string,
  days: Record<string, DayProgress>,
  isRestDay: IsRestDayFn
): boolean {
  let cursor = addDaysIso(shabbatDate, -6);
  for (let i = 0; i < 7; i++) {
    if (!isRestDay(cursor) && !isDayDone(days, cursor)) return false;
    cursor = addDaysIso(cursor, 1);
  }
  return true;
}

export function countCompletedInMonth(
  days: Record<string, DayProgress>,
  year: number,
  month1to12: number
): number {
  const prefix = `${year}-${String(month1to12).padStart(2, '0')}`;
  return Object.keys(days).filter((d) => d.startsWith(prefix) && isDayDone(days, d)).length;
}
