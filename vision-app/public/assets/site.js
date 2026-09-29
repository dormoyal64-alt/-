// SeeTuned marketing site: small progressive enhancement only (owned by A9).
// 1) mobile navigation toggle, 2) live plan prices from GET /api/plans (static HTML prices stay as fallback).
// The FAQ uses <details>, so it needs no script. No innerHTML anywhere: text is set with textContent.

const root = document.documentElement;
root.classList.add('js');
const lang = root.lang === 'he' ? 'he' : 'en';

const TEXT = {
  he: {
    periods: { 1: 'לחודש', 3: 'ל־3 חודשים', 12: 'לשנה' },
    periodN: (n) => `ל־${n} חודשים`,
    perMonth: (p) => `${p} לחודש`,
    monthlyNote: 'בלי התחייבות',
    savings: (n) => `חיסכון של ${n}%`,
    renewAuto: (n) =>
      `${n === 1 ? 'מתחדש אוטומטית כל חודש' : n === 12 ? 'מתחדש אוטומטית כל שנה' : `מתחדש אוטומטית כל ${n} חודשים`}. אפשר לבטל בכל עת בלחיצה אחת, בלי דמי ביטול.`,
    renewManual: 'תשלום אחד מראש, בלי חידוש אוטומטי. לקראת סוף התקופה נשאל אם תרצו להמשיך.',
    menu: 'תפריט',
    close: 'סגירה',
  },
  en: {
    periods: { 1: 'per month', 3: 'for 3 months', 12: 'per year' },
    periodN: (n) => `for ${n} months`,
    perMonth: (p) => `${p} per month`,
    monthlyNote: 'No commitment',
    savings: (n) => `Save ${n}%`,
    renewAuto: (n) =>
      `Renews automatically every ${n === 1 ? 'month' : n === 12 ? 'year' : `${n} months`}. Cancel any time in one click, with no cancellation fee.`,
    renewManual: 'One upfront payment, no automatic renewal. Near the end of the period we will ask whether you want to continue.',
    menu: 'Menu',
    close: 'Close',
  },
}[lang];

/* ---------- Mobile navigation ---------- */
function setupNav() {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.getElementById('site-nav');
  if (!toggle || !nav) return;
  const label = toggle.querySelector('span:last-child');
  toggle.hidden = false;
  const setOpen = (open) => {
    nav.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    if (label) label.textContent = open ? TEXT.close : TEXT.menu;
  };
  toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
  nav.addEventListener('click', (e) => {
    if (e.target instanceof Element && e.target.closest('a')) setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setOpen(false);
      toggle.focus();
    }
  });
}

/* ---------- Live plans ---------- */
function formatMoney(minor, currency) {
  try {
    const s = new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-IL', { style: 'currency', currency }).format(minor / 100);
    return s.replace(/‏/g, ''); // drop RLM marks; the page direction handles ordering
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

const isCount = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;

function validPlan(p) {
  return p && typeof p === 'object' && typeof p.id === 'string' &&
    isCount(p.months, 120) && p.months > 0 && isCount(p.price, 1e9) && isCount(p.pricePerMonth, 1e9) &&
    typeof p.currency === 'string' && /^[A-Z]{3}$/.test(p.currency);
}

function setText(scope, field, text) {
  const el = scope.querySelector(`[data-field="${field}"]`);
  if (el && typeof text === 'string') el.textContent = text;
  return el;
}

function applyPlans(data) {
  if (!data || !Array.isArray(data.plans)) return;
  if (isCount(data.trialDays, 365) && data.trialDays > 0) {
    for (const el of document.querySelectorAll('[data-field="trial-days"]')) el.textContent = String(data.trialDays);
  }
  for (const plan of data.plans) {
    if (!validPlan(plan)) continue;
    const card = document.querySelector(`[data-plan="${CSS.escape(plan.id)}"]`);
    if (!card) continue;
    setText(card, 'price', formatMoney(plan.price, plan.currency));
    const period = card.querySelector('.plan__period');
    if (period) period.textContent = TEXT.periods[plan.months] ?? TEXT.periodN(plan.months);
    setText(card, 'per-month', plan.months > 1 ? TEXT.perMonth(formatMoney(plan.pricePerMonth, plan.currency)) : TEXT.monthlyNote);
    const savings = card.querySelector('[data-field="savings"]');
    if (savings) {
      const pct = plan.savingsPercent;
      const show = isCount(pct, 100) && pct > 0;
      savings.hidden = !show;
      if (show) savings.textContent = TEXT.savings(pct);
    }
    if (plan.renewal === 'auto') setText(card, 'renewal', TEXT.renewAuto(plan.months));
    else if (plan.renewal === 'manual') setText(card, 'renewal', TEXT.renewManual);
  }
}

async function loadPlans() {
  if (!document.querySelector('[data-plans]')) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch('/api/plans', { headers: { Accept: 'application/json' }, signal: ctrl.signal, credentials: 'same-origin' });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('application/json')) return;
    applyPlans(await res.json());
  } catch {
    // API unavailable: keep the static prices already in the HTML.
  } finally {
    clearTimeout(timer);
  }
}

setupNav();
loadPlans();
