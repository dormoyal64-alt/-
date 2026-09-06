import type { AliyahNumber, CommentaryEntry, DailyReadingPlan, ShnayimMikraVerse, TextAttribution } from '@/types';
import { getAliyotRangesForParasha } from '@/services/calendar/readingDivision';
import { getOriginalCommentaryForAliyah } from './commentaryData';
import type { TorahTextProvider } from './TorahTextProvider';

export interface AliyahContent {
  aliyah: AliyahNumber;
  verses: ShnayimMikraVerse[];
  commentary?: CommentaryEntry;
}

export interface DayReadingContent {
  plan: DailyReadingPlan;
  aliyot: AliyahContent[];
  totalVerses: number;
  mikraAttribution: TextAttribution;
  targumAttribution: TextAttribution;
}

/**
 * Fetches and assembles everything the Reading screen needs for one day:
 * the verses (mikra x2 + targum) grouped by aliyah, each with its short
 * explanation when available.
 */
export async function buildDayReadingContent(
  plan: DailyReadingPlan,
  provider: TorahTextProvider,
  opts: { nikud: boolean }
): Promise<DayReadingContent | null> {
  if (!plan.dayPortion || !plan.weekContext.parasha) return null;

  const { range, aliyot } = plan.dayPortion;
  const result = await provider.getVersesForRange(range, opts);

  const parashaIds = plan.weekContext.parasha.ids;
  const aliyaRanges = getAliyotRangesForParasha(parashaIds);

  const aliyotContent: AliyahContent[] = aliyot.map((aliyahNum) => {
    const aliyahRange = aliyaRanges[aliyahNum];
    const verses = result.verses.filter((v) => {
      const afterStart =
        v.ref.chapter > aliyahRange.start.chapter ||
        (v.ref.chapter === aliyahRange.start.chapter && v.ref.verse >= aliyahRange.start.verse);
      const beforeEnd =
        v.ref.chapter < aliyahRange.end.chapter ||
        (v.ref.chapter === aliyahRange.end.chapter && v.ref.verse <= aliyahRange.end.verse);
      return afterStart && beforeEnd;
    });
    return {
      aliyah: aliyahNum,
      verses,
      commentary: getOriginalCommentaryForAliyah(parashaIds, aliyahNum),
    };
  });

  return {
    plan,
    aliyot: aliyotContent,
    totalVerses: result.verses.length,
    mikraAttribution: result.mikraAttribution,
    targumAttribution: result.targumAttribution,
  };
}
