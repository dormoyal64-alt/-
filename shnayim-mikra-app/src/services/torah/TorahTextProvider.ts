import type { ShnayimMikraVerse, TextAttribution, VerseRange } from '@/types';

export interface TorahRangeResult {
  verses: ShnayimMikraVerse[];
  mikraAttribution: TextAttribution;
  targumAttribution: TextAttribution;
}

/**
 * Everything the app needs from "a place that has Torah + Targum Onkelos
 * text". Kept as an interface so the underlying source (Sefaria today) can
 * be swapped later without touching screens/hooks — per the requirement to
 * never hard-wire a single external API into the app.
 */
export interface TorahTextProvider {
  readonly id: string;
  readonly displayNameHe: string;
  getVersesForRange(range: VerseRange, opts: { nikud: boolean }): Promise<TorahRangeResult>;
}
