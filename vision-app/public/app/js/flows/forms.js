// @ts-check
/**
 * Onboarding forms rendered inside the stage: intro (what the check does / doesn't do), profile basics and the
 * optional prescription form. Each returns a Promise that resolves with the user's input.
 */
import { h, s, clear } from '../core/dom.js';
import { icon } from '../shell/icons.js';
import { isMinor, ADULT_AGE } from './onboarding-plan.js';
import { textField, radioGroup, checkboxField, actionButton, notice, formAlert, pageHeader } from '../shell/components.js';
import { validateRx, formatRxValue, RX_FIELDS, RX_EYES, RX_RULES } from './rx.js';

/** @typedef {(key: string, params?: Record<string, string|number>) => string} T */
/** @typedef {import('./onboarding-plan.js').Basics} Basics */
/** @typedef {import('../core/types.js').Rx} Rx */
/** @typedef {import('./onboarding-plan.js').CorrectionMode} CorrectionMode */

/** @param {HTMLElement} body */
function focusHeading(body) {
  /** @type {HTMLElement|null} */ (body.querySelector('h1'))?.focus({ preventScroll: true });
}

/**
 * @param {HTMLElement} body @param {T} t
 * @returns {Promise<void>}
 */
export function introForm(body, t) {
  return new Promise((resolve) => {
    const list = (/** @type {string[]} */ keys, /** @type {string} */ ic, /** @type {string} */ cls) => h('ul', { class: `va-checklist ${cls}` },
      keys.map((k) => h('li', null, icon(ic, { size: 20 }), h('span', null, t(k)))));
    clear(body);
    body.append(h('div', { class: 'va-page va-flow', 'data-testid': 'onboarding-intro' },
      pageHeader({ title: t('intro.title'), lead: t('intro.lead') }),
      h('div', { class: 'va-grid-2' },
        h('section', { class: 'va-card' }, h('h2', { class: 'va-card__title' }, t('intro.doesTitle')), list(['intro.does1', 'intro.does2', 'intro.does3'], 'check', 'is-yes')),
        h('section', { class: 'va-card' }, h('h2', { class: 'va-card__title' }, t('intro.doesntTitle')), list(['intro.doesnt1', 'intro.doesnt2', 'intro.doesnt3'], 'close', 'is-no')),
      ),
      notice('warning', t('intro.urgent')),
      h('section', { class: 'va-card va-card--soft' }, h('h2', { class: 'va-card__title' }, t('intro.prepTitle')),
        list(['intro.prep1', 'intro.prep2', 'intro.prep3', 'intro.prep4'], 'sparkle', '')),
      h('div', { class: 'va-actions' }, actionButton(t('intro.start'), { testId: 'intro-start', className: 'va-btn--lg', onClick: () => resolve() })),
    ));
    focusHeading(body);
  });
}

/**
 * "How do you want to use your phone?" — without glasses/lenses (recommended, preselected) or with them.
 * When the age is already known to be under 18 (e.g. a retest of a child's profile) only "with glasses" is offered.
 * @param {HTMLElement} body @param {T} t
 * @param {{initial?: CorrectionMode|null, age?: number|null}} opts
 * @returns {Promise<CorrectionMode>}
 */
export function modeForm(body, t, { initial = null, age = null }) {
  return new Promise((resolve) => {
    const minor = isMinor(age);
    const options = [
      { value: 'none', label: t('mode.none'), hint: t('mode.noneHint') },
      { value: 'wear', label: t('mode.wear'), hint: t('mode.wearHint') },
    ].filter((o) => !minor || o.value === 'wear');
    const choice = radioGroup({
      legend: t('mode.legend'), name: 'correctionMode', testId: 'mode', value: minor ? 'wear' : initial === 'wear' ? 'wear' : 'none', options,
    });
    const badge = h('span', { class: 'va-badge va-badge--rec', 'data-testid': 'mode-recommended' }, t('mode.recommended'));
    if (!minor) choice.el.querySelector('.va-choice__option .va-choice__label')?.after(' ', badge);
    const submit = actionButton(t('mode.continue'), { type: 'submit', testId: 'mode-continue', className: 'va-btn--block' });
    const form = h('form', { class: 'va-form', novalidate: true },
      choice.el,
      minor ? notice('info', t('mode.minor'), { testId: 'mode-minor', iconName: 'info' }) : null,
      submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      resolve(!minor && choice.value === 'none' ? 'none' : 'wear');
    });
    clear(body);
    body.append(h('div', { class: 'va-page va-page--narrow va-flow', 'data-testid': 'onboarding-mode' },
      pageHeader({ title: t('mode.title'), lead: t('mode.lead') }),
      h('div', { class: 'va-card va-card--form' }, form),
      h('p', { class: 'va-hint' }, t('mode.honest'))));
    focusHeading(body);
  });
}

/**
 * @param {HTMLElement} body @param {T} t
 * @param {Partial<Basics>} initial
 * @param {CorrectionMode} mode  the mode chosen just before (an age under 18 switches a 'none' choice to 'wear')
 * @returns {Promise<Basics>}
 */
export function basicsForm(body, t, initial, mode = 'none') {
  return new Promise((resolve) => {
    const alert = formAlert();
    const name = textField({ label: t('basics.name'), name: 'profileName', required: true, value: initial.name ?? '', hint: t('basics.nameHint'), testId: 'basics-name', maxlength: 40, autocomplete: 'off' });
    const age = textField({
      label: t('basics.age'), name: 'age', type: 'number', inputmode: 'numeric', required: true, min: 5, max: 110, step: 1,
      value: initial.age ?? '', hint: t('basics.ageHint'), testId: 'basics-age', dir: 'ltr',
    });
    // Under 18: never guide a child to take prescribed glasses off. Explained kindly, as soon as the age is typed.
    const minorNote = notice('info', t('basics.minor', { age: ADULT_AGE }), { testId: 'minor-note', iconName: 'info', role: 'status' });
    const glassesNote = notice('info', t('basics.glassesOn'), { testId: 'glasses-note', iconName: 'eye' });
    const syncNotes = () => {
      const a = Number(age.input.value);
      const minor = age.input.value.trim() !== '' && Number.isInteger(a) && a >= 5 && isMinor(a);
      minorNote.hidden = !(minor && mode === 'none');
    };
    glassesNote.hidden = mode !== 'wear';
    age.input.addEventListener('input', syncNotes);
    syncNotes();
    const glare = radioGroup({
      legend: t('basics.glare'), name: 'lightSensitivity', testId: 'basics-glare', hint: t('basics.glareHint'),
      value: initial.lightSensitivity || 'normal',
      options: [
        { value: 'low', label: t('basics.glareLow') },
        { value: 'normal', label: t('basics.glareNormal') },
        { value: 'high', label: t('basics.glareHigh') },
      ],
    });
    const hasRx = checkboxField({ name: 'hasRx', label: t('basics.hasRx'), checked: !!initial.hasRx, testId: 'basics-hasrx' });
    const submit = actionButton(t('basics.continue'), { type: 'submit', testId: 'basics-continue', className: 'va-btn--block' });
    const form = h('form', { class: 'va-form', novalidate: true }, alert.el, name.el, age.el, minorNote, glassesNote, glare.el, hasRx.el, submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = name.input.value.trim();
      const a = Number(age.input.value);
      const ageOk = age.input.value.trim() !== '' && Number.isInteger(a) && a >= 5 && a <= 110;
      name.setError(n ? null : t('basics.errName'));
      age.setError(ageOk ? null : t('basics.errAge'));
      if (!n) { name.input.focus(); return; }
      if (!ageOk) { age.input.focus(); return; }
      const ls = glare.value === 'low' || glare.value === 'high' ? glare.value : 'normal';
      resolve({ name: n.slice(0, 40), age: a, lightSensitivity: ls, hasRx: hasRx.input.checked });
    });
    clear(body);
    body.append(h('div', { class: 'va-page va-page--narrow va-flow', 'data-testid': 'onboarding-basics' },
      pageHeader({ title: t('basics.title'), lead: t('basics.lead') }),
      h('div', { class: 'va-card va-card--form' }, form)));
    focusHeading(body);
  });
}

/** Face with the glasses lifted off (decorative; the text says it all). */
function glassesOffIllustration() {
  return s('svg', { viewBox: '0 0 200 170', width: '180', height: '153', 'aria-hidden': 'true', class: 'va-glasses-off__ill' },
    s('ellipse', { cx: '100', cy: '100', rx: '62', ry: '66', class: 'va-ill-face' }),
    s('ellipse', { cx: '76', cy: '96', rx: '12', ry: '8', class: 'va-ill-eye' }),
    s('circle', { cx: '76', cy: '96', r: '4.5', class: 'va-ill-pupil' }),
    s('ellipse', { cx: '124', cy: '96', rx: '12', ry: '8', class: 'va-ill-eye' }),
    s('circle', { cx: '124', cy: '96', r: '4.5', class: 'va-ill-pupil' }),
    s('path', { d: 'M82 135 Q100 146 118 135', class: 'va-ill-mouth' }),
    // Glasses, lifted above the head
    s('g', { class: 'va-ill-glasses' },
      s('rect', { x: '52', y: '12', width: '40', height: '28', rx: '12' }),
      s('rect', { x: '108', y: '12', width: '40', height: '28', rx: '12' }),
      s('path', { d: 'M92 24 Q100 18 108 24' }),
      s('path', { d: 'M52 22 L38 18' }),
      s('path', { d: 'M148 22 L162 18' })),
    // "Up and away" arrows
    s('path', { d: 'M100 70 V50 M92 58 L100 50 L108 58', class: 'va-ill-arrow' }),
  );
}

/**
 * Glasses-free mode: "Take your glasses off" before the viewing distance and the eye checks.
 * @param {HTMLElement} body @param {T} t
 * @returns {Promise<'continue'|'later'>}  later = wearing contact lenses now: stop and continue another time
 */
export function glassesOffForm(body, t) {
  return new Promise((resolve) => {
    const list = h('ul', { class: 'va-checklist' },
      ['glassesOff.glasses', 'glassesOff.lenses', 'glassesOff.hold'].map((k) => h('li', null, icon('check', { size: 20 }), h('span', null, t(k)))));
    clear(body);
    body.append(h('div', { class: 'va-page va-page--narrow va-flow', 'data-testid': 'glasses-off' },
      h('div', { class: 'va-illustration' }, glassesOffIllustration()),
      pageHeader({ title: t('glassesOff.title'), lead: t('glassesOff.lead') }),
      h('section', { class: 'va-card va-card--soft' }, list),
      h('p', { class: 'va-hint' }, t('glassesOff.honest')),
      h('div', { class: 'va-actions' },
        actionButton(t('glassesOff.continue'), { testId: 'glasses-off-continue', className: 'va-btn--lg', iconName: 'check', onClick: () => resolve('continue') }),
        actionButton(t('glassesOff.later'), { variant: 'secondary', testId: 'glasses-off-later', onClick: () => resolve('later') }),
      )));
    focusHeading(body);
  });
}

/**
 * @param {HTMLElement} body @param {T} t
 * @param {{right?: Rx, left?: Rx}|null} initial
 * @returns {Promise<{right?: Rx, left?: Rx}>} {} when skipped
 */
export function rxForm(body, t, initial) {
  return new Promise((resolve) => {
    const alert = formAlert();
    /** @type {Record<string, ReturnType<typeof textField>>} */
    const fields = {};
    const eyeBlock = (/** @type {'right'|'left'} */ eye) => h('fieldset', { class: 'va-rx__eye', 'data-testid': `rx-${eye}` },
      h('legend', { class: 'va-label' }, t(`rx.${eye}`)),
      h('div', { class: 'va-rx__grid' }, RX_FIELDS.map((f) => {
        const rule = RX_RULES[f];
        const tf = textField({
          label: t(`rx.${f}`), name: `rx-${eye}-${f}`, inputmode: f === 'axis' ? 'numeric' : 'decimal', dir: 'ltr',
          value: formatRxValue(f, initial?.[eye]?.[f]), hint: t(`rx.hint.${f}`), testId: `rx-${eye}-${f}`,
          placeholder: f === 'axis' ? `${rule.min}–${rule.max}` : '0.00', autocomplete: 'off',
        });
        fields[`${eye}.${f}`] = tf;
        return tf.el;
      })),
    );
    const save = actionButton(t('rx.save'), { type: 'submit', testId: 'rx-save' });
    const skip = actionButton(t('rx.skip'), { variant: 'secondary', testId: 'rx-skip', onClick: () => resolve({}) });
    const form = h('form', { class: 'va-form', novalidate: true }, alert.el,
      h('div', { class: 'va-rx' }, eyeBlock('right'), eyeBlock('left')),
      h('div', { class: 'va-actions va-actions--row' }, save, skip));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      /** @type {Record<string, Record<string, string>>} */
      const raw = { right: {}, left: {} };
      for (const eye of RX_EYES) for (const f of RX_FIELDS) raw[eye][f] = fields[`${eye}.${f}`].input.value;
      const res = validateRx(raw);
      let first = null;
      for (const [key, tf] of Object.entries(fields)) {
        const err = res.errors[key];
        tf.setError(err ? t(`rx.err.${err}`) : null);
        if (err && !first) first = tf.input;
      }
      if (!res.valid) { alert.set(t('rx.fix')); first?.focus(); return; }
      resolve(res.rx);
    });
    clear(body);
    body.append(h('div', { class: 'va-page va-flow', 'data-testid': 'onboarding-rx' },
      pageHeader({ title: t('rx.title'), lead: t('rx.lead') }),
      h('div', { class: 'va-card va-card--form' }, form)));
    focusHeading(body);
  });
}
