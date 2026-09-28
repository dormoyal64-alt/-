// @ts-check
/**
 * #/reset (request a link) and #/reset-password?token=… (choose a new password, from the email link).
 * The request always shows the same confirmation (no user enumeration).
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { ACCOUNT_STRINGS } from './strings.js';
import { api } from './api.js';
import { errorKey } from './errors.js';
import { looksLikeEmail, PASSWORD_MIN, passwordStrength } from './password.js';
import { pageHeader, textField, passwordField, actionButton, formAlert, setBusy, notice, linkButton } from '../shell/components.js';

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(ACCOUNT_STRINGS, ctx.lang);
  const token = ctx.route.query.token;
  const el = h('div', { class: 'va-page va-page--narrow', 'data-testid': 'screen-reset' });
  if (token) renderConfirm(); else renderRequest();
  return { el };

  function renderRequest() {
    const alert = formAlert();
    const email = textField({ label: t('auth.email'), name: 'email', type: 'email', autocomplete: 'email', required: true, inputmode: 'email', testId: 'reset-email', dir: 'ltr' });
    const submit = actionButton(t('reset.submit'), { type: 'submit', testId: 'reset-submit', className: 'va-btn--block' });
    const form = h('form', { class: 'va-form', novalidate: true }, alert.el, email.el, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alert.set(null);
      const value = email.input.value.trim();
      if (!looksLikeEmail(value)) { email.setError(t('v.email')); email.input.focus(); return; }
      email.setError(null);
      setBusy(submit, true);
      try {
        await api.requestPasswordReset(value);
        if (ctx.signal.aborted) return;
        el.replaceChildren(
          pageHeader({ title: t('reset.sentTitle') }),
          notice('success', t('reset.sent', { email: value }), { role: 'status', testId: 'reset-sent' }),
          h('div', { class: 'va-actions' }, linkButton(t('reset.backToLogin'), '#/login', { variant: 'secondary' })),
        );
        /** @type {HTMLElement|null} */ (el.querySelector('h1'))?.focus();
      } catch (err) {
        if (!ctx.signal.aborted) alert.set(t(errorKey(err)));
      } finally {
        setBusy(submit, false);
      }
    });
    el.replaceChildren(
      pageHeader({ title: t('reset.title'), lead: t('reset.lead') }),
      h('div', { class: 'va-card va-card--form' }, form),
      h('p', { class: 'va-switch-auth' }, h('a', { href: '#/login' }, t('reset.backToLogin'))),
    );
  }

  function renderConfirm() {
    const alert = formAlert();
    const password = passwordField({
      label: t('auth.newPassword'), name: 'new-password', autocomplete: 'new-password', showLabel: t('auth.showPassword'), hideLabel: t('auth.hidePassword'),
      testId: 'reset-password', hint: t('register.pwHint'),
    });
    const strength = h('p', { class: 'va-hint', 'aria-live': 'polite' });
    password.el.appendChild(strength);
    password.input.addEventListener('input', () => {
      const { key } = passwordStrength(password.input.value);
      strength.textContent = key === 'empty' ? '' : t(`pw.${key}`);
    });
    const submit = actionButton(t('reset.newSubmit'), { type: 'submit', testId: 'reset-confirm', className: 'va-btn--block' });
    const form = h('form', { class: 'va-form', novalidate: true }, alert.el, password.el, submit);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      alert.set(null);
      const pw = password.input.value;
      if (pw.length < PASSWORD_MIN) { password.setError(t('v.password')); password.input.focus(); return; }
      password.setError(null);
      setBusy(submit, true);
      try {
        await api.confirmPasswordReset(token, pw);
        if (ctx.signal.aborted) return;
        ctx.shell.toast(t('reset.done'), { kind: 'success' });
        ctx.navigate('/login', { replace: true });
      } catch (err) {
        if (!ctx.signal.aborted) alert.set(t(errorKey(err)));
      } finally {
        setBusy(submit, false);
      }
    });
    el.replaceChildren(
      pageHeader({ title: t('reset.newTitle'), lead: t('reset.newLead') }),
      h('div', { class: 'va-card va-card--form' }, form),
    );
  }
}
