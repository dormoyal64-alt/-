// @ts-check
/**
 * Pure text helpers for the reader (no DOM): paragraphs, sentences, language detection, voice choice.
 */

/** @typedef {'he'|'en'} Lang */
/** @typedef {{text: string, speak: string, lang: Lang}} Sentence */

const HEBREW = /[֐-׿יִ-ﭏ]/g;
const LATIN = /[A-Za-zÀ-ɏ]/g;

/**
 * 'he' when the text has at least as many Hebrew letters as Latin ones (and some), else 'en';
 * `fallback` when it has no letters at all.
 * @param {string} text
 * @param {Lang} [fallback]
 * @returns {Lang}
 */
export function detectTextLang(text, fallback = 'en') {
  const he = (String(text).match(HEBREW) || []).length;
  const la = (String(text).match(LATIN) || []).length;
  if (!he && !la) return fallback;
  return he >= la ? 'he' : 'en';
}

/**
 * Paragraphs = non-empty lines (pasted text keeps its line structure).
 * @param {string} text
 * @returns {string[]}
 */
export function splitParagraphs(text) {
  return String(text || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Split one paragraph into sentences. Each item keeps its original text (including trailing spaces) for
 * display and a trimmed `speak` string. Uses Intl.Segmenter when available, a punctuation regex otherwise.
 * @param {string} paragraph
 * @param {Lang} [lang]
 * @returns {string[]}
 */
export function splitSentences(paragraph, lang = 'en') {
  const text = String(paragraph || '');
  if (!text.trim()) return [];
  /** @type {string[]} */
  let parts = [];
  const Seg = /** @type {any} */ (Intl).Segmenter;
  if (typeof Seg === 'function') {
    try {
      const seg = new Seg(lang === 'he' ? 'he' : 'en', { granularity: 'sentence' });
      for (const s of seg.segment(text)) parts.push(s.segment);
    } catch { parts = []; }
  }
  if (!parts.length) parts = text.match(/[^.!?…]+(?:[.!?…]+["'”’»)\]]*|$)\s*/g) || [text];
  // Merge fragments that contain no letters/digits (e.g. a lone "—") into the previous sentence.
  /** @type {string[]} */
  const out = [];
  for (const p of parts) {
    if (out.length && !/[\p{L}\p{N}]/u.test(p)) out[out.length - 1] += p;
    else out.push(p);
  }
  return out.filter((s) => s.trim());
}

/**
 * Full structure used by the reader.
 * @param {string} text
 * @returns {{lang: Lang, paragraphs: Sentence[][]}}
 */
export function structureText(text) {
  const lang = detectTextLang(text, 'he');
  const paragraphs = splitParagraphs(text).map((p) => {
    const pLang = detectTextLang(p, lang);
    return splitSentences(p, pLang).map((s) => ({ text: s, speak: s.trim(), lang: detectTextLang(s, pLang) }));
  });
  return { lang, paragraphs };
}

/**
 * Choose a speech voice for a language: exact locale (he-IL / legacy iw-IL, en-US) first, then any voice of the
 * language; local voices and the platform default are preferred within each group. Null if none.
 * @template {{lang: string, localService?: boolean, default?: boolean}} V
 * @param {V[]} voices
 * @param {Lang} lang
 * @returns {V|null}
 */
export function pickVoice(voices, lang) {
  const norm = (/** @type {string} */ l) => String(l || '').replace('_', '-').toLowerCase();
  const exact = lang === 'he' ? ['he-il', 'iw-il'] : ['en-us'];
  const prefixes = lang === 'he' ? ['he', 'iw'] : ['en'];
  const rank = (/** @type {V} */ v) => (v.localService ? 2 : 0) + (v.default ? 1 : 0);
  const best = (/** @type {V[]} */ list) => (list.length ? list.slice().sort((a, b) => rank(b) - rank(a))[0] : null);
  const list = Array.isArray(voices) ? voices : [];
  return best(list.filter((v) => exact.includes(norm(v.lang))))
    || best(list.filter((v) => prefixes.includes(norm(v.lang).split('-')[0])));
}
