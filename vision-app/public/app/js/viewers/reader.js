// @ts-check
/**
 * Reader: shows pasted/typed (or provided) text with the profile's typography, adjustable size, reading colour
 * themes and read-aloud (Web Speech) with sentence highlighting. Text is rendered with textContent only.
 */
import { h, clear } from '../core/dom.js';
import { makeT, dirFor, formatNumber } from '../core/i18n.js';
import { structureText, pickVoice } from './reader-text.js';
import { ensureViewerStyles, createDisposer, iconButton, setButtonIcon, uniqueId } from './viewer-kit.js';

/** @typedef {'profile'|'bw'|'wb'|'yb'|'sepia'} ReaderTheme */

const STRINGS = {
  he: {
    title: 'קורא טקסט',
    inputLabel: 'הדביקו או הקלידו טקסט',
    inputHint: 'אפשר להדביק טקסט מכל מקום — הודעה, מייל או כתבה.',
    paste: 'הדבקה',
    pasteFailed: 'לא הצלחנו לקרוא מהלוח. לחצו לחיצה ארוכה בתיבה ובחרו ״הדבקה״.',
    show: 'הצגה לקריאה',
    edit: 'עריכת הטקסט',
    empty: 'אין עדיין טקסט להצגה.',
    smaller: 'הקטנת הטקסט',
    larger: 'הגדלת הטקסט',
    sizeLabel: 'גודל הטקסט',
    sizeNow: 'גודל הטקסט {p}',
    theme: 'צבעי קריאה',
    theme_profile: 'לפי הפרופיל',
    theme_bw: 'שחור על לבן',
    theme_wb: 'לבן על שחור',
    theme_yb: 'צהוב על שחור',
    theme_sepia: 'ספיה',
    readAloud: 'הקראה',
    resume: 'המשך הקראה',
    pause: 'השהיה',
    stop: 'עצירה',
    noSpeech: 'הדפדפן הזה אינו תומך בהקראה.',
    noVoice_he: 'לא נמצא קול בעברית במכשיר. אפשר להוסיף קול בהגדרות ״המרת טקסט לדיבור״ של המכשיר.',
    noVoice_en: 'לא נמצא קול באנגלית במכשיר. אפשר להוסיף קול בהגדרות ״המרת טקסט לדיבור״ של המכשיר.',
    speaking: 'מקריא…',
    paused: 'ההקראה מושהית.',
    stopped: 'ההקראה נעצרה.',
    finished: 'ההקראה הסתיימה.',
    textRegion: 'הטקסט לקריאה',
  },
  en: {
    title: 'Reader',
    inputLabel: 'Paste or type text',
    inputHint: 'Paste text from anywhere — a message, an email or an article.',
    paste: 'Paste',
    pasteFailed: 'Couldn’t read the clipboard. Long-press in the box and choose “Paste”.',
    show: 'Show for reading',
    edit: 'Edit text',
    empty: 'There is no text to show yet.',
    smaller: 'Smaller text',
    larger: 'Larger text',
    sizeLabel: 'Text size',
    sizeNow: 'Text size {p}',
    theme: 'Reading colours',
    theme_profile: 'My profile',
    theme_bw: 'Black on white',
    theme_wb: 'White on black',
    theme_yb: 'Yellow on black',
    theme_sepia: 'Sepia',
    readAloud: 'Read aloud',
    resume: 'Resume',
    pause: 'Pause',
    stop: 'Stop',
    noSpeech: 'This browser can’t read text aloud.',
    noVoice_he: 'No Hebrew voice is installed on this device. You can add one in the device’s text-to-speech settings.',
    noVoice_en: 'No English voice is installed on this device. You can add one in the device’s text-to-speech settings.',
    speaking: 'Reading aloud…',
    paused: 'Reading paused.',
    stopped: 'Reading stopped.',
    finished: 'Finished reading.',
    textRegion: 'Text to read',
  },
};

const THEMES = /** @type {ReaderTheme[]} */ (['profile', 'bw', 'wb', 'yb', 'sepia']);
const SIZE_STEPS = [50, 60, 70, 80, 90, 100, 115, 130, 150, 175, 200, 250, 300, 400];

/**
 * @param {HTMLElement} container
 * @param {{lang?: import('../core/types.js').Lang, profile?: import('../core/types.js').VisionProfile|null, text?: string, signal?: AbortSignal}} [options]
 * @returns {{destroy: () => void}}
 */
export function mountReader(container, options = {}) {
  const { lang = 'he', profile = null, text: initialText = '', signal } = options;
  const doc = container.ownerDocument;
  const win = doc.defaultView || window;
  ensureViewerStyles(doc);
  const t = makeT(STRINGS, lang);
  const d = createDisposer();
  const tp = profile?.text;
  const num = (/** @type {unknown} */ v, /** @type {number} */ f, /** @type {number} */ lo, /** @type {number} */ hi) =>
    (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : f);
  const typo = {
    basePx: num(tp?.baseFontPx, 18, 10, 96),
    weight: Math.round(num(tp?.fontWeight, 400, 100, 900)),
    lineHeight: num(tp?.lineHeight, 1.6, 1, 3),
    letter: num(tp?.letterSpacingEm, 0, -0.05, 0.5),
    word: num(tp?.wordSpacingEm, 0, -0.1, 1),
  };
  let sizePct = 100;
  /** @type {ReaderTheme} */ let theme = 'profile';
  let text = String(initialText || '');
  let destroyed = false;

  const status = h('p', { class: 'va-viewer__status', role: 'status', 'aria-live': 'polite', 'data-testid': 'reader-status' });
  const say = (/** @type {string} */ msg) => { status.textContent = msg; };

  // ---------- editor ----------
  const taId = uniqueId('va-reader-ta');
  const taHint = uniqueId('va-reader-hint');
  const textarea = h('textarea', { id: taId, class: 'va-input va-reader__textarea', dir: 'auto', 'aria-describedby': taHint, 'data-testid': 'reader-input', spellcheck: 'false' });
  textarea.value = text;
  const clip = /** @type {any} */ (win.navigator).clipboard;
  const pasteBtn = typeof clip?.readText === 'function'
    ? iconButton({ icon: 'paste', label: t('paste'), showLabel: true, testId: 'reader-paste', onClick: () => { void paste(); } })
    : null;
  const showBtn = iconButton({ icon: 'eye', label: t('show'), showLabel: true, variant: 'primary', testId: 'reader-show', className: 'va-viewer__grow', onClick: () => showReading() });
  const editor = h('div', { class: 'va-stack', 'data-testid': 'reader-editor' },
    h('label', { for: taId, class: 'va-label' }, t('inputLabel')),
    h('p', { id: taHint, class: 'va-hint' }, t('inputHint')),
    textarea,
    h('div', { class: 'va-viewer__row' }, pasteBtn, showBtn));

  // ---------- reading view ----------
  const sizeOut = h('output', { class: 'va-reader__size', 'aria-live': 'polite', 'data-testid': 'reader-size' });
  const smallerBtn = iconButton({ icon: 'minus', label: t('smaller'), testId: 'reader-smaller', onClick: () => stepSize(-1) });
  const largerBtn = iconButton({ icon: 'plus', label: t('larger'), testId: 'reader-larger', onClick: () => stepSize(1) });
  const themeName = uniqueId('va-reader-theme');
  const themeInputs = THEMES.map((th) => {
    const inp = h('input', { type: 'radio', name: themeName, value: th, checked: th === theme, 'data-testid': `reader-theme-${th}` });
    inp.addEventListener('change', () => { if (inp.checked) setTheme(th); });
    return h('label', { class: `va-choice va-choice--${th}` }, inp, h('span', null, t(`theme_${th}`)));
  });
  const themes = h('fieldset', { class: 'va-choices' }, h('legend', null, t('theme')), h('div', { class: 'va-choices__grid' }, ...themeInputs));
  const playBtn = iconButton({ icon: 'speak', label: t('readAloud'), showLabel: true, variant: 'primary', testId: 'reader-play', className: 'va-viewer__grow', onClick: () => onPlay() });
  const stopBtn = iconButton({ icon: 'stop', label: t('stop'), testId: 'reader-stop', disabled: true, onClick: () => stopSpeech(true) });
  const editBtn = iconButton({ icon: 'edit', label: t('edit'), showLabel: true, testId: 'reader-edit', onClick: () => showEditor() });
  const surface = h('article', { class: 'va-reader__surface', tabindex: '0', 'aria-label': t('textRegion'), 'data-testid': 'reader-surface' });
  const toolbar = h('div', { class: 'va-reader__toolbar' },
    h('div', { class: 'va-viewer__row', role: 'group', 'aria-label': t('sizeLabel') }, smallerBtn, sizeOut, largerBtn, h('span', { class: 'va-viewer__grow' }), editBtn),
    h('div', { class: 'va-viewer__row' }, playBtn, stopBtn));
  const reading = h('div', { class: 'va-stack', hidden: true, 'data-testid': 'reader-reading' }, toolbar, surface, themes);

  const root = h('section', { class: 'va-viewer va-reader', dir: dirFor(lang), lang, 'data-testid': 'reader', 'aria-label': t('title') },
    h('div', { class: 'va-viewer__bar' }, h('h2', { class: 'va-viewer__title' }, t('title'))),
    editor, reading, status);
  clear(container);
  container.appendChild(root);

  // ---------- typography & theme ----------
  function applyTypography() {
    const st = surface.style;
    st.fontSize = `${Math.round(typo.basePx * sizePct) / 100}px`;
    st.fontWeight = String(typo.weight);
    st.lineHeight = String(typo.lineHeight);
    st.letterSpacing = `${typo.letter}em`;
    st.wordSpacing = `${typo.word}em`;
    const p = formatNumber(sizePct / 100, lang, { style: 'percent' });
    sizeOut.textContent = p;
    sizeOut.setAttribute('aria-label', t('sizeNow', { p }));
    smallerBtn.disabled = sizePct <= SIZE_STEPS[0];
    largerBtn.disabled = sizePct >= SIZE_STEPS[SIZE_STEPS.length - 1];
  }
  /** @param {number} dir */
  function stepSize(dir) {
    const i = SIZE_STEPS.findIndex((v) => v >= sizePct);
    const cur = i < 0 ? SIZE_STEPS.length - 1 : i;
    sizePct = SIZE_STEPS[Math.max(0, Math.min(SIZE_STEPS.length - 1, cur + dir))];
    applyTypography();
  }
  /** @param {ReaderTheme} th */
  function setTheme(th) {
    THEMES.forEach((x) => root.classList.remove(`va-reader--${x}`));
    theme = th;
    if (th !== 'profile') root.classList.add(`va-reader--${th}`);
  }
  applyTypography();

  // ---------- content ----------
  /** @type {{el: HTMLSpanElement, speak: string, lang: 'he'|'en'}[]} */
  let sentences = [];
  function renderText() {
    const s = structureText(text);
    sentences = [];
    surface.replaceChildren(...s.paragraphs.map((para) => h('p', { dir: 'auto' }, ...para.flatMap((sen, i) => {
      const el = h('span', { class: 'va-reader__sentence' });
      el.textContent = sen.text;
      sentences.push({ el, speak: sen.speak, lang: sen.lang });
      return i < para.length - 1 && !/\s$/.test(sen.text) ? [el, ' '] : [el];
    }))));
    surface.setAttribute('lang', s.lang);
    playBtn.disabled = !speechOk || sentences.length === 0;
  }

  function showReading() {
    text = textarea.value;
    if (!text.trim()) { say(t('empty')); textarea.focus(); return; }
    stopSpeech(false);
    renderText();
    editor.hidden = true;
    reading.hidden = false;
    root.dataset.mode = 'reading';
    say('');
    surface.focus({ preventScroll: true });
  }
  function showEditor() {
    stopSpeech(false);
    textarea.value = text;
    reading.hidden = true;
    editor.hidden = false;
    root.dataset.mode = 'editing';
    textarea.focus();
  }
  async function paste() {
    try {
      const txt = await clip.readText();
      if (destroyed) return;
      if (txt) textarea.value = textarea.value ? `${textarea.value}\n${txt}` : txt;
    } catch {
      if (!destroyed) say(t('pasteFailed'));
    }
  }

  // ---------- speech ----------
  const synth = /** @type {SpeechSynthesis|undefined} */ (win.speechSynthesis);
  const speechOk = !!synth && typeof win.SpeechSynthesisUtterance === 'function';
  if (!speechOk) { playBtn.disabled = true; playBtn.title = t('noSpeech'); }
  /** @type {'idle'|'speaking'|'paused'} */ let speech = 'idle';
  let gen = 0;
  let index = 0;
  /** @type {SpeechSynthesisUtterance|null} */ let current = null; // keep a reference (Chrome GC bug)
  let startTimer = 0;
  /** @type {Set<string>} */ const warnedNoVoice = new Set();

  function updateSpeechUi() {
    const speaking = speech === 'speaking';
    setButtonIcon(playBtn, speaking ? 'pause' : 'speak', t(speaking ? 'pause' : speech === 'paused' ? 'resume' : 'readAloud'));
    stopBtn.disabled = speech === 'idle';
    root.dataset.speech = speech;
  }
  /** @param {number} i */
  function highlight(i) {
    sentences.forEach((s, j) => s.el.classList.toggle('is-speaking', j === i));
    const el = sentences[i]?.el;
    if (el) {
      const reduce = win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    }
  }
  /** @param {number} from */
  function speakFrom(from) {
    if (!speechOk || !synth) return;
    const my = ++gen;
    speech = 'speaking';
    updateSpeechUi();
    say(t('speaking'));
    const step = (/** @type {number} */ i) => {
      if (my !== gen || destroyed) return;
      if (i >= sentences.length) { finish(); return; }
      index = i;
      highlight(i);
      const s = sentences[i];
      const u = new win.SpeechSynthesisUtterance(s.speak);
      u.lang = s.lang === 'he' ? 'he-IL' : 'en-US';
      const voices = synth.getVoices();
      const v = pickVoice(voices, s.lang);
      if (v) u.voice = v;
      else if (voices.length && !warnedNoVoice.has(s.lang)) { warnedNoVoice.add(s.lang); say(t(`noVoice_${s.lang}`)); }
      u.onend = () => { if (my === gen) step(i + 1); };
      u.onerror = (e) => {
        if (my !== gen) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        step(i + 1);
      };
      current = u;
      synth.speak(u);
    };
    const busy = synth.speaking || synth.pending;
    synth.cancel();
    // Chrome may drop an utterance queued in the same task as cancel().
    win.clearTimeout(startTimer);
    startTimer = win.setTimeout(() => step(from), busy ? 80 : 0);
  }
  function finish() {
    speech = 'idle';
    index = 0;
    current = null;
    highlight(-1);
    updateSpeechUi();
    say(t('finished'));
  }
  function onPlay() {
    if (speech === 'speaking') {
      // Pause by cancelling and remembering the sentence (speechSynthesis.pause() is unreliable on Android).
      gen++;
      win.clearTimeout(startTimer);
      synth?.cancel();
      speech = 'paused';
      updateSpeechUi();
      say(t('paused'));
      return;
    }
    speakFrom(speech === 'paused' ? index : 0);
  }
  /** @param {boolean} announce */
  function stopSpeech(announce) {
    if (speech === 'idle') return;
    gen++;
    win.clearTimeout(startTimer);
    synth?.cancel();
    speech = 'idle';
    index = 0;
    current = null;
    highlight(-1);
    updateSpeechUi();
    if (announce) say(t('stopped'));
  }
  if (speechOk && synth) synth.getVoices(); // starts asynchronous voice loading; pickVoice reads them at speak time
  updateSpeechUi();

  if (text.trim()) showReading(); else root.dataset.mode = 'editing';

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    signal?.removeEventListener('abort', destroy);
    stopSpeech(false);
    void current;
    d.run();
    root.remove();
  }
  signal?.addEventListener('abort', destroy, { once: true });
  return { destroy };
}
