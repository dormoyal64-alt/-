// @ts-check
/**
 * #/profiles — switch / rename / re-test / delete / add profiles (e.g. family members on a shared tablet).
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { listProfiles, getActiveProfile, setActiveProfileId, saveProfile, deleteProfile, onProfilesChanged } from '../core/storage.js';
import { SCREEN_STRINGS } from './strings.js';
import { formatDate } from '../shell/format.js';
import { icon } from '../shell/icons.js';
import { openDialog } from '../shell/dialog.js';
import { pageHeader, linkButton, actionButton, textField, emptyState } from '../shell/components.js';

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(SCREEN_STRINGS, ctx.lang);
  const list = h('ul', { class: 'va-profiles', role: 'list', 'data-testid': 'profiles-list' });

  const render = () => {
    const profiles = listProfiles();
    const active = getActiveProfile();
    if (!profiles.length) {
      list.replaceChildren(h('li', null, emptyState({ iconName: 'users', title: t('profiles.empty'), headingLevel: 2 })));
      return;
    }
    list.replaceChildren(...profiles.map((p) => {
      const isActive = active?.id === p.id;
      const initial = (p.name || '?').trim().charAt(0).toUpperCase();
      return h('li', { class: `va-profile${isActive ? ' is-active' : ''}`, 'data-testid': `profile-${p.id}` },
        h('div', { class: 'va-profile__head' },
          h('span', { class: 'va-avatar', 'aria-hidden': 'true' }, initial),
          h('div', { class: 'va-profile__meta' },
            h('h2', { class: 'va-profile__name' }, p.name),
            h('p', { class: 'va-hint' }, t('profiles.updated', { date: formatDate(p.updatedAt, ctx.lang) }))),
          isActive ? h('span', { class: 'va-badge va-badge--active' }, icon('check', { size: 16 }), t('profiles.active')) : null),
        h('div', { class: 'va-profile__actions', role: 'group', 'aria-label': t('profiles.actionsFor', { name: p.name }) },
          !isActive ? actionButton(t('profiles.use'), {
            testId: `profile-use-${p.id}`,
            onClick: () => { setActiveProfileId(p.id); ctx.shell.applyAdaptation(); ctx.shell.toast(t('profiles.switched', { name: p.name }), { kind: 'success' }); },
          }) : null,
          actionButton(t('profiles.rename'), { variant: 'secondary', iconName: 'edit', testId: `profile-rename-${p.id}`, onClick: () => void rename(p.id) }),
          linkButton(t('profiles.retest'), `#/onboarding?retest=${encodeURIComponent(p.id)}`, { variant: 'secondary', iconName: 'retest' }),
          actionButton(t('profiles.delete'), { variant: 'ghost', iconName: 'trash', className: 'va-btn--danger-text', testId: `profile-delete-${p.id}`, onClick: () => void remove(p.id) }),
        ));
    }));
  };

  /** @param {string} id */
  async function rename(id) {
    const p = listProfiles().find((x) => x.id === id);
    if (!p) return;
    const nameField = textField({ label: t('profiles.nameLabel'), name: 'profileName', value: p.name, maxlength: 40, testId: 'rename-input', autocomplete: 'off' });
    const ok = await openDialog({
      title: t('profiles.renameTitle'), body: [nameField.el], dismissValue: false, testId: 'rename-dialog', initialFocus: nameField.input,
      actions: [
        { label: ctx.t('cancel'), value: false, variant: 'secondary' },
        { label: t('profiles.save'), value: true, variant: 'primary', submit: true, testId: 'rename-save' },
      ],
      onSubmit: () => {
        const v = nameField.input.value.trim();
        if (!v || v.length > 40) { nameField.setError(t('profiles.nameError')); nameField.input.focus(); return false; }
        return true;
      },
    });
    if (!ok) return;
    saveProfile({ ...p, name: nameField.input.value.trim(), updatedAt: p.updatedAt });
    ctx.shell.toast(t('profiles.renamed'), { kind: 'success' });
  }

  /** @param {string} id */
  async function remove(id) {
    const p = listProfiles().find((x) => x.id === id);
    if (!p) return;
    const ok = await ctx.shell.confirm({
      title: t('profiles.deleteTitle', { name: p.name }), body: t('profiles.deleteBody'), confirmLabel: t('profiles.deleteConfirm'),
      cancelLabel: ctx.t('cancel'), danger: true, testId: 'delete-profile-dialog',
    });
    if (!ok) return;
    deleteProfile(id);
    ctx.shell.applyAdaptation();
    ctx.shell.toast(t('profiles.deleted'));
  }

  render();
  const off = onProfilesChanged(render);
  const el = h('div', { class: 'va-page', 'data-testid': 'screen-profiles' },
    pageHeader({ title: t('profiles.title'), lead: t('profiles.lead') }),
    list,
    h('div', { class: 'va-actions' }, linkButton(t('profiles.add'), '#/onboarding?new=1', { iconName: 'plus', testId: 'profiles-add' })),
  );
  return { el, destroy: off };
}
