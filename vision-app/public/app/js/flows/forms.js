// @ts-check
/**
 * Onboarding forms rendered inside the stage: intro (what the check does / doesn't do), profile basics and the
 * optional prescription form. Each returns a Promise that resolves with the user's input.
 */
import { h, clear } from '../core/dom.js';
import { icon } from '../shell/icons.js';
import { textField, radioGroup, checkboxField, actionButton, notice, formAlert, pageHeader } from '../shell/components.js';
import { validateRx, formatRxValue, RX_FIELDS, RX_EYES, RX_RULES } from './rx.js';

/** @typedef {(key: string, params?: Record<string, string|number>) => string} T */
/** @typedef {import('./onboarding-plan.js').Basics} Basics */
/** @typedef {import('../core/types.js').Rx} Rx */

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
 * @param {HTMLElement} body @param {T} t
 * @param {Partial<Basics>} initial
 * @returns {Promise<Basics>}
 */
export function basicsForm(body, t, initial) {
  return new Promise((resolve) => {
    const alert = formAlert();
    const name = textField({ label: t('basics.name'), name: 'profileName', required: true, value: initial.name ?? '', hint: t('basics.nameHint'), testId: 'basics-name', maxlength: 40, autocomplete: 'off' });
    const age = textField({
      label: t('basics.age'), name: 'age', type: 'number', inputmode: 'numeric', required: true, min: 5, max: 110, step: 1,
      value: initial.age ?? '', hint: t('basics.ageHint'), testId: 'basics-age', dir: 'ltr',
    });
    const glassesNote = notice('info', t('basics.glassesOn'), { testId: 'glasses-note', iconName: 'eye' });
    glassesNote.hidden = initial.wearsCorrection !== true;
    const glasses = radioGroup({
      legend: t('basics.glasses'), name: 'wearsCorrection', required: true, testId: 'basics-glasses', className: 'va-choice--inline',
      value: initial.wearsCorrection === true ? 'yes' : initial.wearsCorrection === false ? 'no' : null,
      options: [{ value: 'yes', label: t('basics.yes') }, { value: 'no', label: t('basics.no') }],
      onChange: (v) => { glassesNote.hidden = v !== 'yes'; glasses.setError(null); },
    });
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
    const form = h('form', { class: 'va-form', novalidate: true }, alert.el, name.el, age.el, glasses.el, glassesNote, glare.el, hasRx.el, submit);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = name.input.value.trim();
      const a = Number(age.input.value);
      const ageOk = age.input.value.trim() !== '' && Number.isInteger(a) && a >= 5 && a <= 110;
      name.setError(n ? null : t('basics.errName'));
      age.setError(ageOk ? null : t('basics.errAge'));
      glasses.setError(glasses.value ? null : t('basics.errGlasses'));
      if (!n) { name.input.focus(); return; }
      if (!ageOk) { age.input.focus(); return; }
      if (!glasses.value) { glasses.focus(); return; }
      const ls = glare.value === 'low' || glare.value === 'high' ? glare.value : 'normal';
      resolve({ name: n.slice(0, 40), age: a, wearsCorrection: glasses.value === 'yes', lightSensitivity: ls, hasRx: hasRx.input.checked });
    });
    clear(body);
    body.append(h('div', { class: 'va-page va-page--narrow va-flow', 'data-testid': 'onboarding-basics' },
      pageHeader({ title: t('basics.title'), lead: t('basics.lead') }),
      h('div', { class: 'va-card va-card--form' }, form)));
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
