import type { Country, DailyReadingPlan, IsoDate, ReadingDivisionSchemeId } from '@/types';
import { getWeekReadingContext } from './parasha';
import { buildDailyReadingPlan } from './readingDivision';

export * from './hebrewCalendar';
export * from './parasha';
export * from './readingDivision';

/** Main orchestrator: everything the UI needs to know "what do I read today". */
export function getDailyReadingPlan(
  date: IsoDate,
  country: Country,
  schemeId: ReadingDivisionSchemeId
): DailyReadingPlan {
  const weekContext = getWeekReadingContext(date, country);
  return buildDailyReadingPlan(weekContext, date, schemeId);
}
