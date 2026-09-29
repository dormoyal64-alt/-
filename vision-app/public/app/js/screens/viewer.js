// @ts-check
/**
 * #/viewer/{photo,video,magnifier,reader} — mounts the matching viewer from js/viewers/* with the active profile,
 * destroys it on route change.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { getActiveProfile } from '../core/storage.js';
import { SCREEN_STRINGS } from './strings.js';
import { loadModule, unavailableState } from '../shell/modules.js';
import { emptyState, linkButton } from '../shell/components.js';
import { takePending } from './handoff.js';

const VIEWERS = {
  photo: { module: 'photoViewer', fn: 'mountPhotoViewer', icon: 'photo' },
  video: { module: 'videoViewer', fn: 'mountVideoViewer', icon: 'video' },
  magnifier: { module: 'liveMagnifier', fn: 'mountLiveMagnifier', icon: 'magnifier' },
  reader: { module: 'reader', fn: 'mountReader', icon: 'reader' },
};

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export async function mount(ctx) {
  const t = makeT(SCREEN_STRINGS, ctx.lang);
  const kind = /** @type {keyof typeof VIEWERS} */ (ctx.params?.kind || 'photo');
  const spec = VIEWERS[kind] || VIEWERS.photo;
  const title = ctx.t(`route.viewer.${kind}`);
  const el = h('div', { class: `va-viewer-host va-viewer-host--${kind}`, 'data-testid': `screen-viewer-${kind}` });
  const profile = getActiveProfile();
  if (!profile) {
    el.append(h('div', { class: 'va-page' }, emptyState({
      iconName: spec.icon, title: t('viewer.needProfileTitle'), body: t('viewer.needProfileBody'), testId: 'viewer-noprofile',
      actions: [linkButton(t('viewer.start'), '#/onboarding')],
    })));
    return { el };
  }
  const res = await loadModule(spec.module, spec.fn);
  if (!res.ok) {
    el.append(h('div', { class: 'va-page' }, unavailableState(ctx.lang, { reason: res.reason, onRetry: () => ctx.shell.refresh(), title })));
    return { el };
  }
  // The viewer module renders its own heading-less UI; give the page a (visually hidden) h1 for focus + SR users.
  const heading = h('h1', { class: 'va-visually-hidden', tabindex: '-1' }, title);
  const container = h('div', { class: 'va-viewer-container' });
  el.append(heading, container);
  const pending = takePending(kind);
  /** @type {{destroy: () => void}|null} */
  let handle = null;
  let destroyed = false;
  // Mount once the host is in the document (the router attaches it after mount() resolves), so the viewer can
  // measure its container.
  const start = async () => {
    if (destroyed) return;
    if (!el.isConnected) { requestAnimationFrame(() => void start()); return; }
    try {
      const hnd = await res.mod[spec.fn](container, { lang: ctx.lang, profile, file: pending?.file, text: pending?.text });
      if (destroyed) hnd?.destroy?.(); else handle = hnd;
    } catch (err) {
      console.warn(`viewer ${kind} failed to mount`, err);
      if (!destroyed) el.replaceChildren(h('div', { class: 'va-page' }, unavailableState(ctx.lang, { reason: 'error', onRetry: () => ctx.shell.refresh(), title })));
    }
  };
  requestAnimationFrame(() => void start());
  return {
    el,
    title,
    destroy() {
      destroyed = true;
      try { handle?.destroy(); } catch (err) { console.warn('viewer destroy failed', err); }
      handle = null;
    },
  };
}
