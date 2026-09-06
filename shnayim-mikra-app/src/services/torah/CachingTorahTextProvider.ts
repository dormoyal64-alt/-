import type { VerseRange } from '@/types';
import { getCachedRange, setCachedRange } from '@/services/storage/textCacheRepo';
import type { TorahRangeResult, TorahTextProvider } from './TorahTextProvider';

/**
 * Wraps any TorahTextProvider with an offline-first cache: once a range has
 * been fetched, it is stored locally and served without a network call.
 * This is what makes "download the parasha once, read all week offline"
 * possible without the rest of the app knowing about caching at all.
 */
export class CachingTorahTextProvider implements TorahTextProvider {
  readonly id: string;
  readonly displayNameHe: string;

  constructor(private readonly inner: TorahTextProvider) {
    this.id = inner.id;
    this.displayNameHe = inner.displayNameHe;
  }

  async getVersesForRange(range: VerseRange, opts: { nikud: boolean }): Promise<TorahRangeResult> {
    const cached = await getCachedRange(range, opts.nikud);
    if (cached) return cached;

    const fresh = await this.inner.getVersesForRange(range, opts);
    await setCachedRange(range, opts.nikud, fresh);
    return fresh;
  }
}
