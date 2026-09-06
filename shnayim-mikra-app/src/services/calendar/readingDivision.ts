/**
 * Divides a parasha into daily shnayim-mikra portions.
 *
 * The verse boundaries of the 7 aliyot come from @hebcal/leyning's
 * `getLeyningForParsha`, which encodes the standard Torah-reading aliyah
 * divisions (a primary, sourced dataset, not invented here). What IS a
 * matter of custom — and therefore configurable, never presented as the
 * one true answer — is which day of the week each aliyah is read on for
 * shnayim mikra purposes. Two commonly cited customs are offered; see
 * `READING_DIVISION_SCHEMES` for sources.
 */
import { getLeyningForParsha } from '@hebcal/leyning';
import type {
  AliyahNumber,
  DailyReadingPlan,
  DayPortion,
  ReadingDivisionSchemeId,
  TorahBook,
  VerseRange,
  VerseRef,
  WeekReadingContext,
} from '@/types';
import { hebrewWeekDayOfWeek, DAY_NAMES_HE_1_TO_7 } from './hebrewCalendar';

export interface ReadingDivisionScheme {
  id: ReadingDivisionSchemeId;
  nameHe: string;
  descriptionHe: string;
  sourceNoteHe: string;
  /** Maps Hebrew-week day (1=Sunday..7=Saturday) to the aliyot read that day, or [] for a rest day. */
  dayToAliyot: Record<number, AliyahNumber[]>;
}

export const READING_DIVISION_SCHEMES: Record<ReadingDivisionSchemeId, ReadingDivisionScheme> = {
  'sun-fri-6days': {
    id: 'sun-fri-6days',
    nameHe: 'מנהג א׳ — סיום לפני שבת',
    descriptionHe:
      'עלייה אחת ליום מיום ראשון עד חמישי, ושתי העליות האחרונות (ו-ז) ביום שישי, כדי לסיים את כל הקריאה לפני כניסת שבת.',
    sourceNoteHe:
      'מבוסס על חלוקת שבע העליות המסורתית של הפרשה. זהו מנהג נפוץ ולא פסק הלכה מחייב — יש הנוהגים אחרת.',
    dayToAliyot: {
      1: [1],
      2: [2],
      3: [3],
      4: [4],
      5: [5],
      6: [6, 7],
      7: [],
    },
  },
  'sun-sat-7days': {
    id: 'sun-sat-7days',
    nameHe: 'מנהג ב׳ — פריסה על כל השבוע',
    descriptionHe:
      'עלייה אחת בכל יום מימות השבוע, כאשר העלייה השביעית והאחרונה נקראת בשבת עצמה (למשל בסמוך לקריאת התורה).',
    sourceNoteHe:
      'מבוסס על חלוקת שבע העליות המסורתית של הפרשה. זהו מנהג נפוץ ולא פסק הלכה מחייב — יש הנוהגים אחרת.',
    dayToAliyot: {
      1: [1],
      2: [2],
      3: [3],
      4: [4],
      5: [5],
      6: [6],
      7: [7],
    },
  },
};

function parseVerseRef(book: TorahBook, chapterVerse: string): VerseRef {
  const [chapter, verse] = chapterVerse.split(':').map(Number);
  return { book, chapter, verse };
}

/** Returns the full ordered list of verse ranges (aliyot 1-7) for a parasha. */
export function getAliyotRangesForParasha(parashaIds: string[]): Record<AliyahNumber, VerseRange> {
  const leyning = getLeyningForParsha(parashaIds);
  const result = {} as Record<AliyahNumber, VerseRange>;
  for (let i = 1; i <= 7; i++) {
    const aliyah = leyning.fullkriyah[String(i)];
    if (!aliyah) continue;
    const book = aliyah.k as TorahBook;
    result[i as AliyahNumber] = {
      start: parseVerseRef(book, aliyah.b),
      end: parseVerseRef(book, aliyah.e),
    };
  }
  return result;
}

/** Verse count per aliyah (1-7), as reported by the leyning dataset — avoids a network fetch just to size the UI. */
export function getAliyotVerseCounts(parashaIds: string[]): Record<AliyahNumber, number> {
  const leyning = getLeyningForParsha(parashaIds);
  const result = {} as Record<AliyahNumber, number>;
  for (let i = 1; i <= 7; i++) {
    const aliyah = leyning.fullkriyah[String(i)];
    if (aliyah?.v) result[i as AliyahNumber] = aliyah.v;
  }
  return result;
}

/** Merges one or more contiguous aliyot into a single verse range. */
export function mergeAliyot(
  ranges: Record<AliyahNumber, VerseRange>,
  aliyot: AliyahNumber[]
): VerseRange | null {
  if (aliyot.length === 0) return null;
  const sorted = [...aliyot].sort((a, b) => a - b);
  return {
    start: ranges[sorted[0]].start,
    end: ranges[sorted[sorted.length - 1]].end,
  };
}

export function getDayPortion(
  weekContext: WeekReadingContext,
  date: string,
  schemeId: ReadingDivisionSchemeId
): DayPortion | null {
  if (!weekContext.hasRegularParasha || !weekContext.parasha) return null;
  const dow = hebrewWeekDayOfWeek(date);
  const scheme = READING_DIVISION_SCHEMES[schemeId];
  const aliyot = scheme.dayToAliyot[dow] ?? [];
  if (aliyot.length === 0) return null;

  const ranges = getAliyotRangesForParasha(weekContext.parasha.ids);
  const range = mergeAliyot(ranges, aliyot);
  if (!range) return null;

  return {
    dayOfWeek: dow,
    dayNameHe: DAY_NAMES_HE_1_TO_7[dow - 1],
    aliyot,
    range,
  };
}

export function getPlanVerseCount(plan: { weekContext: WeekReadingContext; dayPortion: DayPortion | null }): number {
  if (!plan.dayPortion || !plan.weekContext.parasha) return 0;
  const counts = getAliyotVerseCounts(plan.weekContext.parasha.ids);
  return plan.dayPortion.aliyot.reduce((sum, a) => sum + (counts[a] ?? 0), 0);
}

export function buildDailyReadingPlan(
  weekContext: WeekReadingContext,
  date: string,
  schemeId: ReadingDivisionSchemeId
): DailyReadingPlan {
  const dayPortion = getDayPortion(weekContext, date, schemeId);
  return {
    date,
    weekContext,
    schemeId,
    dayPortion,
    isRestDay: dayPortion === null,
  };
}
