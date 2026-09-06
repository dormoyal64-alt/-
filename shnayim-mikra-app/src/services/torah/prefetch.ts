import type { WeekReadingContext } from '@/types';
import { getAliyotRangesForParasha, mergeAliyot } from '@/services/calendar/readingDivision';
import { isWeekCached, markWeekCached } from '@/services/storage/textCacheRepo';
import type { TorahTextProvider } from './TorahTextProvider';

/**
 * Downloads the entire week's parasha (all 7 aliyot, mikra + targum) in one
 * shot and stores it via the provider's cache decorator, so the rest of the
 * week can be read fully offline. Safe to call repeatedly — it no-ops once
 * the week is already cached.
 */
export async function prefetchWeek(
  weekContext: WeekReadingContext,
  provider: TorahTextProvider,
  nikud: boolean
): Promise<{ cached: boolean; reason?: string }> {
  if (!weekContext.hasRegularParasha || !weekContext.parasha) {
    return { cached: false, reason: 'no-regular-parasha-this-week' };
  }
  if (await isWeekCached(weekContext.shabbatDate)) {
    return { cached: true };
  }

  const ranges = getAliyotRangesForParasha(weekContext.parasha.ids);
  const fullRange = mergeAliyot(ranges, [1, 2, 3, 4, 5, 6, 7]);
  if (!fullRange) return { cached: false, reason: 'no-aliyot-data' };

  await provider.getVersesForRange(fullRange, { nikud });
  await markWeekCached(weekContext.shabbatDate);
  return { cached: true };
}
