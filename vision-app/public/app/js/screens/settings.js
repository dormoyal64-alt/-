// @ts-check
/**
 * #/settings — language (re-renders), theme, "Adapt this app to my profile", delete all on-device data.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { clearAllLocalData, getActiveProfile } from '../core/storage.js';
import { SCREEN_STRINGS } from './strings.js';
import { APP_VERSION } from '../shell/brand.js';
import { getTheme, setTheme, getAdaptUi, setAdaptUi } from '../shell/prefs.js';
import { pageHeader, radioGroup, switchField, card, linkButton, actionButton } from '../shell/components.js';
import { glassesFreeInfo } from './summary.js';

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(SCREEN_STRINGS, ctx.lang);
  const active = getActiveProfile();
  const hasProfile = !!active;
  const glassesFree = !!glassesFreeInfo(active);
  const { user } = ctx.store.get();

  const lang = radioGroup({
    legend: t('settings.language'), name: 'lang', value: ctx.lang, testId: 'settings-lang', className: 'va-choice--inline',
    options: [{ value: 'he', label: 'עברית', lang: 'he' }, { value: 'en', label: 'English', lang: 'en' }],
    onChange: (v) => { ctx.store.set({ lang: v === 'en' ? 'en' : 'he' }); },
  });
  const theme = radioGroup({
    legend: t('settings.theme'), name: 'theme', value: getTheme(), testId: 'settings-theme',
    options: [{ value: 'auto', label: t('settings.themeAuto') }, { value: 'light', label: t('settings.themeLight') }, { value: 'dark', label: t('settings.themeDark') }],
    onChange: (v) => {
      setTheme(v === 'light' || v === 'dark' ? v : 'auto');
      ctx.shell.applyAdaptation({ force: true });
      ctx.shell.announce(t('settings.saved'));
    },
  });
  const adapt = switchField({
    label: t('settings.adapt'),
    description: hasProfile ? `${t('settings.adaptDesc')}${glassesFree ? ' ' + t('settings.adaptGlassesFree') : ''}` : t('settings.adaptNoProfile'),
    checked: hasProfile && getAdaptUi(), disabled: !hasProfile, testId: 'settings-adapt',
    onChange: (on) => {
      setAdaptUi(on);
      ctx.shell.applyAdaptation({ force: true });
      ctx.shell.announce(on ? t('settings.adaptOn') : t('settings.adaptOff'));
    },
  });

  async function deleteAll() {
    const ok = await ctx.shell.confirm({
      title: t('settings.deleteTitle'), body: t('settings.deleteBody'), confirmLabel: t('settings.deleteConfirm'), cancelLabel: ctx.t('cancel'),
      danger: true, testId: 'delete-data-dialog',
    });
    if (!ok) return;
    const keepLang = ctx.lang;
    clearAllLocalData();
    try { await caches?.delete?.('va-share-v1'); } catch { /* ignore */ }
    ctx.shell.applyAdaptation({ force: true });
    ctx.shell.toast(makeT(SCREEN_STRINGS, keepLang)('settings.deleted'), { kind: 'success' });
    // The session cookie survives; the entitlement cache is gone, so re-check before routing.
    await ctx.shell.session.refresh();
    ctx.goDefault();
  }

  const el = h('div', { class: 'va-page', 'data-testid': 'screen-settings' },
    pageHeader({ title: t('settings.title') }),
    h('div', { class: 'va-grid-2' },
      card({ children: [lang.el, theme.el], testId: 'settings-display' }),
      card({ children: adapt.el, testId: 'settings-adapt-card' }),
      user ? card({
        title: t('settings.links'), iconName: 'settings',
        children: h('ul', { class: 'va-linklist' },
          h('li', null, h('a', { href: '#/account' }, t('settings.account'))),
          h('li', null, h('a', { href: '#/profiles' }, t('settings.profiles'))),
          h('li', null, h('a', { href: '#/help' }, t('settings.help')))),
      }) : card({ children: linkButton(t('settings.help'), '#/help', { variant: 'secondary', iconName: 'help' }) }),
      card({
        title: t('settings.dataTitle'), iconName: 'lock', className: 'va-card--danger',
        children: h('p', { class: 'va-text' }, t('settings.dataLead')),
        actions: [actionButton(t('settings.deleteData'), { variant: 'danger', iconName: 'trash', testId: 'settings-delete-data', onClick: () => void deleteAll() })],
      }),
    ),
    h('p', { class: 'va-hint va-center-text' }, t('settings.version', { version: APP_VERSION })),
  );
  return { el };
}
