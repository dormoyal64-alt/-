# SeeTuned — QA & Security Report (A10)

Date: 2026-09-29 · Build under test: working tree at `/home/user/-/vision-app` (SW `VERSION 0.1.0-1`)
Environment: real Express server via `playwright.config.js` (NODE_ENV=test, PAYMENT_PROVIDER=mock, fresh
`test-results/e2e-data`), Chromium, projects **phone** (Pixel 7, en-US UA/locale) and **tablet** (820×1180, desktop UA,
touch). A second, production-configured server (NODE_ENV=production, PayPlus with dummy credentials, `DATA_DIR=:memory:`)
is started and stopped by `security.spec.js` itself (ports 4191/4192, killed by PID).

Run: `rm -rf test-results/e2e-data && npx playwright test` → **124 passed (106 real passes + 18 expected failures for 6 known issues), 0 unexpected failures, ≈3.2 min**.
"Expected failure" = a test that asserts the correct behaviour, is marked `test.fail()` with a bug id, and currently
fails because of that bug. When the bug is fixed Playwright reports it as "unexpectedly passed" — then delete the
`test.fail()` line.

## 1. Results per spec and project

| Spec | What it covers | phone | tablet |
|---|---|---|---|
| `journey.spec.js` | Full Hebrew journey (he-IL device): landing prices from `/api/plans` → register (terms + disclaimer, client-side refusal without consents) → onboarding basics → Rx skipped → card calibration (slider ×2 + confirm) → manual distance 40 cm (asserts 400 mm) → acuity R/L, reading, contrast, colour, line sharpness R/L ("all look the same"), focus skipped (order of all 10 steps asserted) → results (functional scores, **no** `N/N`, logMAR, דיופטר, diopter) → home → guide (platform detected: android / desktop, sections rendered) → reader (text shown, size +) → settings "adapt this app" toggles `--va-font-scale` on `:root` and back → paywall 3 plans → monthly → mock hosted page → paid → account "פעיל" → cancel → "בוטל" + access kept (`hasAccess:true`) → logout (server 401) → login → home. **Zero page errors / console errors** (only the anonymous `GET /api/me` 401 is filtered, by exact path). Plus: results screen no clinical notation (he, en); BUG-01, BUG-05. | 3 pass + 3 expected-fail | 3 pass + 3 expected-fail |
| `security.spec.js` | Exact CSP + XFO, nosniff, Referrer-Policy, Permissions-Policy, COOP, no X-Powered-By on `/`, `/app/`, `/api/health`; no CORS; app runs with **no CSP violations under `style-src 'self'`** (evidence for SEC-02); foreign / missing / `null` / look-alike Origin → 403 BAD_ORIGIN on login, checkout, cancel, logout, DELETE /me; text/plain, urlencoded, multipart → 403 JSON_REQUIRED; login brute force → 429 + Retry-After; cookie `sid` HttpOnly, SameSite=Lax, Path=/, token never in body; logout kills the session server-side (replayed cookie → 401); session rotation on login; password-reset request identical for known/unknown e-mail; HTML e-mail rejected; XSS probes in profile name (home, results, profiles) and reader text render as text, nothing injected/executed; hostile deep-link `returnTo` targets dropped; static path traversal / dotfiles / source files blocked; no stack traces or paths in errors (bad JSON, 413, type confusion, SQL-ish input); webhook signature required; checkout page IDOR (user B → 404) and per-page CSRF token; **production server**: dev harness 404 incl. 12 encoding/case/dot-segment variants, mock checkout + mock webhook absent, PayPlus webhook without valid HMAC → 400, `__Host-sid; Secure; HttpOnly; SameSite=Lax; Path=/` without Domain, HSTS, `form-action` limited to provider origins, Origin pinned to PUBLIC_BASE_URL, Host header ignored for return URLs, refuses to start with mock payments / short secret / http base URL. SEC-06. | 21 pass + 1 expected-fail | 21 pass + 1 expected-fail |
| `pwa.spec.js` | Manifest (name SeeTuned, id/start_url/scope `/app/`, standalone, he/rtl, colours; every icon incl. shortcuts fetched and PNG IHDR size = declared size; maskable present; apple-touch-icon 180×180); SW registered with scope `/app/`, controls the page, `sw.js` no-cache; offline reload after first visit (logged in + profile) shows home, results, guide, settings, reader with the offline banner; `/api/*` never in any cache, never `fromServiceWorker`, and fails offline; `/app/dev/**` never cached. | 4 pass | 4 pass |
| `a11y.spec.js` | Welcome, register, paywall, home, results, guide, settings × (he light, en light, he **dark**): accessible names of every interactive AX node (Chromium's accname via CDP), exactly one visible h1, `html lang/dir`, touch targets ≥ 44×44 (label box for radios/checkboxes; inline-in-sentence links exempt), text contrast ≥ 4.5:1 / 3:1 large (computed colours, alpha-blended backgrounds), Tab focus visible (`:focus-visible` + outline/box-shadow), no horizontal scroll at 320 px (adaptation off); BUG-02/03/04. | 23 pass + 5 expected-fail | 23 pass + 5 expected-fail |
| `harness.spec.js` (manager) | unchanged | 2 pass | 2 pass |

Helpers live in `test/e2e/helpers.js` (error collector, API registration, on-device profile seeding through the real
`computeProfile`, and an onboarding "autopilot" that answers every stimulus via the views' test hooks:
`data-orientation`, `data-answer`, `data-correct`). `npx eslint test/e2e` is clean.

## 2. Bugs

| ID | Sev | Where | Repro | Proposed fix |
|---|---|---|---|---|
| **BUG-01** | Medium | `public/app/js/core/i18n.js:32-39` (manager) + CTAs `public/index.html:83,97,333,341,349,415,448` and `public/en/index.html` same lines (A9) | Browser language en-US (e.g. most Android phones in Israel set to English), open the **Hebrew** landing page `/`, tap "התחילו חודש חינם" → the app opens in **English**. `getInitialLang()` only looks at saved choice / `navigator.language`. Test: `journey.spec.js` "BUG-01". | Landing CTAs link to `/app/?lang=he#/register` (`/en/`: `?lang=en`); `getInitialLang()` first reads `new URLSearchParams(location.search).get('lang')`, and if `he`/`en` saves it. |
| **BUG-02** | High (a11y, core audience) | `public/app/css/app.css:72-77` (`.va-skip`), `:97-102` (`.va-brand`, `.va-brand__name {white-space:nowrap}`), `:121-132` (`.va-tabs__*`), headings `.va-title` (`app.css:174`, `base.css:109`) — owner A7 | Profile with large text need (demo profile → `--va-font-scale: 2.475`), viewport 320 px: results/guide/settings (he) and home/results/guide/settings/paywall/account (en) scroll sideways (scrollWidth up to 574 px): brand name, tab labels ("Account", "חשבון"), the skip link and long h1 words overflow. Without adaptation all screens fit. WCAG 1.4.10 Reflow fails for exactly the users the adaptation serves. Test: `a11y.spec.js` "BUG-02" (he, en). | Chrome must not scale unboundedly: cap chrome text, e.g. `.va-tabs__link{font-size:clamp(12px,0.8125rem,18px)}`, `.va-brand{min-width:0}` + `.va-brand__name{overflow:hidden;text-overflow:ellipsis}` (or hide the word-mark when `--va-font-scale>1.5`, the mark has an aria-label), `.va-tabs__label{max-width:100%;overflow-wrap:anywhere}`, `.va-skip{max-width:calc(100vw - 24px)}`, headings `overflow-wrap:anywhere; hyphens:auto`. Re-run BUG-02. |
| **BUG-03** | Low | `public/app/js/account/paywall.js:129` (A7) | Paywall → "מדיניות ביטול" / "Cancellation policy" is a standalone link ~20 px tall (target < 44 px; project rule is 48 px). Test: `a11y.spec.js` "BUG-03". | Render it as a block link with `min-block-size: var(--va-tap)` / `display:inline-flex; align-items:center`, or `linkButton(..., {variant:'ghost'})`. |
| **BUG-04** | Medium (a11y) | `public/app/css/base.css:137` `.va-btn--danger{background:var(--va-danger);color:#fff}` with dark `--va-danger:#ff8a80` (`base.css:50`, `:67`); also `app.css:201` hover `color:#fff` (manager + A7) | Dark theme → Settings → "מחיקת כל הנתונים מהמכשיר" button: white on #ff8a80 = **2.28:1** (needs 4.5:1). Same class is used by the account-deletion and other danger buttons/dialogs. Test: `a11y.spec.js` "BUG-04". | Add token `--va-on-danger` (`#fff` light, `#2b0000` dark ≈ 9:1 on #ff8a80) and use it in `base.css:137` and `app.css:201`. |
| **BUG-05** | Medium (product honesty / regulatory) | `public/app/js/screens/home.js:77` (A7) | Home → "Your profile at a glance" prints the screen-detail score as `` `${score}/100` `` e.g. "50/100". A low score (logMAR 0.76 → 20) displays **"20/100"**, which is literally a Snellen acuity fraction — contrary to the "no clinical notation" rule; results screen and flags already say "50 מתוך 100" / "50 of 100". Test: `journey.spec.js` "BUG-05" (he, en). | Use the existing wording: `t('results.score', { score })` or a new `home.scoreValue` = "{score} מתוך 100" / "{score} of 100". |

No functional bug blocked the journey: registration, the whole onboarding (10 steps), profile computation, results,
guide, reader, settings, mock checkout, cancel, logout and login all work on both projects with zero page/console errors.

## 3. Security findings (manual review of `server/**`, `public/app/js/**`, `public/app/sw.js` + tests)

| ID | Sev | Evidence | Fix |
|---|---|---|---|
| **SEC-03** | Medium (deployment) | Rate limits key on `req.ip` (`server/http/limits.js:119-131`); `trust proxy` defaults to `false` (`server/config.js:231-238`) and nothing warns. Behind a reverse proxy/CDN every client shares the proxy IP → site-wide 10 registrations/h, 50 logins/15 min, 20 reset requests/h: trivial sign-up/login DoS. Setting `TRUST_PROXY=true` blindly lets clients spoof `X-Forwarded-For` to evade limits. | Document the required `TRUST_PROXY` hop count for the chosen host; in production log a one-time warning when a request carries `X-Forwarded-For` while trust proxy is off; prefer a hop count over `true`. |
| **SEC-06** | Low | Confirmed by `security.spec.js` "SEC-06": a page on any other site auto-submits a form to `/app/share-target`; the SW (`public/app/sw.js:79,133-151`) stores it and `screens/share.js:77-78` opens the reader showing attacker text inside the trusted app (content spoofing, e.g. fake "call to renew" text). Text stays inert (no XSS). | In `handleShare`, ignore posts whose `req.referrer` is a foreign origin (OS share sheets send none), and/or have `#/share` ask "Open shared text?" before opening the reader. |
| **SEC-02** | Low | CSP `style-src 'self' 'unsafe-inline'` (`server/http/security.js:18`). The PWA and landing need no inline styles: the whole app runs with **zero violations** under `style-src 'self'` (test "stricter style-src"). Only the dev-only mock checkout page (`server/billing/providers/mock.js` `PAGE_CSS` inline `<style>`) uses it. | Use `style-src 'self'` globally; give the mock page its own CSP (hash of `PAGE_CSS`) or move its CSS to a static file. |
| **SEC-04** | Low | Login throttling is per IP+e-mail (10/15 min) and per IP (`limits.js:123-124`); no per-account limit, so distributed guessing against one account is unthrottled (mitigated by the common-password blocklist and slow hashing). | Add an account-level limiter (e.g. 30 failures/h per e-mail → 429) or progressive delay. |
| **SEC-01** | Low (non-production only) | Outside production the base URL comes from the `Host` header (`server/http/security.js:55-58`): `GET /api/billing/return/success` with `Host: evil.example` redirects to `http://evil.example/app/…` (test asserts it), and password-reset links (`server/auth/routes.js:140`) follow Host. Production pins `PUBLIC_BASE_URL` (verified: spoofed Host ignored). Risk only if a staging server runs without `NODE_ENV=production`. | Honour `PUBLIC_BASE_URL` whenever set (already), and in non-production fall back to the Host only for loopback hosts; state in `.env.example` that staging must set `PUBLIC_BASE_URL`. |
| SEC-05 | Info | `POST /api/auth/register` → 409 `EMAIL_TAKEN` enables account enumeration (rate-limited 10/h/IP). | Accept, or return 201-style "check your e-mail" and notify the owner. |
| SEC-07 | Info | Reset token stays in the URL fragment/history after use (`public/app/js/account/reset.js:17`). Single-use, 1 h TTL. | `history.replaceState` to drop `token` once read. |
| SEC-08 | Info | SW serves every `/app/` JS module cache-first (`sw.js:83,101-114`) until `VERSION` (`sw.js:14`) is bumped — a deploy that forgets the bump keeps serving old code (incl. security fixes). | CI check that `VERSION` changes with `public/app/**`, or stale-while-revalidate for JS. |
| SEC-09 | Info | Paddle signature only rejects stale, not future, timestamps (`server/billing/providers/paddle.js:41`); HMAC still required. In-memory limiters reset on restart and are per-instance. | Optional: reject `ts` > now + tolerance; shared store if scaled out. |

Verified secure (no finding): all SQL is parameterised (only dynamic SQL is the `UPDATE subscriptions SET` column list
built from constant keys, `server/billing/service.js:484`); sessions are 256-bit random tokens stored as SHA-256, rotated
on login, destroyed on logout, all revoked on password reset and account deletion; Origin + JSON CSRF guard on every
state-changing API route; no CORS; webhooks verified with HMAC + `timingSafeEqual` (mock, Paddle `h1`, PayPlus `hash`),
PayPlus additionally re-queried server-to-server with amount/currency match; return URLs are fixed paths on
`PUBLIC_BASE_URL` in production (no open redirect); mock routes doubly disabled in production; dev harness 404 in
production (normalised, case-insensitive); `express.static` blocks traversal and dotfiles; errors are generic JSON / plain
text with no stack traces; login uses a dummy hash for unknown e-mails; reset request is non-enumerating.
Front-end: no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `eval`, `new Function`, string timers,
`srcdoc` or `DOMParser` anywhere in `public/app/js/**`, `public/app/sw.js`, `public/assets/site.js`; all DOM built with
`h()`/`textContent`; checkout and invoice URLs pass `safeCheckoutUrl` (same-origin or https only — `javascript:` rejected);
`returnTo` is sanitised (`shell/route-utils.js:67-71`, verified by test). `npm audit --omit=dev` and `npm audit`:
**0 vulnerabilities**.

## 4. Accessibility summary

Pass on all 7 screens × he/en (light) and he (dark), both projects: accessible names (0 unnamed controls), one h1 per
screen, correct `lang`/`dir`, contrast (light: 0 failures), visible focus on Tab, no horizontal scroll at 320 px with
default text size, 44 px targets everywhere except BUG-03. Failures: BUG-02 (reflow at large profile text scale),
BUG-03 (small legal link), BUG-04 (dark danger button 2.28:1). Not covered automatically: screen-reader announcement
quality, `prefers-reduced-motion`, the test surfaces themselves (black-on-white stimuli are intentionally exempt).

## 5. Release readiness

**Verdict: conditional GO for a Hebrew-first beta; NO-GO for public launch until BUG-02, BUG-04 and BUG-05 are fixed**
(all three are small CSS/string changes). Rationale: the end-to-end product works on phone and tablet with zero runtime
errors, the payment/subscription lifecycle is correct, and the security posture is strong (no High/Critical findings).
But BUG-02/BUG-04 fail the WCAG 2.1 AA / IS 5568 commitment for precisely the low-vision audience, and BUG-05 breaks the
non-negotiable "no clinical notation" honesty rule. Fix BUG-01 and BUG-03 in the same pass; SEC-03 must be resolved as
part of the production deployment configuration (before real traffic behind a proxy); SEC-06/SEC-02/SEC-04 can follow
in the next iteration. After fixes: remove the corresponding `test.fail()` lines and re-run `npx playwright test`.

## 6. Fixes applied by the manager (2026-09-30) and re-verification

| Id | Fix | Where |
|---|---|---|
| BUG-01 | Marketing and legal links carry `?lang=he` / `?lang=en`; `getInitialLang()` honours and remembers it. | `public/app/js/core/i18n.js`, `public/index.html`, `public/en/index.html`, `public/legal/**` |
| BUG-02 | App chrome (brand, tabs, language toggle, skip link, headings, badges) capped in px; long words wrap (`overflow-wrap:anywhere`); flex text columns may shrink (`min-inline-size:0`) in flags, guide steps, link lists and switches. Verified: all screens are exactly 320 px wide at `--va-font-scale` 2.475, he + en. | `public/app/css/base.css`, `public/app/css/app.css` |
| BUG-03 | Paywall cancellation-policy link is a ≥ 48 px touch target (`.va-tap-link`). | `account/paywall.js`, `app.css` |
| BUG-04 | New `--va-on-danger` token (white in light, `#2b0000` in dark). | `base.css`, `app.css` |
| BUG-05 | Home shows "50 מתוך 100" / "50 of 100" instead of "50/100". | `screens/home.js`, `screens/strings.js` |
| SEC-02 | CSP `style-src 'self'` (no `'unsafe-inline'`); the dev-only mock checkout page allows only its own stylesheet by SHA-256 hash. | `server/http/security.js`, `server/billing/providers/mock.js` |
| SEC-03 | One-time startup warning when `X-Forwarded-For` arrives while `TRUST_PROXY` is off; `.env.example` marks it required behind a proxy. | `server/app.js`, `server/.env.example` |
| SEC-06 | Shared content never opens automatically: the share screen asks first and does not display incoming text before the user taps "Open". | `screens/share.js` |
| Refunds | "Cancel now + full refund" also covers the latest charge of a fixed-term plan renewed manually (each is a new distance purchase, section 14C); entitlement exposes `refundEligibleUntil`. | `server/billing/service.js`, `account/account.js` |

Not changed (documented for launch): SEC-04 (no per-account login limit across many IPs — per IP and per IP+e-mail limits exist), SEC-01 (dev-only Host-header URLs; production pins `PUBLIC_BASE_URL`), info items.

**Re-run results (2026-09-30):** `npm run lint` clean · `npm run typecheck` clean · `npm test` 332/332 · `npx playwright test` **124/124 passed** (phone + tablet, no expected-failure markers left).

**Updated verdict:** GO for a Hebrew-first beta once the launch checklist in `README.md` is completed (business details, payment-provider sandbox verification, domain, TRUST_PROXY).
