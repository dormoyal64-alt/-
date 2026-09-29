// @ts-check
/**
 * #/home — trial banner (last 7 days), unfinished-check card, active profile summary, quick actions.
 */
import { h } from '../core/dom.js';
import { makeT } from '../core/i18n.js';
import { getActiveProfile, loadDraft, onProfilesChanged } from '../core/storage.js';
import { SCREEN_STRINGS } from './strings.js';
import { ACCOUNT_STRINGS } from '../account/strings.js';
import { shouldShowTrialBanner, trialDaysLeft } from '../account/entitlement.js';
import { isValidDraft, completedSteps, hasProgress, PLAN, DRAFT_KEY } from '../flows/onboarding-plan.js';
import { brandName } from '../shell/brand.js';
import { formatDate } from '../shell/format.js';
import { icon } from '../shell/icons.js';
import { linkButton, card, emptyState, notice } from '../shell/components.js';
import { eyeSummaries, textScalePercent, colorFinding, sortFlags } from './summary.js';

/** @param {import('../shell/screen-types.js').ScreenContext} ctx */
export function mount(ctx) {
  const el = h('div', { class: 'va-page va-page--wide va-home', 'data-testid': 'screen-home' });
  const render = () => {
    const t = makeT(SCREEN_STRINGS, ctx.lang);
    const ta = makeT(ACCOUNT_STRINGS, ctx.lang);
    const profile = getActiveProfile();
    const draft = loadDraft(DRAFT_KEY);
    const parts = [];

    const e = ctx.store.get().entitlement;
    if (shouldShowTrialBanner(e, Date.now())) {
      const days = trialDaysLeft(e, Date.now()) ?? 0;
      const text = days <= 0 ? ta('trial.bannerToday') : days === 1 ? ta('trial.bannerOne') : ta('trial.banner', { days });
      parts.push(h('aside', { class: 'va-trial', 'data-testid': 'trial-banner', 'aria-label': text },
        h('span', { class: 'va-trial__icon' }, icon('clock')),
        h('div', { class: 'va-trial__text' }, h('p', { class: 'va-trial__title' }, text), h('p', { class: 'va-hint' }, ta('trial.bannerNote'))),
        linkButton(ta('trial.subscribe'), '#/paywall', { testId: 'trial-subscribe', className: 'va-trial__btn' })));
    }

    const unfinished = isValidDraft(draft) && hasProgress(draft);
    if (!profile) {
      parts.push(emptyState({
        iconName: 'eye', title: t('home.noProfileTitle'), body: t('home.noProfileBody', { brand: brandName(ctx.lang) }), testId: 'home-empty',
        actions: [linkButton(unfinished ? t('home.resume') : t('home.start'), '#/onboarding', { testId: 'home-start', className: 'va-btn--lg' })],
      }));
      if (unfinished) parts.push(h('p', { class: 'va-hint va-center-text' }, t('home.resumeBody', { done: completedSteps(draft), total: PLAN.length })));
      el.replaceChildren(...parts);
      return;
    }

    const name = profile.name;
    parts.push(h('header', { class: 'va-page-head' },
      h('h1', { class: 'va-title', tabindex: '-1' }, t('home.hello', { name })),
      h('p', { class: 'va-lead' }, t('home.profileLine', { name, date: formatDate(profile.updatedAt, ctx.lang) }))));

    if (unfinished) {
      parts.push(notice('info', t('home.resumeBody', { done: completedSteps(draft), total: PLAN.length }), {
        title: t('home.resumeTitle'), testId: 'home-resume', iconName: 'retest',
        actions: [linkButton(t('home.resume'), '#/onboarding', { variant: 'secondary' })],
      }));
    }

    const important = sortFlags(profile.flags).filter((f) => f.level !== 'info');
    if (important.length) {
      parts.push(notice(important[0].level === 'urgent' ? 'danger' : 'warning', t('home.attention'), {
        testId: 'home-flags', actions: [linkButton(t('home.attentionLink'), '#/results', { variant: 'secondary' })],
      }));
    }

    const eyes = eyeSummaries(profile);
    const pct = textScalePercent(profile.text?.scale);
    const color = colorFinding(profile.input?.color);
    const stat = (/** @type {string} */ label, /** @type {string} */ value, /** @type {string} */ testId) => h('div', { class: 'va-stat', 'data-testid': testId },
      h('span', { class: 'va-stat__label' }, label), h('span', { class: 'va-stat__value' }, value));
    const summary = card({
      title: t('home.summaryTitle'), iconName: 'eye', testId: 'home-summary', className: 'va-summary',
      children: h('div', { class: 'va-stats' },
        stat(t('home.textSize'), pct ? `${pct}%` : '–', 'stat-text'),
        ...eyes.map((x) => stat(t(x.eye === 'right' ? 'home.detailRight' : 'home.detailLeft'), x.score === null ? t('results.notMeasured') : `${x.score}/100`, `stat-${x.eye}`)),
        stat(t('home.colors'), color ? t(`color.${color.key}`) : t('results.notMeasured'), 'stat-color')),
      actions: [linkButton(t('home.seeResults'), '#/results', { variant: 'secondary', iconName: 'results' })],
    });

    const tile = (/** @type {string} */ href, /** @type {string} */ ic, /** @type {string} */ key, /** @type {string} */ testId) => h('li', null,
      h('a', { class: 'va-tile', href, 'data-testid': testId },
        h('span', { class: 'va-tile__icon' }, icon(ic, { size: 28 })),
        h('span', { class: 'va-tile__text' }, h('span', { class: 'va-tile__title' }, t(key)), h('span', { class: 'va-tile__desc' }, t(`${key}Desc`)))));
    const actions = h('section', { class: 'va-actions-grid', 'aria-labelledby': 'home-actions-h' },
      h('h2', { class: 'va-section-title', id: 'home-actions-h' }, t('home.actionsTitle')),
      h('ul', { class: 'va-tiles', role: 'list' },
        tile('#/viewer/photo', 'photo', 'home.photos', 'qa-photo'),
        tile('#/viewer/video', 'video', 'home.videos', 'qa-video'),
        tile('#/viewer/magnifier', 'magnifier', 'home.magnifier', 'qa-magnifier'),
        tile('#/viewer/reader', 'reader', 'home.reader', 'qa-reader'),
        tile('#/guide', 'phone', 'home.guide', 'qa-guide'),
        tile(`#/onboarding?retest=${encodeURIComponent(profile.id)}`, 'retest', 'home.retest', 'qa-retest'),
        tile('#/profiles', 'users', 'home.profiles', 'qa-profiles')));

    parts.push(h('div', { class: 'va-home__grid' }, summary, actions));
    el.replaceChildren(...parts);
  };
  render();
  const off = onProfilesChanged(render);
  const unsub = ctx.store.subscribe((n, p) => { if (n.entitlement !== p.entitlement) render(); });
  return { el, destroy: () => { off(); unsub(); } };
}
