/*
 * DEMO ONLY — in-browser stand-in for the SeeTuned API, used by scripts/build-demo.mjs.
 * It lets the PWA run as a static preview with no server: sign-up, trial, plans, a simulated payment,
 * cancel/resume/renew and invoices are kept in this browser's localStorage. No real accounts, no payments.
 * Classic script: it must load before js/app.js so that window.fetch is patched first.
 */
(function () {
  'use strict';
  var KEY = 'va.demo.api.v1';
  var DAY = 86400000;
  var PLANS = [
    { id: 'monthly', months: 1, price: 2490, renewal: 'auto' },
    { id: 'quarterly', months: 3, price: 5990, renewal: 'manual' },
    { id: 'yearly', months: 12, price: 17990, renewal: 'manual' },
  ];

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {}; } catch (e) { return {}; }
  }
  function save(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* storage blocked: state lives for this page only */ }
  }
  var memory = load();
  function state() { return memory; }
  function commit() { save(memory); }

  function plan(id) { for (var i = 0; i < PLANS.length; i++) if (PLANS[i].id === id) return PLANS[i]; return null; }
  function iso(ms) { return ms == null ? null : new Date(ms).toISOString(); }
  function addMonths(ms, n) { var d = new Date(ms); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); }

  function plansBody() {
    var monthly = PLANS[0].price;
    return {
      trialDays: 30, region: 'IL', currency: 'ILS', provider: 'demo',
      plans: PLANS.map(function (p) {
        var perMonth = Math.round(p.price / p.months);
        return {
          id: p.id, months: p.months, price: p.price, currency: 'ILS', pricePerMonth: perMonth,
          savingsPercent: p.months === 1 ? 0 : Math.floor((1 - perMonth / monthly) * 100), renewal: p.renewal, provider: 'demo',
        };
      }),
    };
  }

  function entitlement() {
    var s = state(); var now = Date.now(); var u = s.user;
    var sub = s.sub;
    var ent = {
      status: 'expired', plan: null, trialEndsAt: iso(u && u.trialEndsAt), currentPeriodEnd: null, cancelAtPeriodEnd: false,
      daysLeft: 0, hasAccess: false, renewal: null, canRenew: false, refundEligibleUntil: null,
    };
    if (sub && sub.periodEnd > now) {
      var p = plan(sub.plan);
      ent.plan = sub.plan; ent.currentPeriodEnd = iso(sub.periodEnd); ent.cancelAtPeriodEnd = !!sub.cancelAtPeriodEnd;
      ent.status = sub.cancelAtPeriodEnd ? 'canceled' : 'active'; ent.hasAccess = true;
      ent.daysLeft = Math.ceil((sub.periodEnd - now) / DAY);
      ent.renewal = p ? p.renewal : 'auto';
      ent.canRenew = ent.renewal === 'manual' && sub.periodEnd - now <= 30 * DAY;
      var paid = (s.invoices || []).filter(function (i) { return i.status === 'paid'; });
      var last = paid[paid.length - 1];
      if (last && now - Date.parse(last.issuedAt) <= 14 * DAY) ent.refundEligibleUntil = iso(Date.parse(last.issuedAt) + 14 * DAY);
    } else if (u && u.trialEndsAt > now) {
      ent.status = 'trial'; ent.hasAccess = true; ent.daysLeft = Math.ceil((u.trialEndsAt - now) / DAY);
    }
    return ent;
  }

  function userBody() {
    var u = state().user;
    return { id: u.id, email: u.email, lang: u.lang, createdAt: iso(u.createdAt) };
  }
  function json(status, body) {
    return new Response(body === undefined ? null : JSON.stringify(body), {
      status: status, headers: { 'Content-Type': 'application/json' },
    });
  }
  function error(status, code, message) { return json(status, { error: { code: code, message: message } }); }
  function authed() { var s = state(); return !!(s.user && s.loggedIn); }

  function route(method, path, body) {
    var s = state(); var now = Date.now();
    if (method === 'GET' && path === '/api/health') return json(200, { ok: true });
    if (method === 'GET' && path === '/api/plans') return json(200, plansBody());

    if (method === 'POST' && path === '/api/auth/register') {
      var email = String(body.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return error(400, 'INVALID_EMAIL', 'Invalid e-mail');
      if (String(body.password || '').length < 8) return error(400, 'PASSWORD_TOO_SHORT', 'Password too short');
      if (body.acceptTerms !== true) return error(400, 'TERMS_NOT_ACCEPTED', 'Terms not accepted');
      if (s.user && s.user.email === email) return error(409, 'EMAIL_TAKEN', 'E-mail already registered');
      memory = { user: { id: 'demo-' + now.toString(36), email: email, lang: body.lang === 'en' ? 'en' : 'he', createdAt: now, trialEndsAt: now + 30 * DAY }, loggedIn: true, sub: null, invoices: [] };
      commit();
      return json(201, { user: userBody(), entitlement: entitlement() });
    }
    if (method === 'POST' && path === '/api/auth/login') {
      var e = String(body.email || '').trim().toLowerCase();
      if (!s.user || s.user.email !== e || String(body.password || '').length < 8) return error(401, 'INVALID_CREDENTIALS', 'Wrong e-mail or password');
      s.loggedIn = true; commit();
      return json(200, { user: userBody(), entitlement: entitlement() });
    }
    if (method === 'POST' && path === '/api/auth/logout') { s.loggedIn = false; commit(); return json(204); }
    if (method === 'POST' && path === '/api/auth/password-reset/request') return json(202, {});
    if (method === 'POST' && path === '/api/auth/password-reset/confirm') return error(400, 'INVALID_TOKEN', 'Not available in the demo');

    if (!authed()) return error(401, 'UNAUTHENTICATED', 'Please log in');

    if (method === 'GET' && path === '/api/me') return json(200, { user: userBody(), entitlement: entitlement() });
    if (method === 'DELETE' && path === '/api/me') { memory = {}; commit(); return json(204); }

    if (method === 'POST' && path === '/api/billing/checkout') {
      var p = plan(body.planId);
      if (!p) return error(400, 'INVALID_PLAN', 'Unknown plan');
      var ent = entitlement();
      if (ent.status === 'active') return error(409, 'ALREADY_SUBSCRIBED', 'Already subscribed');
      var start = Math.max(now, s.user.trialEndsAt || now);
      s.sub = { plan: p.id, periodEnd: addMonths(start, p.months), cancelAtPeriodEnd: false };
      s.invoices = (s.invoices || []).concat([{ id: 'inv-' + now.toString(36), plan: p.id, amount: p.price, currency: 'ILS', status: 'paid', url: null, issuedAt: iso(now) }]);
      commit();
      // Absolute URL of this app page: the app resolves checkout URLs against the origin root.
      return json(200, { url: location.href.split('#')[0] + '#/account?checkout=success' });
    }
    if (method === 'POST' && path === '/api/billing/cancel') {
      if (!s.sub || s.sub.periodEnd <= now) return error(409, 'NO_ACTIVE_SUBSCRIPTION', 'No active subscription');
      if (body.mode === 'now') {
        var ent2 = entitlement();
        if (!ent2.refundEligibleUntil) return error(400, 'REFUND_WINDOW_PASSED', 'Refund window passed');
        var last = s.invoices[s.invoices.length - 1];
        last.status = 'refunded'; s.sub = null; commit();
        return json(200, { entitlement: entitlement(), refund: { status: 'refunded', amount: last.amount, currency: 'ILS' } });
      }
      s.sub.cancelAtPeriodEnd = true; commit();
      return json(200, { entitlement: entitlement(), refund: null });
    }
    if (method === 'POST' && path === '/api/billing/resume') {
      if (!s.sub) return error(409, 'NOT_RESUMABLE', 'Nothing to resume');
      s.sub.cancelAtPeriodEnd = false; commit();
      return json(200, { entitlement: entitlement() });
    }
    if (method === 'POST' && path === '/api/billing/renew') {
      if (body.consent !== true) return error(400, 'CONSENT_REQUIRED', 'Consent required');
      var rp = plan(body.planId); if (!rp || !s.sub) return error(409, 'NOT_RENEWABLE', 'Not renewable');
      s.sub.plan = rp.id; s.sub.periodEnd = addMonths(Math.max(now, s.sub.periodEnd), rp.months); s.sub.cancelAtPeriodEnd = false;
      s.invoices.push({ id: 'inv-' + now.toString(36), plan: rp.id, amount: rp.price, currency: 'ILS', status: 'paid', url: null, issuedAt: iso(now) });
      commit();
      return json(200, { entitlement: entitlement() });
    }
    if (method === 'GET' && path === '/api/billing/invoices') return json(200, { invoices: (s.invoices || []).slice().reverse() });
    return error(404, 'NOT_FOUND', 'Not available in the demo');
  }

  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var url;
    try { url = new URL(typeof input === 'string' ? input : input.url, location.href); } catch (e) { return realFetch(input, init); }
    var i = url.pathname.indexOf('/api/');
    if (i === -1) return realFetch(input, init);
    var method = String((init && init.method) || 'GET').toUpperCase();
    var body = {};
    try { body = init && typeof init.body === 'string' && init.body ? JSON.parse(init.body) : {}; } catch (e) { body = {}; }
    return new Promise(function (resolve) {
      setTimeout(function () { resolve(route(method, url.pathname.slice(i), body)); }, 120);
    });
  };

  // A small, non-interactive marker so nobody mistakes the preview for the live service.
  function badge() {
    if (document.getElementById('va-demo-badge')) return;
    var he = (document.documentElement.lang || 'he') !== 'en';
    var el = document.createElement('div');
    el.id = 'va-demo-badge';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = he ? 'גרסת הדגמה · ללא תשלום אמיתי' : 'Demo · no real payments';
    // A thin strip above the app (in the normal flow, so it never covers the app's own bars or content).
    var st = el.style;
    st.display = 'block'; st.textAlign = 'center'; st.pointerEvents = 'none';
    st.font = '600 12px/1.3 system-ui, sans-serif'; st.padding = '3px 8px';
    st.background = '#f2a93b'; st.color = '#2b1a00';
    document.body.insertBefore(el, document.body.firstChild);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', badge); else badge();
})();
