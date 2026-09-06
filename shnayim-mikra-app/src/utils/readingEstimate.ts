/** Rough reading-time estimate: mikra read twice + targum once, at a slow, attentive pace. */
const SECONDS_PER_VERSE_PASS = 9;
const PASSES_PER_VERSE = 3; // mikra, mikra, targum

export function estimateReadingMinutes(verseCount: number): number {
  const seconds = verseCount * SECONDS_PER_VERSE_PASS * PASSES_PER_VERSE;
  return Math.max(1, Math.round(seconds / 60));
}
