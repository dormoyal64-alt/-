import type { TorahBook, VerseRange, VerseRef } from '@/types';
import type { TorahRangeResult } from '@/services/torah/TorahTextProvider';
import { getItem, setItem, getAllKeysWithPrefix, multiRemove } from './LocalStore';

const PREFIX = 'textCache:';
const MANIFEST_KEY = 'textCacheManifest';

function rangeKey(range: VerseRange, nikud: boolean): string {
  const { start, end } = range;
  return `${PREFIX}${start.book}:${start.chapter}.${start.verse}-${end.chapter}.${end.verse}:n${nikud ? 1 : 0}`;
}

interface ManifestEntry {
  key: string;
  book: TorahBook;
  nikud: boolean;
  start: VerseRef;
  end: VerseRef;
}

async function getManifest(): Promise<ManifestEntry[]> {
  return (await getItem<ManifestEntry[]>(MANIFEST_KEY)) ?? [];
}

async function addToManifest(entry: ManifestEntry): Promise<void> {
  const manifest = await getManifest();
  if (manifest.some((e) => e.key === entry.key)) return;
  manifest.push(entry);
  await setItem(MANIFEST_KEY, manifest);
}

function refLte(a: VerseRef, b: VerseRef): boolean {
  return a.chapter < b.chapter || (a.chapter === b.chapter && a.verse <= b.verse);
}

function contains(outer: { start: VerseRef; end: VerseRef }, inner: VerseRange): boolean {
  return refLte(outer.start, inner.start) && refLte(inner.end, outer.end);
}

function sliceVerses(result: TorahRangeResult, range: VerseRange): TorahRangeResult {
  const verses = result.verses.filter((v) => {
    const afterStart =
      v.ref.chapter > range.start.chapter ||
      (v.ref.chapter === range.start.chapter && v.ref.verse >= range.start.verse);
    const beforeEnd =
      v.ref.chapter < range.end.chapter || (v.ref.chapter === range.end.chapter && v.ref.verse <= range.end.verse);
    return afterStart && beforeEnd;
  });
  return { ...result, verses };
}

/**
 * Looks up an exact cache hit first, then falls back to any larger cached
 * range (e.g. a whole parasha prefetched at the start of the week) that
 * fully contains the requested range, slicing it down locally. This is what
 * lets a single "download this week" prefetch serve every individual day's
 * reading offline.
 */
export async function getCachedRange(
  range: VerseRange,
  nikud: boolean
): Promise<TorahRangeResult | null> {
  const exact = await getItem<TorahRangeResult>(rangeKey(range, nikud));
  if (exact) return exact;

  const manifest = await getManifest();
  const book = range.start.book as TorahBook;
  const containing = manifest.find(
    (e) => e.book === book && e.nikud === nikud && contains(e, range)
  );
  if (!containing) return null;
  const full = await getItem<TorahRangeResult>(containing.key);
  return full ? sliceVerses(full, range) : null;
}

export async function setCachedRange(
  range: VerseRange,
  nikud: boolean,
  result: TorahRangeResult
): Promise<void> {
  const key = rangeKey(range, nikud);
  await setItem(key, result);
  await addToManifest({ key, book: range.start.book as TorahBook, nikud, start: range.start, end: range.end });
}

/** Marks a Hebrew week (by its Shabbat ISO date) as fully cached for offline use. */
export async function markWeekCached(shabbatDate: string): Promise<void> {
  await setItem(`weekCached:${shabbatDate}`, true);
}

export async function isWeekCached(shabbatDate: string): Promise<boolean> {
  return Boolean(await getItem<boolean>(`weekCached:${shabbatDate}`));
}

/** Clears cached text older than the given number of days, to bound storage growth. */
export async function pruneOldCache(keepWeekShabbatDates: string[]): Promise<void> {
  const keys = await getAllKeysWithPrefix('weekCached:');
  const toRemove = keys.filter((k) => !keepWeekShabbatDates.some((d) => k.endsWith(d)));
  if (toRemove.length) await multiRemove(toRemove);
}
