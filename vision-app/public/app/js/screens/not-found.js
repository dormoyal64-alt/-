// @ts-check
/** 404 route. */
import { h } from '../core/dom.js';
import { emptyState, linkButton } from '../shell/components.js';

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const loggedIn = !!ctx.store.get().user;
  return {
    el: h('div', { class: 'va-page', 'data-testid': 'screen-404' }, emptyState({
      iconName: 'help', title: ctx.t('notFoundTitle'), body: ctx.t('notFoundBody'),
      actions: [linkButton(ctx.t('goHome'), loggedIn ? '#/home' : '#/welcome', { iconName: 'home' })],
    })),
  };
}
