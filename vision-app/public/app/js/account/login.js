// @ts-check
/**
 * #/login — email + password (show/hide), errors announced, then back to where the user was going.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { ACCOUNT_STRINGS } from './strings.js';
import { api } from './api.js';
import { errorKey } from './errors.js';
import { looksLikeEmail } from './password.js';
import { pageHeader, textField, passwordField, actionButton, formAlert, setBusy } from '../shell/components.js';

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(ACCOUNT_STRINGS, ctx.lang);
  const alert = formAlert();
  const email = textField({ label: t('auth.email'), name: 'email', type: 'email', autocomplete: 'email', required: true, inputmode: 'email', testId: 'login-email', dir: 'ltr' });
  const password = passwordField({ label: t('auth.password'), name: 'password', autocomplete: 'current-password', showLabel: t('auth.showPassword'), hideLabel: t('auth.hidePassword'), testId: 'login-password' });
  const submit = actionButton(t('login.submit'), { type: 'submit', testId: 'login-submit', className: 'va-btn--block' });

  const form = h('form', { class: 'va-form', novalidate: true, 'data-testid': 'login-form' },
    alert.el, email.el, password.el,
    h('p', { class: 'va-form__aside' }, h('a', { href: '#/reset', 'data-testid': 'login-forgot' }, t('login.forgot'))),
    submit,
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alert.set(null);
    const emailVal = email.input.value.trim();
    const pwVal = password.input.value;
    email.setError(looksLikeEmail(emailVal) ? null : t('v.email'));
    password.setError(pwVal ? null : t('v.passwordRequired'));
    if (!looksLikeEmail(emailVal)) { email.input.focus(); return; }
    if (!pwVal) { password.input.focus(); return; }
    setBusy(submit, true);
    try {
      const res = await api.login({ email: emailVal, password: pwVal });
      if (ctx.signal.aborted) return;
      ctx.shell.session.setAuth(res);
      password.input.value = '';
      ctx.goDefault({ useReturn: true });
    } catch (err) {
      if (ctx.signal.aborted) return;
      alert.set(t(errorKey(err)));
      password.input.select();
    } finally {
      setBusy(submit, false);
    }
  });

  const el = h('div', { class: 'va-page va-page--narrow', 'data-testid': 'screen-login' },
    pageHeader({ title: t('login.title'), lead: t('login.lead') }),
    h('div', { class: 'va-card va-card--form' }, form),
    h('p', { class: 'va-switch-auth' }, t('login.noAccount'), ' ', h('a', { href: '#/register', 'data-testid': 'login-to-register' }, t('login.register'))),
  );
  return { el };
}
