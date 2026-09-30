// @ts-check
/**
 * #/share — reads what the service worker stored from a Web Share Target POST (Cache API, private key), removes it,
 * and opens the matching viewer (image -> photo, video -> video, text/url -> reader).
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { SCREEN_STRINGS } from './strings.js';
import { brandName } from '../shell/brand.js';
import { emptyState, spinner, pageHeader, actionButton, linkButton } from '../shell/components.js';
import { icon } from '../shell/icons.js';
import { setPending } from './handoff.js';

export const SHARE_CACHE = 'va-share-v1';
export const SHARE_META = '/app/__share/meta';

/**
 * @typedef {{files: Array<{key: string, name: string, type: string}>, title?: string, text?: string, url?: string, at?: string}} ShareMeta
 */

/** @param {{title?: string, text?: string, url?: string}} m */
export function shareText(m) {
  return [m.title, m.text, m.url].map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join('\n\n');
}

/** @param {string} type @returns {'photo'|'video'|null} */
export function viewerForType(type) {
  if (/^image\//.test(type)) return 'photo';
  if (/^video\//.test(type)) return 'video';
  return null;
}

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const t = makeT(SCREEN_STRINGS, ctx.lang);
  const el = h('div', { class: 'va-page', 'data-testid': 'screen-share' }, spinner(t('share.loading')));

  const nothing = () => el.replaceChildren(emptyState({
    iconName: 'photo', title: t('share.nothing'), body: t('share.nothingBody', { brand: brandName(ctx.lang) }), testId: 'share-empty',
    actions: [linkButton(ctx.t('goHome'), '#/home', { variant: 'secondary' })],
  }));

  (async () => {
    if (typeof caches === 'undefined') { nothing(); return; }
    const cache = await caches.open(SHARE_CACHE);
    const metaRes = await cache.match(SHARE_META);
    if (!metaRes) { nothing(); return; }
    /** @type {ShareMeta} */
    const meta = await metaRes.json().catch(() => ({ files: [] }));
    /** @type {File[]} */
    const files = [];
    for (const f of meta.files || []) {
      const r = await cache.match(f.key);
      if (r) files.push(new File([await r.blob()], f.name || 'shared', { type: f.type || r.headers.get('content-type') || '' }));
    }
    // Private: remove everything as soon as it is loaded.
    await Promise.all([cache.delete(SHARE_META), ...(meta.files || []).map((f) => cache.delete(f.key))]);
    if (ctx.signal.aborted) return;

    const open = (/** @type {File} */ file) => {
      const kind = viewerForType(file.type);
      if (!kind) { ctx.shell.toast(t('share.unsupported'), { kind: 'error' }); return; }
      setPending({ kind, file });
      ctx.navigate(`/viewer/${kind}`, { replace: true });
    };
    // Security (SEC-06): any website can POST to the share-target URL, so nothing opens without the user's tap.
    const discard = actionButton(t('share.discard'), { variant: 'ghost', testId: 'share-discard', onClick: () => ctx.navigate('/home', { replace: true }) });
    const supported = files.filter((f) => viewerForType(f.type));
    if (supported.length === 1) {
      const f = supported[0];
      el.replaceChildren(
        pageHeader({ title: t('share.title'), lead: t('share.confirm') }),
        h('div', { class: 'va-card', 'data-testid': 'share-confirm' },
          h('p', { class: 'va-text' }, icon(viewerForType(f.type) === 'video' ? 'video' : 'photo'), ' ', f.name),
          h('div', { class: 'va-actions' }, actionButton(t('share.open'), { testId: 'share-open', onClick: () => open(f) }), discard)));
      return;
    }
    if (supported.length > 1) {
      el.replaceChildren(
        pageHeader({ title: t('share.title'), lead: t('share.pick', { count: supported.length }) }),
        h('ul', { class: 'va-list', 'data-testid': 'share-list' }, supported.map((f) => h('li', { class: 'va-list__item' },
          icon(viewerForType(f.type) === 'video' ? 'video' : 'photo'),
          h('span', { class: 'va-list__grow' }, f.name),
          actionButton(t('share.open'), { variant: 'secondary', onClick: () => open(f) })))));
      return;
    }
    const text = shareText(meta);
    if (text) {
      const preview = text.length > 280 ? `${text.slice(0, 280)}…` : text;
      el.replaceChildren(
        pageHeader({ title: t('share.title'), lead: t('share.confirm') }),
        h('div', { class: 'va-card', 'data-testid': 'share-confirm' },
          h('p', { class: 'va-text', dir: 'auto', style: { whiteSpace: 'pre-wrap' } }, preview),
          h('div', { class: 'va-actions' },
            actionButton(t('share.openReader'), { testId: 'share-open', onClick: () => { setPending({ kind: 'reader', text }); ctx.navigate('/viewer/reader', { replace: true }); } }),
            discard)));
      return;
    }
    if (files.length) { el.replaceChildren(emptyState({ iconName: 'warning', title: t('share.title'), body: t('share.unsupported') })); return; }
    nothing();
  })().catch((err) => { console.warn('share load failed', err); nothing(); });

  return { el };
}
