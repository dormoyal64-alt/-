// @ts-check
/**
 * #/register — email, password (show/hide + strength hint), language, REQUIRED Terms/Privacy acceptance and the
 * not-a-medical-device acknowledgement. On success the free month starts and onboarding begins.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { ACCOUNT_STRINGS } from './strings.js';
import { api } from './api.js';
import { errorKey } from './errors.js';
import { passwordStrength, looksLikeEmail, PASSWORD_MIN } from './password.js';
import { brandName, legalUrl } from '../shell/brand.js';
import { SHELL_STRINGS } from '../shell/strings.js';
import { pageHeader, textField, passwordField, checkboxField, radioGroup, actionButton, formAlert, setBusy } from '../shell/components.js';

const ACK_KEY = 'va.disclaimerAck';

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(ACCOUNT_STRINGS, ctx.lang);
  const ts = makeT(SHELL_STRINGS, ctx.lang);
  const brand = brandName(ctx.lang);
  const alert = formAlert();

  const email = textField({ label: t('auth.email'), name: 'email', type: 'email', autocomplete: 'email', required: true, inputmode: 'email', testId: 'register-email', dir: 'ltr' });
  const password = passwordField({
    label: t('auth.password'), name: 'new-password', autocomplete: 'new-password', showLabel: t('auth.showPassword'), hideLabel: t('auth.hidePassword'),
    testId: 'register-password', hint: t('register.pwHint'),
  });
  const meterFill = h('span', { class: 'va-meter__fill' });
  const meterText = h('span', { class: 'va-meter__text', 'aria-live': 'polite', 'data-testid': 'pw-strength' });
  const meter = h('div', { class: 'va-meter', dataset: { score: '0' } }, h('span', { class: 'va-meter__bar', 'aria-hidden': 'true' }, meterFill), meterText);
  password.el.appendChild(meter);
  password.input.addEventListener('input', () => {
    const { score, key } = passwordStrength(password.input.value);
    meter.dataset.score = String(score);
    meterFill.style.width = `${key === 'empty' ? 0 : Math.max(10, score * 25)}%`;
    meterText.textContent = key === 'empty' ? '' : t(`pw.${key}`);
    if (password.input.value.length >= PASSWORD_MIN) password.setError(null);
  });

  const lang = radioGroup({
    legend: t('register.lang'), name: 'lang', value: ctx.lang, testId: 'register-lang', className: 'va-choice--inline',
    options: [{ value: 'he', label: 'עברית', lang: 'he' }, { value: 'en', label: 'English', lang: 'en' }],
  });

  const extLink = (/** @type {string} */ href, /** @type {string} */ label) => h('a', { href, target: '_blank', rel: 'noopener noreferrer' },
    label, h('span', { class: 'va-visually-hidden' }, ' ' + ts('newWindow')));
  const terms = checkboxField({
    name: 'acceptTerms', required: true, testId: 'register-terms',
    label: [t('register.terms.before'), extLink(legalUrl('terms', ctx.lang), t('register.terms.terms')), t('register.terms.and'), extLink(legalUrl('privacy', ctx.lang), t('register.terms.privacy'))],
    onChange: (on) => { if (on) terms.setError(null); },
  });
  const ack = checkboxField({
    name: 'acceptDisclaimer', required: true, testId: 'register-disclaimer',
    label: [t('register.disclaimer', { brand }), ' ', extLink(legalUrl('disclaimer', ctx.lang), '(' + t('account.legal') + ')')],
    onChange: (on) => { if (on) ack.setError(null); },
  });

  const submit = actionButton(t('register.submit'), { type: 'submit', testId: 'register-submit', className: 'va-btn--block' });
  const form = h('form', { class: 'va-form', novalidate: true, 'data-testid': 'register-form' },
    alert.el,
    h('p', { class: 'va-hint' }, t('auth.required')),
    email.el, password.el, lang.el,
    h('div', { class: 'va-consents' }, terms.el, ack.el),
    submit,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.set(null);
    const emailVal = email.input.value.trim();
    const pw = password.input.value;
    /** @type {Array<[boolean, () => void]>} */
    const checks = [
      [looksLikeEmail(emailVal), () => { email.setError(t('v.email')); email.input.focus(); }],
      [pw.length >= PASSWORD_MIN, () => { password.setError(t('v.password')); password.input.focus(); }],
      [terms.input.checked, () => { terms.setError(t('v.terms')); terms.input.focus(); }],
      [ack.input.checked, () => { ack.setError(t('v.disclaimer')); ack.input.focus(); }],
    ];
    email.setError(null); password.setError(null); terms.setError(null); ack.setError(null);
    const failed = checks.filter(([ok]) => !ok);
    if (failed.length) {
      // Mark every invalid field, focus the first one.
      for (let i = failed.length - 1; i >= 0; i--) failed[i][1]();
      alert.set(t('auth.fixErrors'));
      return;
    }
    const chosenLang = lang.value === 'en' ? 'en' : 'he';
    setBusy(submit, true);
    try {
      const res = await api.register({ email: emailVal, password: pw, lang: chosenLang, acceptTerms: true });
      if (ctx.signal.aborted) return;
      try { localStorage.setItem(ACK_KEY, new Date().toISOString()); } catch { /* ignore */ }
      ctx.shell.session.setAuth(res);
      ctx.shell.toast(makeT(ACCOUNT_STRINGS, chosenLang)('register.success'), { kind: 'success' });
      if (chosenLang !== ctx.lang) ctx.store.set({ lang: chosenLang });
      ctx.navigate('/onboarding', { replace: true });
    } catch (err) {
      if (ctx.signal.aborted) return;
      const key = errorKey(err);
      alert.set(t(key));
      if (key === 'err.emailTaken' || key === 'err.email') { email.setError(t(key)); email.input.focus(); } else if (key === 'err.weakPassword' || key === 'err.commonPassword' || key === 'err.longPassword') { password.setError(t(key)); password.input.focus(); }
    } finally {
      setBusy(submit, false);
    }
  });

  const el = h('div', { class: 'va-page va-page--narrow', 'data-testid': 'screen-register' },
    pageHeader({ title: t('register.title'), lead: t('register.lead') }),
    h('div', { class: 'va-card va-card--form' }, form),
    h('p', { class: 'va-switch-auth' }, t('register.haveAccount'), ' ', h('a', { href: '#/login' }, t('register.login'))),
  );
  return { el };
}
