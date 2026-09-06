import type { TorahBook, VerseRange, VerseRef } from '@/types';

/** Sefaria's ref-path spelling for each Torah book (used in API URLs). */
export const SEFARIA_BOOK_SLUG: Record<TorahBook, string> = {
  Genesis: 'Genesis',
  Exodus: 'Exodus',
  Leviticus: 'Leviticus',
  Numbers: 'Numbers',
  Deuteronomy: 'Deuteronomy',
};

/** Sefaria's node name for Targum Onkelos on a given Torah book. */
export const SEFARIA_ONKELOS_SLUG: Record<TorahBook, string> = {
  Genesis: 'Onkelos_Genesis',
  Exodus: 'Onkelos_Exodus',
  Leviticus: 'Onkelos_Leviticus',
  Numbers: 'Onkelos_Numbers',
  Deuteronomy: 'Onkelos_Deuteronomy',
};

/**
 * Builds a Sefaria API ref for a verse range, e.g. "Genesis.4.19-5.24".
 * Sefaria's text API accepts ranges that span chapters in this form.
 */
export function buildSefariaRangeRef(slug: string, range: VerseRange): string {
  const { start, end } = range;
  if (start.chapter === end.chapter) {
    return `${slug}.${start.chapter}.${start.verse}-${end.verse}`;
  }
  return `${slug}.${start.chapter}.${start.verse}-${end.chapter}.${end.verse}`;
}

/**
 * Reconstructs individual verse refs + text for a (possibly multi-chapter)
 * Sefaria range response. Sefaria returns a flat array of strings for a
 * single-chapter range, and an array-of-arrays (one per chapter) for a
 * range spanning multiple chapters — the first chapter starts at
 * `start.verse` and the last ends at `end.verse`; chapters in between are
 * returned in full.
 */
export function flattenSefariaRange(
  book: TorahBook,
  range: VerseRange,
  raw: unknown
): Array<{ ref: VerseRef; text: string }> {
  const out: Array<{ ref: VerseRef; text: string }> = [];
  if (!Array.isArray(raw)) return out;

  const isNested = raw.length > 0 && Array.isArray(raw[0]);
  if (!isNested) {
    // Single chapter: raw[i] corresponds to verse (start.verse + i)
    (raw as string[]).forEach((text, i) => {
      out.push({
        ref: { book, chapter: range.start.chapter, verse: range.start.verse + i },
        text,
      });
    });
    return out;
  }

  (raw as string[][]).forEach((chapterVerses, chapterIdx) => {
    const chapter = range.start.chapter + chapterIdx;
    chapterVerses.forEach((text, i) => {
      // Only the first returned chapter is offset by start.verse; Sefaria
      // returns full chapters (from verse 1) for everything after that.
      const verse = chapterIdx === 0 ? range.start.verse + i : i + 1;
      out.push({ ref: { book, chapter, verse }, text });
    });
  });
  return out;
}

export function verseRefLabelHe(ref: VerseRef, bookHe: string): string {
  return `${bookHe} ${ref.chapter}:${ref.verse}`;
}
