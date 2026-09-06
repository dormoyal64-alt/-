import { getWeekReadingContext } from '@/services/calendar/parasha';
import {
  buildDailyReadingPlan,
  getAliyotRangesForParasha,
  getPlanVerseCount,
} from '@/services/calendar/readingDivision';

describe('getAliyotRangesForParasha', () => {
  it('produces 7 contiguous, non-overlapping verse ranges for a single parasha', () => {
    const ranges = getAliyotRangesForParasha(['Bereshit']);
    expect(Object.keys(ranges)).toHaveLength(7);
    // First aliyah starts at the very beginning of the book.
    expect(ranges[1].start).toEqual({ book: 'Genesis', chapter: 1, verse: 1 });
    // Every aliyah after the first should start exactly where the previous one ended (+1 verse, same or next chapter).
    for (let i = 2 as 2 | 3 | 4 | 5 | 6 | 7; i <= 7; i++) {
      const prevEnd = ranges[(i - 1) as 1 | 2 | 3 | 4 | 5 | 6].end;
      const curStart = ranges[i].start;
      const contiguous =
        (curStart.chapter === prevEnd.chapter && curStart.verse === prevEnd.verse + 1) ||
        (curStart.chapter === prevEnd.chapter + 1 && curStart.verse === 1);
      expect(contiguous).toBe(true);
    }
  });

  it('produces a combined 7-aliyah division for a doubled parasha', () => {
    const ranges = getAliyotRangesForParasha(['Matot', 'Masei']);
    expect(ranges[1].start.book).toBe('Numbers');
    expect(ranges[7].end.book).toBe('Numbers');
  });
});

describe('buildDailyReadingPlan — scheme "sun-fri-6days" (finish before Shabbat)', () => {
  const ctx = getWeekReadingContext('2026-09-15', 'IL'); // Parashat Ha'azinu week

  it('assigns one aliyah per day Sunday-Thursday, and aliyot 6+7 combined on Friday', () => {
    const sunday = buildDailyReadingPlan(ctx, '2026-09-13', 'sun-fri-6days');
    expect(sunday.dayPortion?.aliyot).toEqual([1]);

    const friday = buildDailyReadingPlan(ctx, '2026-09-18', 'sun-fri-6days');
    expect(friday.dayPortion?.aliyot).toEqual([6, 7]);
  });

  it('treats Shabbat itself as a rest day under this scheme', () => {
    const shabbat = buildDailyReadingPlan(ctx, '2026-09-19', 'sun-fri-6days');
    expect(shabbat.isRestDay).toBe(true);
    expect(shabbat.dayPortion).toBeNull();
  });
});

describe('buildDailyReadingPlan — scheme "sun-sat-7days" (spread across the whole week)', () => {
  const ctx = getWeekReadingContext('2026-09-15', 'IL');

  it('assigns exactly one aliyah per day, including Shabbat', () => {
    const days = ['2026-09-13', '2026-09-14', '2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19'];
    days.forEach((date, i) => {
      const plan = buildDailyReadingPlan(ctx, date, 'sun-sat-7days');
      expect(plan.dayPortion?.aliyot).toEqual([i + 1]);
    });
  });
});

describe('buildDailyReadingPlan — holiday week with no regular parasha', () => {
  it('returns isRestDay=true for every day, and never invents a portion', () => {
    const ctx = getWeekReadingContext('2026-09-10', 'IL'); // Rosh Hashana week
    const plan = buildDailyReadingPlan(ctx, '2026-09-10', 'sun-fri-6days');
    expect(plan.isRestDay).toBe(true);
    expect(plan.dayPortion).toBeNull();
    expect(plan.weekContext.hasRegularParasha).toBe(false);
  });
});

describe('getPlanVerseCount', () => {
  it('matches the sum of verse counts for the day\'s aliyot', () => {
    const ctx = getWeekReadingContext('2026-09-15', 'IL');
    const monday = buildDailyReadingPlan(ctx, '2026-09-14', 'sun-fri-6days');
    const count = getPlanVerseCount(monday);
    expect(count).toBeGreaterThan(0);
  });

  it('is zero on a rest day', () => {
    const ctx = getWeekReadingContext('2026-09-10', 'IL');
    const plan = buildDailyReadingPlan(ctx, '2026-09-10', 'sun-fri-6days');
    expect(getPlanVerseCount(plan)).toBe(0);
  });
});
