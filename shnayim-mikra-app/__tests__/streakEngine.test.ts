import type { DayProgress } from '@/types';
import {
  computeCurrentStreak,
  computeLongestStreak,
  computeStreakState,
  countCompletedInMonth,
  isWeekFullyCompleted,
  makeIsRestDayFn,
} from '@/services/streak/streakEngine';

function day(date: string): DayProgress {
  return {
    date,
    completedVerseRefs: [],
    totalVersesInPortion: 10,
    completedAt: new Date().toISOString(),
    secondsSpentReading: 60,
  };
}

const noRestDays = () => false;

describe('computeCurrentStreak (with a stub isRestDay)', () => {
  it('counts a simple unbroken run ending today', () => {
    const days = { '2026-01-01': day('2026-01-01'), '2026-01-02': day('2026-01-02') };
    expect(computeCurrentStreak(days, noRestDays, '2026-01-02')).toBe(2);
  });

  it('does not break the streak if today has not been completed yet', () => {
    const days = { '2026-01-01': day('2026-01-01'), '2026-01-02': day('2026-01-02') };
    expect(computeCurrentStreak(days, noRestDays, '2026-01-03')).toBe(2);
  });

  it('breaks the streak once a required (non-rest) day is skipped entirely', () => {
    const days = { '2026-01-01': day('2026-01-01') }; // 01-02 missing and required
    expect(computeCurrentStreak(days, noRestDays, '2026-01-03')).toBe(0);
  });

  it('does not break the streak across a rest day (e.g. a holiday week with no portion)', () => {
    const isRestDay = (d: string) => d === '2026-01-02';
    const days = { '2026-01-01': day('2026-01-01'), '2026-01-03': day('2026-01-03') };
    expect(computeCurrentStreak(days, isRestDay, '2026-01-03')).toBe(2);
  });
});

describe('computeLongestStreak', () => {
  it('finds the longest run even if it is not the most recent one', () => {
    const days = {
      '2026-01-01': day('2026-01-01'),
      '2026-01-02': day('2026-01-02'),
      '2026-01-03': day('2026-01-03'),
      // gap
      '2026-01-10': day('2026-01-10'),
    };
    expect(computeLongestStreak(days, noRestDays)).toBe(3);
  });
});

describe('countCompletedInMonth', () => {
  it('counts only days within the given month', () => {
    const days = {
      '2026-02-01': day('2026-02-01'),
      '2026-02-15': day('2026-02-15'),
      '2026-03-01': day('2026-03-01'),
    };
    expect(countCompletedInMonth(days, 2026, 2)).toBe(2);
  });
});

describe('computeStreakState — integration with the real calendar (Rosh Hashana rest week)', () => {
  it('a missed chag-week day (no regular parasha) never counts against the streak', () => {
    const isRestDay = makeIsRestDayFn('IL', 'sun-fri-6days');
    // Sat 2026-09-12 is Rosh Hashana — a genuine rest day for shnayim mikra (verified in parasha.test.ts).
    expect(isRestDay('2026-09-12')).toBe(true);

    const days: Record<string, DayProgress> = {
      '2026-09-10': day('2026-09-10'), // Thursday before, completed
      // 09-11 (Friday) intentionally NOT completed to test it still counts as required
    };
    // Friday the 11th IS a required day under this scheme (it's not Shabbat), so leaving it
    // out should break continuity — this asserts the rest-day skip is specific to true rest days.
    const streak = computeStreakState(days, 'IL', 'sun-fri-6days', '2026-09-12');
    expect(streak.currentStreak).toBe(0);
  });
});

describe('isWeekFullyCompleted', () => {
  it('is true only once every required day of the week is done', () => {
    const isRestDay = (d: string) => d === '2026-01-03'; // Saturday as rest day
    const shabbatDate = '2026-01-03';
    const days: Record<string, DayProgress> = {};
    const requiredDates = ['2025-12-28', '2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02'];
    requiredDates.forEach((d) => (days[d] = day(d)));
    expect(isWeekFullyCompleted(shabbatDate, days, isRestDay)).toBe(true);

    delete days['2026-01-02'];
    expect(isWeekFullyCompleted(shabbatDate, days, isRestDay)).toBe(false);
  });
});
