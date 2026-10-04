# Architecture & team contract

This document is the contract between the manager and the build agents. Read it fully before writing code.

## Product name
**SeeTuned** (Hebrew: סיטיונד). Taglines — EN: "Your screen, tuned to your eyes." HE: "המסך שלך, מכוון לעיניים שלך."
The name lives in one place in code: `public/app/js/shell/brand.js`.

## Product in one paragraph
A Progressive Web App (installable on Android and iOS phones and tablets) that measures the user's vision with
self-administered on-screen tests (each eye separately), builds a personal **VisionProfile**, and then
(1) adapts the app's own UI, (2) shows photos, videos, a live camera magnifier and a reader through a personal
enhancement pipeline, and (3) gives exact, step-by-step instructions to set the device's system-wide accessibility
settings so *everything* on the phone/tablet is adapted. Subscription: 30-day free trial, then monthly / 3-month /
yearly plans via a hosted, PCI-compliant payment page. Hebrew (RTL) first, English second.

Honesty rules (non-negotiable): the product is a **display personalization and viewing-comfort tool** — **not a medical device, not a diagnosis and not a prescription**.
The default UI never shows clinical notation (no Snellen 6/x or 20/x, decimal acuity, logMAR, diopters or disease names);
results are expressed functionally (e.g. recommended text size, "screen detail" level, colour-filter need). Technical values
may appear only behind the `FEATURES.showTechnicalValues` flag (default off). The Amsler grid is **out of scope** (regulatory risk).
A normal screen cannot optically correct refractive blur; we adapt size, contrast, colour and sharpness, and we
recommend seeing an eye-care professional when results warrant it. See `docs/research/vision-science.md`
("PRODUCT CLAIMS") and `docs/research/business-legal-payments.md`.

## Tech stack
- Node.js >= 22.13, ES modules everywhere, **no front-end framework and no build step**.
- Front-end: vanilla JS modules under `public/app/js/`, JSDoc types with `// @ts-check`, checked by `npm run typecheck`.
- Back-end: Express 5 + built-in `node:sqlite`. Only runtime deps: `express`, `@mediapipe/tasks-vision` (browser assets).
- Tests: `node --test` for unit tests (`test/unit/**`), Playwright (Chromium) for e2e (`test/e2e/**`).
- **Do not add dependencies.** If you truly need one, stop and report to the manager.
- **Never run git commands** (the manager commits). Never modify files you do not own.

## URL layout (served by the Express server)
| Path | What |
|---|---|
| `/` | Marketing landing page (`public/index.html`, `public/assets/**`) |
| `/legal/*.html` | Terms, privacy, accessibility statement, cancellation policy, medical disclaimer |
| `/app/` | The PWA (`public/app/index.html`), service worker scope `/app/` |
| `/app/dev/harness.html` | DEV ONLY view harness (must 404 in production) |
| `/api/*` | JSON API |

## Directory ownership
| Owner | Paths |
|---|---|
| Manager | `public/app/js/core/**`, `public/app/css/base.css`, `public/app/dev/**`, `docs/ARCHITECTURE.md`, `package.json`, configs, `scripts/**` |
| A1 Vision Science | `public/app/js/engine/profile.js`, `public/app/js/engine/system-guide.js`, `public/app/js/engine/strings/**`, `test/unit/engine/**`, `docs/research/vision-science.md` |
| A2 Business/Legal | `public/legal/**`, `docs/research/business-legal-payments.md`, `docs/legal/**` |
| A3 Calibration | `public/app/js/calibration/**`, `test/unit/calibration/**` |
| A4 Clinical tests | `public/app/js/tests/{acuity,reading,contrast,astigmatism}/**`, `test/unit/tests/**` (except color) |
| A5 Colour | `public/app/js/tests/color/**`, `public/app/js/engine/color-math.js`, `test/unit/color/**` |
| A6 Rendering | `public/app/js/render/**`, `public/app/js/viewers/**`, `test/unit/render/**` |
| A7 Frontend/UX | `public/app/index.html`, `public/app/manifest.webmanifest`, `public/app/sw.js`, `public/app/css/app.css`, `public/app/js/app.js`, `public/app/js/{shell,flows,screens,account}/**`, `test/unit/shell/**` |
| A8 Backend | `server/**`, `test/unit/server/**` |
| A9 Brand | `public/index.html`, `public/en/**`, `public/assets/**`, `public/favicon.ico`, `public/app/icons/**`, `public/brand/**`, `docs/brand/**` |
| A10 QA/Security | `test/e2e/**` (except `harness.spec.js`), `docs/qa/**` |

## Shared core (manager-owned, use it, do not fork it)
- `core/types.js` — **all data contracts** (`TestContext`, results, `VisionProfile`, `FilterParams`, …). Code against these.
- `core/dom.js` — `h()` / `s()` safe element builders, `clear()`, `delay()`, `abortError()`, `runView()`.
- `core/ui.js` — `screen()`, `button()`, `instructionScreen()`, `coverEyeScreen()`, `directionPad()`, `progressBar()`, `hiDpiCanvas()`.
- `core/i18n.js` — `makeT(dict, lang)`; each module keeps its own `{ he: {...}, en: {...} }` strings.
- `core/storage.js` — on-device profile storage (eye data never leaves the device).
- `core/demo-profile.js` — a plausible `VisionProfile` for harness testing before the engine exists.
- `css/base.css` — design tokens and shared classes (`va-*`).

## Module contracts (function signatures)
Interactive views: `run*(container: HTMLElement, ctx: TestContext) => Promise<Result>`.
They render only inside `container`, must fully clean up (DOM, listeners, timers, camera tracks, rAF) before
settling, and on `ctx.signal` abort must reject with `DOMException('AbortError')` — use `runView()` from `core/dom.js`.
Call `ctx.onProgress?.(fraction)` as the test advances.

| Module | Exports |
|---|---|
| `calibration/calibration-math.js` | pure: `CARD_WIDTH_MM`, `CARD_HEIGHT_MM`, `cssPxPerMmFromCard(cardWidthCssPx)`, `distanceFromBlindSpot({offsetCssPx, cssPxPerMm, angleDeg?})`, `distanceFromIris({irisDiameterPx, focalLengthPx})`, `focalLengthFromKnownDistance(...)` |
| `calibration/screen-calibration-view.js` | `runScreenCalibration(container, ctx) => Promise<ScreenCalibration>` |
| `calibration/distance-calibration-view.js` | `runDistanceCalibration(container, ctx) => Promise<DistanceCalibration>` (needs `ctx.screen`) |
| `calibration/distance-tracker.js` | `createDistanceTracker({screen, distance}) => Promise<DistanceTracker|null>` (null if camera unavailable) |
| `calibration/focus-range-view.js` | `runFocusRangeTest(container, ctx) => Promise<FocusRangeResult>` |
| `tests/acuity/acuity-view.js` | `runAcuityTest(container, ctx) => Promise<AcuityResult>` (uses `ctx.eye`, `ctx.distanceTracker?.current()`) |
| `tests/reading/reading-view.js` | `runReadingTest(container, ctx) => Promise<ReadingResult>` |
| `tests/contrast/contrast-view.js` | `runContrastTest(container, ctx) => Promise<ContrastResult>` |
| `tests/astigmatism/astigmatism-view.js` | `runAstigmatismTest(container, ctx) => Promise<AstigmatismResult>` |
| `tests/color/color-view.js` | `runColorTest(container, ctx) => Promise<ColorResult>` |
| `engine/color-math.js` | pure: `srgbToLinear`, `linearToSrgb`, `machadoMatrix(type, severity)`, `daltonizeMatrix(type, severity)`, `mat3Mul`, `mat3Apply` (all matrices 3x3 row-major, linear RGB) |
| `engine/profile.js` | pure: `computeProfile(input: ProfileInput, opts?: {id?, name?, now?}) => VisionProfile`, `recomputeProfile(profile) => VisionProfile` |
| `engine/system-guide.js` | pure: `detectPlatform(userAgent, maxTouchPoints?) => Platform`, `buildSystemGuide(target: SystemSettingsTarget, platform, lang) => GuideSection[]` |
| `render/filter-renderer.js` | `createFilterRenderer(canvas, opts?) => {supported, setSource(src), setParams(FilterParams), setView({zoom, panX, panY}), render(), resize(), destroy()}` (WebGL, 2D-canvas fallback) |
| `render/apply-ui.js` | `applyProfileToDocument(profile|null, doc?)` — sets `--va-*` CSS variables + SVG colour filter on the app UI; `suspendUiFilter()` returns a release function (ref-counted; media viewers use it to avoid double filtering). Re-call `applyProfileToDocument` after any theme change. |
| `viewers/photo-viewer.js` | `mountPhotoViewer(container, {lang, profile, file?}) => {destroy()}` |
| `viewers/video-viewer.js` | `mountVideoViewer(container, {lang, profile, file?}) => {destroy()}` |
| `viewers/live-magnifier.js` | `mountLiveMagnifier(container, {lang, profile}) => {destroy()}` |
| `viewers/reader.js` | `mountReader(container, {lang, profile, text?}) => {destroy()}` |

## HTTP API contract (A8 implements, A7 consumes)
All JSON. Auth via `HttpOnly` session cookie. State-changing requests must send `Content-Type: application/json`
and come from the same origin (server checks `Origin`). Errors: `{ "error": { "code": "STRING", "message": "..." } }`.

| Method & path | Body | Response |
|---|---|---|
| `GET /api/health` | – | `{ok:true}` |
| `GET /api/plans` | – | `{trialDays, currency, plans:[{id:'monthly'|'quarterly'|'yearly', months, price, currency, pricePerMonth, savingsPercent}]}` |
| `POST /api/auth/register` | `{email, password, lang, acceptTerms:true}` | 201 `{user, entitlement}` |
| `POST /api/auth/login` | `{email, password}` | `{user, entitlement}` |
| `POST /api/auth/logout` | – | 204 |
| `POST /api/auth/password-reset/request` | `{email}` | 202 (always, no user enumeration) |
| `POST /api/auth/password-reset/confirm` | `{token, password}` | 204 |
| `GET /api/me` | – | `{user:{id,email,lang,createdAt}, entitlement}` or 401 |
| `DELETE /api/me` | `{password}` | 204 (deletes account; cancels subscription) |
| `POST /api/billing/checkout` | `{planId}` | `{url}` (hosted payment page) |
| `POST /api/billing/cancel` | `{mode?: 'period_end'|'now'}` (default `period_end`) | `{entitlement}` (one click, no fee, per Israeli law; `now` + first charge within 14 days => full refund) |
| `POST /api/billing/renew` | `{planId, consent: true}` | `{url}` or `{entitlement}` (explicit-consent renewal of Israeli fixed-term plans) |
| `POST /api/billing/resume` | – | `{entitlement}` |
| `GET /api/billing/invoices` | – | `{invoices:[...]}` |
| `POST /api/webhooks/:provider` | raw provider payload | 200 after signature verification |

All money amounts in the API (plan prices, invoices, refunds) are integers in minor units (agorot / cents), VAT-inclusive.
`GET /api/plans` also returns top-level `region` and `provider`, per plan `renewal: 'auto'|'manual'` and `provider`, and accepts `?country=`/`?currency=`.
`POST /api/billing/checkout` accepts optional `country`/`currency`. Cancel responses include `refund:{status,amount,currency}` when a refund happens.
Password-reset e-mails link to `/app/#/reset-password?token=…`. Bodyless POSTs (logout, cancel, resume) may omit Content-Type.
Error codes — auth: INVALID_EMAIL, PASSWORD_TOO_SHORT, PASSWORD_TOO_LONG, PASSWORD_TOO_COMMON, TERMS_NOT_ACCEPTED, EMAIL_TAKEN,
INVALID_CREDENTIALS, UNAUTHENTICATED, INVALID_TOKEN, INVALID_PASSWORD (403 on DELETE /api/me); billing: INVALID_PLAN,
ALREADY_SUBSCRIBED, NO_ACTIVE_SUBSCRIPTION, NOT_RESUMABLE, NOT_RENEWABLE, CONSENT_REQUIRED, INVALID_MODE, REFUND_WINDOW_PASSED,
PROVIDER_ERROR; generic: RATE_LIMITED (+Retry-After), BAD_ORIGIN, JSON_REQUIRED, INVALID_JSON, PAYLOAD_TOO_LARGE.

`entitlement = {status:'trial'|'active'|'canceled'|'past_due'|'expired', plan:null|'monthly'|'quarterly'|'yearly',
trialEndsAt, currentPeriodEnd, cancelAtPeriodEnd, daysLeft, hasAccess, renewal:'auto'|'manual'|null, canRenew}`.

## Conventions
- **Security:** never use `innerHTML`/`insertAdjacentHTML`/`document.write` with dynamic data; build DOM with `h()`.
  No inline `<script>`; no `eval`/`new Function`. Styles via CSSOM (`el.style.x = …`), never a style attribute string.
  CSP will be `script-src 'self' 'wasm-unsafe-eval'`.
- **i18n/RTL:** every user-visible string in `he` and `en`. Use CSS logical properties (`margin-inline-start`, etc.).
  Stimulus geometry (arrows, optotype orientation) is absolute and must NOT be mirrored in RTL.
- **Accessibility:** touch targets ≥ 48 px, visible focus, labels on all controls, `aria-live` for dynamic results,
  honour `prefers-reduced-motion`. The app itself must meet WCAG 2.1 AA (Israeli IS 5568).
- **Stimuli:** tests draw on `.va-test-surface` (always black on white) using `hiDpiCanvas()` so optotypes are
  rendered at device resolution. Physical size: `cssPx = mm * ctx.screen.cssPxPerMm`.
- **Pure logic vs. DOM:** put math/procedures in pure modules (no DOM) and unit-test them with `node --test`.
- **Testing your views:** `node scripts/static-server.js <your port>` then open
  `http://127.0.0.1:<port>/app/dev/harness.html?src=js/tests/acuity/acuity-view.js&fn=runAcuityTest&eye=right&lang=he`.
  Write a Playwright check (can live in a scratch file outside the repo, or in your own `test/unit/...` as pure tests).
  Ports: A3 4101, A4 4102, A5 4103, A6 4104, A7 4105, A8 4106, A9 4107, A10 4110.
- Definition of done for every agent: `npx eslint <your paths>` clean, `npm run typecheck` has no errors in your files,
  your unit tests pass, and you have exercised your views in the harness (Hebrew and English, phone viewport) with
  no console errors.

## Android app (`android/`)

The web app cannot change system settings. On Android it hands the profile to the SeeTuned Android app:

- **Hand-off:** `engine/android-link.js` builds the recipe. It carries display values only: font scale, display-size
  steps, bold, contrast, colour filter, dim, dark mode, magnification, and `profile.media` for the lens. The guide
  (`screens/guide.js`) opens it as `intent://apply?…#Intent;scheme=seetuned;package=com.seetuned.companion;S.browser_fallback_url=…;end`.
  The Android numbers come from `androidSettings()` in `engine/system-guide.js`, so the written guide and the app
  always agree.
- **`android/core`** (pure Kotlin, JVM tests):
  - `Recipe.kt`: parses and clamps the recipe. Any change to the format must be made here and in `android-link.js` together.
  - `Plan.kt`: per item, automatic, guided or lens, depending on the Android version, the maker and the access granted.
  - `Journal.kt`: the original values, used for restore.
  - `LensMath.kt`: a port of `render/filter-math.js`. Golden vectors from `scripts/android/lens-golden.js` keep the two in step.
  - `ZoomMath.kt` and `Strings.kt` (he/en).
- **`android/app`:**
  - `MainActivity`: the single screen.
  - `SystemSettings`: Settings.System via WRITE_SETTINGS; Settings.Secure via an optional adb-granted WRITE_SECURE_SETTINGS.
  - `ScreenIntents`: candidate intents per settings screen.
  - `LensService`, `LensOverlay` and `LensTileService`: the screen lens. It is an accessibility service that takes
    one screenshot when tapped, and has no window-content access.
  - The app has no INTERNET permission.
- **Tests:** `.github/workflows/android.yml` builds the app, runs lint, and runs the instrumented tests in
  `app/src/androidTest` on API 30 and 35 emulators. Locally without the Android SDK, run
  `./gradlew -PcoreOnly :core:test :compilecheck:compileKotlin`.
