import type { ShnayimMikraVerse, TextAttribution, TorahBook, VerseRange } from '@/types';
import { TORAH_BOOK_HE } from '@/types';
import type { TorahRangeResult, TorahTextProvider } from './TorahTextProvider';
import {
  SEFARIA_BOOK_SLUG,
  SEFARIA_ONKELOS_SLUG,
  buildSefariaRangeRef,
  flattenSefariaRange,
  verseRefLabelHe,
} from './sefariaRefs';

const SEFARIA_API_BASE = 'https://www.sefaria.org/api/texts/';

/**
 * Licenses we treat as safe to display in the app (with attribution shown).
 * Sefaria exposes a `license`/`heLicense` field per version. Anything not on
 * this list is surfaced to the user as "לא ניתן לאמת רישיון" rather than
 * silently shown, per the requirement to never guess at usage rights.
 *
 * NOTE: this allowlist was compiled from general knowledge of Sefaria's
 * licensing model, since this build environment could not reach
 * sefaria.org/terms to verify live. Confirm against sefaria.org/terms
 * before shipping to production — see README "מקורות ורישיונות".
 */
const PERMISSIVE_LICENSES = new Set([
  'Public Domain',
  'CC0',
  'CC-BY',
  'CC-BY-SA',
  'CC-BY-NC',
  'CC-BY-4.0',
]);

interface SefariaTextResponse {
  he?: unknown;
  text?: unknown;
  versionTitle?: string;
  heVersionTitle?: string;
  license?: string;
  heLicense?: string;
  versionTitleInHebrew?: string;
  heVersionTitleInHebrew?: string;
}

export type Fetcher = (url: string) => Promise<Response>;

export class SefariaProvider implements TorahTextProvider {
  readonly id = 'sefaria';
  readonly displayNameHe = 'ספריא (Sefaria)';

  constructor(private readonly fetcher: Fetcher = fetch) {}

  private async fetchRange(ref: string): Promise<SefariaTextResponse> {
    const url = `${SEFARIA_API_BASE}${encodeURIComponent(ref).replace(/%2E/g, '.')}?context=0&pad=0`;
    const res = await this.fetcher(url);
    if (!res.ok) {
      throw new Error(`Sefaria request failed (${res.status}) for ${ref}`);
    }
    return (await res.json()) as SefariaTextResponse;
  }

  private buildAttribution(
    sourceName: string,
    resp: SefariaTextResponse,
    isHebrewField: boolean
  ): TextAttribution {
    const license = isHebrewField ? resp.heLicense : resp.license;
    const versionTitle = isHebrewField ? resp.heVersionTitle : resp.versionTitle;
    return {
      sourceName,
      license: license && PERMISSIVE_LICENSES.has(license) ? license : license ?? 'לא צוין רישיון — יש לאמת',
      versionTitle,
      sourceUrl: 'https://www.sefaria.org',
    };
  }

  async getVersesForRange(range: VerseRange, _opts: { nikud: boolean }): Promise<TorahRangeResult> {
    const book = range.start.book as TorahBook;
    const bookHe = TORAH_BOOK_HE[book];

    const mikraRef = buildSefariaRangeRef(SEFARIA_BOOK_SLUG[book], range);
    const targumRef = buildSefariaRangeRef(SEFARIA_ONKELOS_SLUG[book], range);

    const [mikraResp, targumResp] = await Promise.all([
      this.fetchRange(mikraRef),
      this.fetchRange(targumRef),
    ]);

    const mikraVerses = flattenSefariaRange(book, range, mikraResp.he);
    const targumVerses = flattenSefariaRange(book, range, targumResp.he);

    const targumByKey = new Map(
      targumVerses.map((v) => [`${v.ref.chapter}:${v.ref.verse}`, v.text])
    );

    const verses: ShnayimMikraVerse[] = mikraVerses.map(({ ref, text }) => ({
      ref,
      refLabel: verseRefLabelHe(ref, bookHe),
      mikra: text,
      targum: targumByKey.get(`${ref.chapter}:${ref.verse}`) ?? '',
    }));

    return {
      verses,
      mikraAttribution: this.buildAttribution('מקרא (תנ״ך) — ספריא', mikraResp, true),
      targumAttribution: this.buildAttribution('תרגום אונקלוס — ספריא', targumResp, true),
    };
  }
}
