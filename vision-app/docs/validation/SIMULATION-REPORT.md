# Glasses-free screen use — simulation report (SeeTuned)

*Internal validation document (A11, 2026-10-03). Prescriptions and clinical notation appear here on purpose; they never
reach users. Reproduce: `node scripts/sim/run-cohort.js` (61 users × 20 repetitions, ~25 s; writes
[`cohort-results.md`](cohort-results.md) / `.json`), `node scripts/sim/render-views.js` (images), `node scripts/sim/run-cohort.js --fit`
(model fit). Fast regression suite: `test/unit/sim/*.test.js`.*

## Bottom line

A normal screen cannot remove optical blur. What the app can do for someone reading **without** glasses is choose a
distance inside the eye's own sharp range (if one exists within reach) and size the text for what remains. Simulated
through the real test procedures and the real engine:

- **Comfortable without glasses ("yes")** for: no or low near-sightedness up to about −3 D (the phone is held inside
  the far point), low long-sightedness under ~40 y, astigmatism ≤ 0.75 D, early presbyopia around 45 y (held at ~40 cm),
  anisometropia when the better eye is in range. Typically 16–20 px at 30–45 cm.
- **Partial** (readable, with compromises — large text, close distance or residual blur): −4 D (must hold ~27 cm),
  astigmatism 1.5–2.5 D (blur at every distance; 20–45 px), mid-life combinations (−2 D at 55, +0.5 D at 45). Around
  50–55 y the verdict depends on the individual focusing range (the simulated 55-year-old with an above-average range
  is a borderline yes/partial, the 50-year-old with a below-average range a no).
- **Not practical ("no")** — glasses/lenses still recommended for screens: myopia ≥ −5 D (sharp only closer than
  ~22 cm), presbyopia without readers once the focusing range is small (here 50 y and 60+), long-sightedness ≥ +1 D
  from 45 y, all 60+ without near correction (text would need > 64 px); 2.5 D astigmatism is partial at best (one
  case no).
- Under-18s never get a glasses-free verdict (the flow keeps them in "with glasses" mode; the engine answers `no` /
  `CHILD` if it ever sees such input).

Legibility without glasses (true eye, comfortable focusing, acuity reserve ≥ 2 = PASS): default 16 px at the habitual
distance PASSes in **41 %** of runs (FAIL 43 %); the SeeTuned profile at its recommended distance PASSes in **79 %**
(FAIL 6 %, all in "no"/capped cases). Every "yes" run PASSes except one undetectable case (+3 D at 25 y, see risks).

## 1. Method

### 1.1 Eye model (`public/app/js/sim/eye-model.js`)
- **Refraction**: minus-cylinder S/C×A; meridional powers S (axis) and S+C (axis+90). Target at d: residual per
  meridian r = 1/d + R − a. The eye puts the circle of least confusion on the retina, a = clamp(1/d + SE, 0, a_max);
  a_max = full amplitude for the short tests, **½ amplitude** for sustained comfortable reading (spec §9.5).
- **Blur strength**: power-vector length B = √(M² + (C/2)²) (Thibos, Wheeler & Horner 1997; the "scalar vector" of
  Rushton et al. 2016; spherocylindrical acuity after Raasch 1995).
- **Defocus → acuity** (Smith 1991, *Optom Vis Sci* 68:591, with a depth-of-focus dead zone):
  MAR = √(MAR0² + (k·P·max(0, B − z/P))²). Fitted to (a) the adult myope regression of Rushton, Armstrong & Dunne 2016
  (*Clin Exp Optom* 99:4; MAR = 2.91·U + 0.51·P − 3.14, 663 eyes) at U = 1–4 D and (b) lens-induced myopic defocus in
  young adults (+0.163 logMAR at 0.50 D, +0.825 at 2.00 D; 2024–25 repeated-measures study, PMC13475252), both at an
  assumed chart pupil of 4.5 mm: **k = 0.64** (Smith's range 0.55–1.33), **z = 0.86 mm·D**; RMS 0.04 logMAR.
  At a 3.7 mm phone pupil: 0.5 D → 0.04, 1 D → 0.31, 2 D → 0.63, 3 D → 0.82, 6 D → 1.14 logMAR.
- **Pupil**: Watson & Yellott 2012 (*J Vis* 12(10):12) unified formula at 150 cd/m² over 270 deg² (a phone at ~35 cm),
  binocular: 3.7 mm at 29 y, 3.3 mm at 60 y; individual N(0, 0.3 mm).
- **Accommodation**: Hofstetter 1950 mean (18.5 − 0.3·age) + individual N(0, 1 D) within [min − 0.5, max].
- **Neural floor**: −0.08 logMAR to 40 y, +0.0025/y after (after Elliott, Yang & Whitaker 1995) + N(0, 0.03).
- **Blur disk** β = P·ΔD (3.44′ per mm·D); **PSF**: elliptical pillbox along the two principal meridians ⊗ Gaussian
  (diffraction σ = 0.42 λ/P + 0.4′ higher-order), TABO angle θ seen at 180° − θ on the screen.

### 1.2 Simulated observers (`public/app/js/sim/observers.js`) — answering the REAL procedures
- **Acuity** (`createAcuityProcedure`, QUEST, 4AFC Tumbling E): logistic psychometric function (γ 0.25, λ 0.02,
  slope 0.04 log; *not* the procedure's own Weibull) around the eye-model threshold at the true distance; "not sure"
  30 % of the time within ±0.06 of threshold. Renderable floor/ceiling limits computed as the view does.
- **Calibration errors**: card match N(0, 0.75 %) ×3 through `evaluateCardMatches`; blind-spot offset N(0, 3.5 %)
  through `distanceFromBlindSpot` with the *measured* px/mm; the camera tracker inherits that distance error (+1 %
  jitter). Stimuli are sized for what the app believes and seen at the true geometry.
- **Contrast** (`createContrastProcedure`): age norm 1.92 − 0.006·(age − 45) minus −log10 MTF of the blur disk at
  3 cycles/letter of the 2.8° letters (Solomon & Pelli 1994; large letters are robust to blur, Bradley et al. 1991).
- **Reading** (`analyseReading` etc., Hebrew, x-height 0.58): MNREAD-style curve; reading acuity = threshold + 0.05
  (+0.05 Hebrew), CPS = RA + 0.25, MRS 200 wpm (−0.4 %/y after 40), speed noise 0.06 log; comprehension 98 %
  above RA; below RA "can't read" 70 % or a guess on the 2-choice word check (Chung, Jarvis & Cheung 2007; Legge 2007).
- **Line dial** (`inferFromAnswers`): blur width across each spoke from the elliptical blur patch with a 0.3 D
  accommodative lag; the darkest spoke is reported when the visibility difference exceeds 0.12, else "all the same".
- **Focus range** (`combineNearPointRuns` / `combineFarPointRuns`, onboarding passes no acuity → absolute 0.3 / 0.1
  targets): the person taps at the *first* blur (threshold ≥ level − δ, δ ∈ [0, 0.1] per person) while blur is not
  improving in the direction of movement; 3 % reaction overshoot; 150 mm camera floor, 650 mm arm's length.

### 1.3 Pipeline and scoring (`sim/pipeline.js`, `sim/evaluate.js`)
Each person runs screen → distance → acuity R/L → focus → reading → contrast → dial R/L (+ an extra binocular acuity
for accuracy only); the draft goes through the real `buildProfileInput` (mode `none` → `wearsCorrection: false`) and
`computeProfile`. Scored against truth: measurement accuracy; legibility = rendered x-height / threshold x-height for
the TRUE eye with comfortable focusing at the recommended (else habitual) distance, Latin 0.52 em and Hebrew 0.58 em
with the ×1.12 Hebrew margin (smaller counts): PASS ≥ 2.0, READABLE 1.4–2.0, FAIL < 1.4; baseline = 16 px at the
habitual distance; characters per line on a 360-px phone (328 px line, 0.50 em Latin / 0.56 em Hebrew); distance
within 25–60 cm (≥ 33 cm under 18).

### 1.4 Cohort (`sim/cohort.js`, 61 people, habitual distance 30–45 cm, teens 28–33 cm, iPhone-15-/Pixel-8-like)
Myopia −0.5 … −8 D (25–40 y) and four teens (12–16 y); hyperopia +0.5/+1/+2/+3 at 25/45/60 y; emmetropic presbyopes
45–75 y; astigmatism −0.75/−1.5/−2.5 × 0/45/90/180 with sphere 0 and −1 (30 y); mixed: −2 @55, −1/−1×180 @50,
+2 @65, −6 @60, anisometropia R −1 / L −3. Healthy eyes only (no amblyopia, cataract, disease).

## 2. Engine: glasses-free assessment (`engine/profile.js`, `VisionProfile.glassesFree`)
Only when `wearsCorrection === false`. Same defocus model with population values (pupil by age, floor by age).
- Far-point vergence F = 1000/far + E(0.1 − 0.05) + 0.15 D overshoot (measured far points read long); ignored
  (`FOCUS_INCONSISTENT`) when it predicts > 0.2 log more blur at the test distance than measured (constant blur, e.g.
  astigmatism, makes the far sweep end at its 20 cm start); at the sweep start F is bounded by the measured threshold.
- Focusing range from the near point (0.3 target): amp = 1000/near − F − E(0.25); camera floor → age mean; "blurry
  at the start" → bounded by the measured threshold (or ignored under 40 y). Comfortable effort = amp − ½·max(amp,
  Hofstetter mean) − 0.25 D (latent long-sightedness cannot be told apart from a small amplitude; conservative).
- Prediction anchored to the measurement: within ±0.1 log the model is scaled; blur beyond that adds in quadrature.
- Distance: inside the predicted comfortable sharp window ∩ 25–60 cm (33–60 under 18) → the habitual distance clamped
  into it (not closer than 30 cm when possible); else the distance needing the least text (ties → nearest habit).
- Text: the unchanged §4.3 rules at that distance with the predicted threshold / CPS. No focus test → no distance
  advice and the measured size is kept (`FOCUS_NOT_MEASURED`, or `SHARP_AT_HABITUAL` under 40 with near-normal
  threshold).
- Verdict: `no` for CHILD, `TEXT_TOO_LARGE` (< 12 chars/line) or no sharp distance with > 0.2 log optical blur left;
  `partial` for NO_COMFORTABLE_DISTANCE, TOO_CLOSE (< 30 cm), TEXT_LARGE (< 24 chars/line), HIGH_ASTIGMATISM
  (consistent dial + residual blur), BLUR_AT_ALL_DISTANCES, UNRELIABLE, FOCUS_NOT_MEASURED/INCONSISTENT; else `yes`.
- Wording: `describeGlassesFree(assessment, lang)` in `engine/summary.js` (strings in
  `engine/strings/glasses-free-strings.js`, he + en, no clinical terms, eye exam always recommended).

## 3. Results (20 repetitions per person)

### 3.1 Measurement accuracy
| Quantity | n | bias | 95 % LoA |
|---|---:|---:|---|
| Monocular uncorrected acuity vs model truth | 2440 | +0.047 logMAR | −0.02 … +0.11 |
| Binocular acuity (extra run) | 1220 | +0.047 | −0.02 … +0.11 |
| Far point (dioptres, measured − true; true 22–60 cm) | 61 | −0.58 D (reads too far) | −0.83 … −0.32 D |
| Near point (dioptres; true 18–38 cm, above the camera floor) | 120 | +1.13 D (reads too close) | +0.86 … +1.41 D |

The +0.05 acuity bias is the expected offset between the person's 62 % logistic midpoint and QUEST's 70.5 % Weibull
threshold plus calibration error; 3 % of results are flagged unreliable. The focus-test biases are the depth of focus
allowed by its large targets (0.1 / 0.3 logMAR); the engine corrects for them. Because of that tolerance the far point
is only detected for myopia ≳ 2.25 D (51 % of the 22–60 cm far points; −2 D reads as "beyond arm's length").
Line dial: "suspected" in 2 % (no cyl), 34 % (0.75 D), 85 % (1.5 D), 86 % (2.5 D) of runs — but the internal axis is
off by ~90° in ≥ 90 % of detections: at phone distance nobody in the cohort is "fogged", and the accommodative lag
reverses the rule of 30. Only `suspected` is used by the engine; the axis must stay internal.

### 3.2 Legibility without glasses (run level)
| Runs | Default 16 px at habitual distance | SeeTuned profile at recommended distance |
|---|---|---|
| All (1220) | PASS 41 % · READABLE 16 % · FAIL 43 % | PASS 79 % · READABLE 15 % · FAIL 6 % |
| verdict yes (402) | PASS 85 % · READABLE 11 % · FAIL 3 % | PASS 96 % · READABLE 4 % · FAIL 0 % |
| verdict partial (390) | PASS 20 % · READABLE 39 % · FAIL 41 % | PASS 84 % · READABLE 16 % · FAIL 0.3 % |
| verdict no (348) | FAIL 100 % | PASS 49 % · READABLE 30 % · FAIL 22 % (64 px UI cap) |

### 3.3 Coverage (modal verdict per person)
| Group | People | yes | partial | no |
|---|---:|---:|---:|---:|
| Emmetropic < 45 y | 1 | 1 | 0 | 0 |
| Myopia −0.5 … −1 D | 2 | 2 | 0 | 0 |
| Myopia −1.5 … −2 D | 2 | 2 | 0 | 0 |
| Myopia −3 … −4 D | 2 | 1 | 1 | 0 |
| Myopia −5 … −8 D | 3 | 0 | 0 | 3 |
| Teens 12–16 y | 4 | (glasses mode — never assessed; forced input → `no`/CHILD) | | |
| Hyperopia < 45 y | 4 | 4 | 0 | 0 |
| Hyperopia ≥ 45 y | 8 | 0 | 1 | 7 |
| Emmetropic presbyopes 45–75 y | 6 | 2 (45, 55) | 0 | 4 |
| Astigmatism 0.75 D | 8 | 7 | 1 | 0 |
| Astigmatism 1.5 D | 8 | 0 | 8 | 0 |
| Astigmatism 2.5 D | 8 | 0 | 7 | 1 |
| Mixed | 5 | 2 | 1 | 2 |

Run level (adults): yes 35 %, partial 34 %, no 31 %. Property checks: 0 non-finite outputs; no under-18 "yes"
(and `no` for all 80 forced glasses-free teen inputs, recommended distance ≥ 33 cm); every recommended distance within
25–60 cm; monotonic text angle for worse eyes in all four series; 1 of 20 runs of the −4 D person got "yes" (far
point measured long) — still PASS. Verdicts flip between repetitions (< 80 % agreement) for
borderline people: +0.5 @45, +1 @45, 55 y emmetrope, 0.75 D cyl ×90/×180, 2.5 D cyl ×45, −2 @55, −1/−1×180 @50.

### 3.4 Per-person results (medians over 20 repetitions; full table with measured values in `cohort-results.md`)
| Person | Rx, age | Habitual cm | Verdict (share) | Rec. cm | Body px | Chars/line (he) | 16 px reserve | SeeTuned reserve |
|---|---|---:|---|---:|---:|---:|---|---|
| emm-25 | 0.00, 25 y | 30 | yes (95%) | 30 | 16.0 | 36 | 3.30 PASS | 3.30 (100% PASS) |
| myo-0.5-28 | -0.50, 28 y | 35 | yes (100%) | 35 | 16.0 | 36 | 3.02 PASS | 3.06 (100% PASS) |
| myo-1-30 | -1.00, 30 y | 40 | yes (95%) | 41 | 16.6 | 35 | 2.79 PASS | 2.86 (100% PASS) |
| myo-1.5-32 | -1.50, 32 y | 45 | yes (100%) | 45 | 19.4 | 30 | 2.36 PASS | 2.88 (100% PASS) |
| myo-2-35 | -2.00, 35 y | 34 | yes (100%) | 34 | 16.0 | 36 | 3.27 PASS | 3.37 (100% PASS) |
| myo-3-27 | -3.00, 27 y | 39 | yes (100%) | 37 | 16.9 | 34 | 2.16 PASS | 2.71 (100% PASS) |
| myo-4-38 | -4.00, 38 y | 44 | partial (95%) | 27 | 16.0 | 36 | 0.54 FAIL | 3.80 (100% PASS) |
| myo-5-31 | -5.00, 31 y | 33 | no (100%) | 25 | 18.3 | 31.5 | 0.68 FAIL | 2.13 (75% PASS) |
| myo-6-36 | -6.00, 36 y | 38 | no (100%) | 25 | 38.8 | 15 | 0.38 FAIL | 2.44 (75% PASS) |
| myo-8-40 | -8.00, 40 y | 43 | no (100%) | 25 | 64.0 | 8 | 0.15 FAIL | 1.51 (0% PASS) |
| teen-0.75-12 | -0.75, 12 y | 28 | – (glasses mode) | 33 | 16.0 | 36 | 3.86 PASS | 3.27 (100% PASS) |
| teen-1-13 | -1.00, 13 y | 30 | – (glasses mode) | 33 | 16.0 | 36 | 3.41 PASS | 3.05 (100% PASS) |
| teen-2-15 | -2.00, 15 y | 33 | – (glasses mode) | 33 | 16.0 | 36 | 3.31 PASS | 3.26 (100% PASS) |
| teen-3-16 | -3.00, 16 y | 34 | – (glasses mode) | 34 | 16.0 | 36 | 3.45 PASS | 3.45 (100% PASS) |
| hyp+0.5-25 | +0.50, 25 y | 36 | yes (95%) | 37 | 16.0 | 36 | 3.15 PASS | 3.24 (100% PASS) |
| hyp+0.5-45 | +0.50, 45 y | 41 | partial (60%) | 51 | 25.2 | 22.5 | 1.75 READABLE | 3.21 (100% PASS) |
| hyp+0.5-60 | +0.50, 60 y | 30 | no (100%) | 42 | 64.0 | 9 | 0.48 FAIL | 1.95 (0% PASS) |
| hyp+1-25 | +1.00, 25 y | 35 | yes (100%) | 35 | 16.0 | 36 | 3.30 PASS | 3.30 (100% PASS) |
| hyp+1-45 | +1.00, 45 y | 40 | no (75%) | 59 | 34.8 | 16.5 | 1.01 FAIL | 3.83 (100% PASS) |
| hyp+1-60 | +1.00, 60 y | 45 | no (100%) | 30 | 64.0 | 9 | 0.30 FAIL | 1.32 (0% PASS) |
| hyp+2-25 | +2.00, 25 y | 34 | yes (100%) | 34 | 16.0 | 36 | 3.08 PASS | 3.13 (100% PASS) |
| hyp+2-45 | +2.00, 45 y | 39 | no (100%) | 56 | 62.6 | 9 | 0.56 FAIL | 2.52 (95% PASS) |
| hyp+2-60 | +2.00, 60 y | 44 | no (100%) | 35 | 64.0 | 9 | 0.31 FAIL | 1.35 (0% PASS) |
| hyp+3-25 | +3.00, 25 y | 33 | yes (100%) | 33 | 16.0 | 36 | 1.76 READABLE | 1.76 (15% PASS) |
| hyp+3-45 | +3.00, 45 y | 38 | no (100%) | 44 | 64.0 | 9 | 0.40 FAIL | 1.60 (0% PASS) |
| hyp+3-60 | +3.00, 60 y | 43 | no (100%) | 26 | 64.0 | 8 | 0.20 FAIL | 1.02 (0% PASS) |
| presb-45 | 0.00, 45 y | 32 | yes (90%) | 39 | 18.2 | 31.5 | 1.87 READABLE | 2.93 (100% PASS) |
| presb-50 | 0.00, 50 y | 37 | no (100%) | 46 | 64.0 | 9 | 0.68 FAIL | 3.25 (100% PASS) |
| presb-55 | 0.00, 55 y | 42 | yes (55%) | 53 | 24.0 | 24 | 1.36 FAIL | 2.86 (100% PASS) |
| presb-60 | 0.00, 60 y | 31 | no (100%) | 42 | 64.0 | 9 | 0.50 FAIL | 2.07 (100% PASS) |
| presb-65 | 0.00, 65 y | 36 | no (100%) | 41 | 64.0 | 9 | 0.49 FAIL | 1.96 (0% PASS) |
| presb-75 | 0.00, 75 y | 41 | no (100%) | 42 | 64.0 | 9 | 0.64 FAIL | 2.57 (100% PASS) |
| ast0-0.75x0 | 0.00/-0.75×0, 30 y | 30 | yes (100%) | 30 | 16.0 | 36 | 3.61 PASS | 3.61 (100% PASS) |
| ast-1-0.75x0 | -1.00/-0.75×0, 30 y | 35 | yes (95%) | 35 | 16.0 | 35.5 | 2.85 PASS | 3.03 (100% PASS) |
| ast0-0.75x45 | 0.00/-0.75×45, 30 y | 40 | yes (90%) | 40 | 17.4 | 31.5 | 2.71 PASS | 2.93 (100% PASS) |
| ast-1-0.75x45 | -1.00/-0.75×45, 30 y | 45 | yes (80%) | 44 | 19.9 | 27 | 2.30 PASS | 2.86 (100% PASS) |
| ast0-0.75x90 | 0.00/-0.75×90, 30 y | 34 | yes (60%) | 34 | 16.0 | 34 | 2.82 PASS | 2.86 (100% PASS) |
| ast-1-0.75x90 | -1.00/-0.75×90, 30 y | 39 | yes (85%) | 39 | 17.1 | 31 | 2.57 PASS | 2.73 (100% PASS) |
| ast0-0.75x180 | 0.00/-0.75×180, 30 y | 44 | partial (60%) | 44 | 19.3 | 28 | 2.30 PASS | 2.71 (100% PASS) |
| ast-1-0.75x180 | -1.00/-0.75×180, 30 y | 33 | yes (100%) | 33 | 16.0 | 36 | 3.34 PASS | 3.44 (100% PASS) |
| ast0-1.5x0 | 0.00/-1.50×0, 30 y | 38 | partial (100%) | 38 | 24.9 | 21 | 1.66 READABLE | 2.64 (90% PASS) |
| ast-1-1.5x0 | -1.00/-1.50×0, 30 y | 43 | partial (100%) | 44 | 25.1 | 21 | 1.43 READABLE | 2.18 (90% PASS) |
| ast0-1.5x45 | 0.00/-1.50×45, 30 y | 32 | partial (100%) | 32 | 19.9 | 27 | 2.10 PASS | 2.66 (100% PASS) |
| ast-1-1.5x45 | -1.00/-1.50×45, 30 y | 37 | partial (100%) | 38 | 21.8 | 24.5 | 1.96 READABLE | 2.64 (100% PASS) |
| ast0-1.5x90 | 0.00/-1.50×90, 30 y | 42 | partial (100%) | 42 | 22.7 | 23.5 | 1.53 READABLE | 2.14 (85% PASS) |
| ast-1-1.5x90 | -1.00/-1.50×90, 30 y | 31 | partial (100%) | 31 | 20.1 | 26.5 | 2.00 READABLE | 2.52 (90% PASS) |
| ast0-1.5x180 | 0.00/-1.50×180, 30 y | 36 | partial (100%) | 36 | 22.1 | 24.5 | 1.93 READABLE | 2.63 (95% PASS) |
| ast-1-1.5x180 | -1.00/-1.50×180, 30 y | 41 | partial (100%) | 41 | 25.0 | 21.5 | 1.48 READABLE | 2.26 (90% PASS) |
| ast0-2.5x0 | 0.00/-2.50×0, 30 y | 30 | partial (80%) | 30 | 26.3 | 20 | 1.22 FAIL | 1.95 (45% PASS) |
| ast-1-2.5x0 | -1.00/-2.50×0, 30 y | 35 | partial (95%) | 36 | 37.0 | 14 | 0.92 FAIL | 2.07 (60% PASS) |
| ast0-2.5x45 | 0.00/-2.50×45, 30 y | 40 | partial (70%) | 40 | 41.3 | 13 | 0.82 FAIL | 2.12 (90% PASS) |
| ast-1-2.5x45 | -1.00/-2.50×45, 30 y | 45 | no (95%) | 45 | 55.0 | 10 | 0.64 FAIL | 2.14 (85% PASS) |
| ast0-2.5x90 | 0.00/-2.50×90, 30 y | 34 | partial (100%) | 34 | 30.6 | 17 | 1.07 FAIL | 2.02 (60% PASS) |
| ast-1-2.5x90 | -1.00/-2.50×90, 30 y | 39 | partial (100%) | 39 | 31.0 | 17 | 1.12 FAIL | 2.10 (55% PASS) |
| ast0-2.5x180 | 0.00/-2.50×180, 30 y | 44 | partial (85%) | 44 | 43.5 | 12 | 0.79 FAIL | 2.12 (75% PASS) |
| ast-1-2.5x180 | -1.00/-2.50×180, 30 y | 33 | partial (100%) | 33 | 32.8 | 16 | 0.98 FAIL | 2.00 (50% PASS) |
| myo-2-55 | -2.00, 55 y | 38 | partial (70%) | 58 | 26.6 | 21.5 | 2.90 PASS | 3.18 (100% PASS) |
| myoast-1-1x180-50 | -1.00/-1.00×180, 50 y | 43 | yes (55%) | 44 | 20.1 | 27 | 2.06 PASS | 2.50 (100% PASS) |
| hyp+2-65 | +2.00, 65 y | 32 | no (100%) | 27 | 64.0 | 8 | 0.32 FAIL | 1.34 (0% PASS) |
| myo-6-60 | -6.00, 60 y | 37 | no (100%) | 25 | 39.1 | 14.5 | 0.40 FAIL | 2.48 (90% PASS) |
| aniso-1-3 | R -1.00 / L -3.00, 30 y | 42 | yes (95%) | 42 | 17.7 | 32 | 2.72 PASS | 2.91 (100% PASS) |

### 3.5 Image check (`docs/validation/images/`, `scripts/sim/render-views.js`)
The real app reader (server on :4111, Hebrew sample text, profile seeded via `core/storage.js`) was captured on a
393-px phone at dpr 2 and blurred in the page (FFT, linear light) with each person's PSF for comfortable focusing at
the viewing distance and the screen's px/mm. Left: default 16 px at the habitual distance; right: SeeTuned profile at
the recommended distance; panels are scaled by visual angle. Inspected visually:

| Image | What it shows |
|---|---|
| `myo-1-30.png`, `myo-3-27.png` | −1 / −3 D: already near-sharp at 16 px (inside the far point); profile keeps it, slightly larger. |
| `myo-4-38.png` | −4 D: same 16 px, but held at 27 cm instead of 44 cm turns a blurred grey block into sharp text (partial: close). |
| `myo-6-36.png` | −6 D: 35 px at 25 cm is decipherable but visibly blurred — the honest "no". |
| `presb-45.png` | 45 y: 19.6 px at 40 cm instead of 16 px at 32 cm — sharp ("yes"). |
| `presb-55.png` | 55 y: 24–44 px at 55 cm: large, readable; text-heavy reading is clumsy (partial/yes borderline). |
| `ast0-1.5x90.png` | 1.5 D cyl: larger, heavier text is readable but blur remains at every distance (partial). |
| `myo-2-55.png` | −2 D at 55 y: sharp at ~58 cm with larger text (the myopic presbyope who reads without glasses). |
| `issue-reader-64px-overflow.png` | UI issue: at 64 px the reader page overflows horizontally (see 4.2). |

## 4. Bugs found by the simulation

### 4.1 Fixed (in my files, with unit tests)
1. **Line-dial result never counted as consistent** (`profile.js`): the dial view returns `{suspected, axisDeg}`
   without `consistent`, so `LINES_UNEVEN_*` and the dial-driven weight/spacing never fired from the real flow. The
   view only reports `suspected` when ≥ 2 of 3 answers agree, so a missing field now means consistent (an explicit
   `false` still does not). Flag now fires in 94 % of runs with ≥ 1.5 D cylinder, 3 % without.
2. **"Reading glasses" advice to young myopes** (`profile.js`, §9.5): the comfortable near limit used 2000/Amp, which
   ignores that an uncorrected myope needs only 1000/d − 1000/far of effort; and a near point at the 15 cm camera
   floor was used as the amplitude itself. Now 1000/(F + Amp/2) with the floor-limited amplitude raised to the age
   minimum; `FOCUS_RANGE_LIMITED` = comfortable range < 10 cm. `NEAR_FOCUS_FAR` in under-40s: 16 % → 0 %; the −3 D
   27-year-old no longer gets `FOCUS_RANGE_LIMITED`. (Spec text §9.5 should be updated accordingly; tests updated.)
3. **Implausible critical print size shrank the text** (`profile.js`): a lucky guess on the 2-choice word check can
   make `analyseReading` return a "reliable" CPS far below the letter acuity (seen: CPS 0.1 with acuity 0.54 → body
   text sized for a person who cannot read it, FAIL). A CPS > 0.1 below the acuity is now ignored (listed under
   `UNRELIABLE`), and a CPS more than 0.4 above the reading acuity (curve-fit artefact; single-run CPS errors reached
   +0.4 log) is capped.
4. **Text sized for the wrong distance without glasses** (`profile.js`): text was sized at the recommended distance
   with the threshold *measured at the test distance*; without correction the threshold changes with distance
   (blur ∝ |1/d − far-point vergence|). Glasses-free mode now predicts the threshold at the chosen distance.
5. **Misleading far-point flag** (`profile.js`): with constant blur (astigmatism) the far sweep ends at its 20 cm start,
   producing `DISTANCE_FOCUS_LIMITED (20 cm)` for 30-year-olds with 0 D sphere; suppressed when the glasses-free model
   finds the far point contradicted by the measured threshold.
6. Minors: the §9.5 recommended distance is now never below 33 cm under 18.
Also: `npm run typecheck` — `scripts/sim/**` moved from the server project to a new `jsconfig.sim.json` (DOM + Node
types), added to the `typecheck` script.

### 4.2 Found, not mine — for the owners
- **A6/A12 (reader/viewer layout)**: at large profile sizes the reader overflows horizontally (document 434 px wide at
  44 px body, 620 px at 64 px, on a 393-px viewport); text is clipped and the toolbar/buttons are cut
  (`images/issue-reader-64px-overflow.png`). Everyone with a `no`/`partial` verdict hits this.
- **A4 (`acuity-view.js`)**: the returned `AcuityResult` drops `ceilingLimited`, `sd`, `ci95` and `reasons` from the
  procedure's estimate, so the engine's ceiling-limited rules (urgent flag, magnification shortcut) can never fire.
- **A4 (`reading-math.js analyseReading`)**: passes on a 2-choice word check are accepted at sizes the person cannot
  read (50 % guess rate) — consider requiring a sensible reading time or two consecutive passes for reading acuity;
  single-run CPS is noisy (95 % within −0.15…+0.16 log, outliers +0.4), which spreads text size by ±40 % between
  repetitions (e.g. presb-55: 22–36 px).
- **A3 (`focus-range-view.js` / spec §9.3)**: the 0.1-logMAR far target tolerates ~0.5 D, so far points of −1.5 to
  −2 D read as "beyond arm's length" (detection only from ~−2.25 D); the near target (0.3) moves near points ~1.1 D
  closer; with constant blur both sweeps end at their start. The engine compensates, but the UI text "text stays sharp
  between X and Y cm" shows the raw values.
- **Dial axis**: rotated by ~90° at phone distance (accommodative lag; rule of 30 assumes fogging) — keep it internal
  (it already is) and never use it for rendering.

## 5. Open risks and limits
- **Latent long-sightedness in young adults is invisible** to these tests (+3 D at 25 y: near point below the 15 cm
  camera floor, acuity normal with effort): verdict `yes` with reserve 1.6–1.8 (READABLE) under the ½-amplitude
  comfort rule — 17 of 402 "yes" runs. The wording therefore always says to switch back to glasses / get an exam if
  the eyes feel tired.
- **The model is a model**: Smith-type blur with a fitted dead zone, population pupils, Hofstetter amplitudes, no
  higher-order aberrations, no accommodative fluctuation in acuity, no binocular summation, healthy eyes only. The
  engine shares the physics with the simulator (different individual parameters, noise and perceptual criteria), so
  agreement is partly by construction; real-user validation (a small study with refraction + the app) is needed
  before any claim, and the verdict must stay advisory.
- **Comfort ≠ legibility**: the ½-amplitude rule is a convention; individual tolerance varies widely around 45–55 y,
  which is where verdicts flip between repetitions.
- **Behavioural assumptions**: people hold the phone at the recommended distance; first-blur criteria and reaction
  overshoot are assumed (0–0.1 log, 3 %). Real far-point taps may be noisier; the 0.15 D overshoot correction is
  borrowed from a smartphone far-point app's 0.17 D bias (TVST 2022).
- **64 px UI cap**: "no" verdicts often need more; legibility for them is limited by the cap (22 % FAIL).
- **Wording** must never become "glasses-free screen", "replaces glasses" or "corrects vision" (spec §11.3); the
  strings are checked by `test/unit/engine/glasses-free.test.js`.

## References
Smith G. Relation between spherical refractive error and visual acuity. *Optom Vis Sci* 1991;68:591–598.
Rushton RM, Armstrong RA, Dunne MCM. The influence on unaided vision of age, pupil diameter and sphero-cylindrical
refractive error. *Clin Exp Optom* 2016;99(4). · Raasch TW. Spherocylindrical refractive errors and visual acuity.
*Optom Vis Sci* 1995;72:272–275. · Thibos LN, Wheeler W, Horner D. Power vectors. *Optom Vis Sci* 1997;74:367–375. ·
Watson AB, Yellott JI. A unified formula for light-adapted pupil size. *J Vis* 2012;12(10):12. · Hofstetter HW.
*Optom World* 1950;38:42–45. · Elliott DB, Yang KCH, Whitaker D. Visual acuity changes throughout adulthood.
*Optom Vis Sci* 1995;72:186–191. · Bradley A et al. Effects of spherical and astigmatic defocus on acuity and contrast
sensitivity. *Optom Vis Sci* 1991;68:518–521. · Solomon JA, Pelli DG. *Nature* 1994;369:395–397. · Chung STL, Jarvis
SH, Cheung SH. The effect of dioptric blur on reading performance. *Vision Res* 2007;47:1584–1594. · Legge GE.
*Psychophysics of Reading in Normal and Low Vision*, 2007. · Visual acuity degradation under positive lens–induced
myopic defocus in young adults (repeated-measures study, PMC13475252). · Smartphone far-point app, *TVST* 2022.
