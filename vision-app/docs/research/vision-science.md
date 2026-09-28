# Vision Science Engineering Specification

**Owner:** A1 (Vision Science Lead) | **Status:** v1.0 research spec, 2026-09-28 | **Audience:** engineers implementing the self-test + screen-personalization PWA (phone/tablet, iOS/Android, Hebrew-first).

This document says what to measure, how to measure it on an uncalibrated phone, which formulas and constants to use, and what the product may and may not claim. The last two sections, **IMPLEMENTATION SPEC SUMMARY** and **PRODUCT CLAIMS**, are the parts to copy from. The sections before them give the evidence.

## 0. Conventions, evidence grading, and how to read this spec

### 0.1 Evidence tags (put next to every number engineers may copy)

| Tag | Meaning |
|---|---|
| **[V]** | Verified in this session against the primary artefact itself: standard or official documentation text, official source code (Apple HIG JSON, AOSP source, MediaPipe source, jsPsych plugin source), or the published matrices. |
| **[S]** | Verified against the abstract or results summary of the cited peer-reviewed paper (retrieved through a search index). Numbers match the paper's abstract. The full text was not opened. |
| **[U]** | Standard domain knowledge or a textbook convention that could not be re-verified in this session because of network restrictions. Treat it as a strong default, but a human must confirm it before a medical or regulatory claim relies on it. |
| **[D]** | A design decision or heuristic made by A1 (sometimes backed by our own simulation). It is not a literature value. Tune it in the pilot and validation study. |

### 0.2 Units and symbols used everywhere

- `d` = viewing distance, from the corneal plane to the stimulus on screen. Stored in **mm**.
- `MAR` = minimum angle of resolution in **arcmin**. `logMAR = log10(MAR)`.
- 1 arcmin = π/10800 rad = 2.908882e-4 rad. [V: arithmetic]
- A physical size `s` subtends the visual angle `θ = 2·atan(s / (2d))`. The inverse is `s = 2·d·tan(θ/2)`. Always use the exact formula. The small-angle approximation is fine below 5° but costs nothing to avoid.
- `px_css` = CSS pixel. `px_dev` = device (physical) pixel. `dpr = window.devicePixelRatio`.
- `mmPerCss` = physical millimetres per CSS pixel, measured by the calibration in §1. Then `mmPerDev = mmPerCss / dpr`.
- Colour: "linear RGB" means linear-light sRGB primaries (§7.1). All matrices in §7 act on linear RGB, never on gamma-encoded 0–255 values.

### 0.3 Global test-environment requirements (apply to all visual tests)

These requirements are [D], based on the display caveats in §1 and §5.

1. PWA running in standalone or full-screen mode, with page zoom at 100%. Check `visualViewport.scale === 1` and that `devicePixelRatio` equals the value stored at calibration. If either differs, force recalibration.
2. Screen brightness at maximum or at least 75%, with auto-brightness preferably off during the test. Night Shift, True Tone, Night Light, Eye Comfort Shield, blue-light filters, Color Filters and Color Correction all off. The web cannot detect most of these, so ask the user explicitly and store the answers.
3. Indoor, evenly lit room, with no glare or reflections on the screen.
4. The user wears the correction they normally use for the phone (none, distance glasses, readers, progressives or contacts). Store which one, because the result only applies to that correction.
5. The camera is used for distance only. Frames are processed on-device and never uploaded; this is a privacy requirement from the product side.
6. RTL safety: the Hebrew UI uses `dir="rtl"`. Stimuli (Tumbling E, Landolt C, arrows, swipe mapping, Amsler grid, clock dial) must be rendered in a container with `direction:ltr` and must never be mirrored. Response directions are absolute (up/down/left/right on the physical screen).

---

## 1. Physical screen calibration on the web

### 1.1 Why calibration is required

- CSS absolute units (`in`, `cm`, `mm`, `pt`) are not physical on phones. They are defined through the **CSS reference pixel**: the visual angle of one pixel on a 96 dpi device at arm's length (28 in), which is about 0.0213° [U: CSS Values & Units Level 3]. Browsers map one CSS px to an integer or fractional number of device pixels, `dpr`, chosen by the vendor. As a result, 1 CSS inch is not 25.4 mm on any modern phone.
  - Example: iPhone 15/16, 460 ppi, dpr 3. 1 px_css = 3 × 25.4/460 = **0.1657 mm**, so 1 CSS "inch" = 15.9 mm.
  - Example: Pixel 8, 428 ppi, dpr 2.625. 1 px_css = **0.1558 mm**.
- The web platform does not expose the display's ppi.
- `devicePixelRatio` can be non-integer on Android (2.625, 2.75, 3.5 …). It can also change with browser page zoom: Chrome for Android now applies page zoom the same way as desktop.
- **Therefore:** calibrate `mmPerCss` once per device, store `{mmPerCss, dpr, screen.width, screen.height, orientation, UA}`, and invalidate the calibration whenever `dpr` or the screen size changes.

### 1.2 Recommended method: card-matching (ISO/IEC 7810 ID-1)

- **Card dimensions** [V: jsPsych virtual-chinrest plugin default, citing ID-1]: **85.60 mm × 53.98 mm** (3.370 × 2.125 in), aspect ratio 1.5858.
- **Other ID-1 geometry** [U: ISO/IEC 7810:2019]:
  - Corner radius 3.18 mm.
  - Thickness 0.76 mm.
  - Tolerances approximately 85.47–85.72 mm × 53.92–54.03 mm, i.e. about ±0.15%. This is negligible for our use.
- Any bank card, ID card or loyalty card in ID-1 format works. Tell the user not to use business cards, which have different sizes.

**Procedure** [D, adapted from Li et al. 2020 phase 1]:

1. Portrait orientation. Draw a rounded rectangle, corner radius = 3.18/85.60 of its width, with the long side vertical, i.e. parallel to the device's long axis.
   - The long side must be vertical because 85.6 mm does not fit across the short side of most phones: iPhone 15 portrait width is 65 mm and iPhone SE is 58 mm.
   - Card size on an iPhone 15: 85.6 mm ≈ 517 px_css.
2. The user lays the card flat on the glass, aligns one corner with the drawn corner, and resizes the rectangle with a slider plus ±1 px fine buttons until the card edges and the drawn edges coincide.
3. Keep the aspect ratio locked at 85.60/53.98.
4. Compute `mmPerCss = 85.60 / rectLongSide_css`.
5. Repeat twice, starting once from a too-large and once from a too-small rectangle. Accept the calibration if the two results differ by ≤ 1.5%, and store their mean. Otherwise do a third match and use the median.
6. **Plausibility check:** accept only if `mmPerCss·dpr`, the device pixel pitch, falls between 0.040 and 0.120 mm (about 210–635 ppi).
   - Where the device model can be inferred (for example `screen.width`, `screen.height` and `dpr` for known iPhones), compare with the model's known ppi. Warn if the two disagree by more than 3%.
   - Keep an internal table of popular devices as a cross-check. It must never be the only source.

**Accuracy:** careful matching gives about ±0.5 mm on 85.6 mm, i.e. about ±0.6% [D, estimate]. In size terms that is 0.0026 log units, which is negligible next to distance error.

### 1.3 Rendering crisp optotypes on `<canvas>` at device resolution

These rules are [D] unless marked otherwise.

1. **Backing store in device pixels.**
   - `canvas.width = round(cssW·dpr)` and `canvas.height = round(cssH·dpr)`. Style the element at `cssW × cssH` px_css. Draw with the identity transform, i.e. in device px.
   - Where supported, use a `ResizeObserver` with `{box:'device-pixel-content-box'}` and read `devicePixelContentBoxSize` for exact integers. This works in Chromium and Firefox.
   - Safari does not implement device-pixel-content-box [S: MDN / WebKit discussion]. There, use `round(rect.width·dpr)` and position the canvas at integer device-pixel offsets.
2. **Draw optotypes as geometry, never as font text.** Font rasterisation, hinting and metrics vary across devices.
   - **Tumbling E:** a 5×5-unit square with 3 horizontal bars 5 units long and 1 unit thick, 1-unit gaps, and a 1-unit spine.
   - **Landolt C** (ISO 8596) [S]: outer diameter 5 units, stroke 1 unit, gap 1 unit.
   - 1 unit = stroke = MAR.
3. **Compute size in device px:**
   - `stroke_dev = (2·d·tan(MAR·π/21600)) / mmPerDev`, where MAR is in arcmin and `d` in mm.
   - `letter_dev = 5·stroke_dev`.
4. **Do not snap sizes to integer pixels.** Rounding a 2.4 px stroke to 2 px is a 0.08 logMAR error.
   - Draw the exact floating-point geometry and let the canvas anti-alias it (`imageSmoothingEnabled` is irrelevant for paths).
   - Anti-aliasing preserves the effective stimulus size to sub-pixel precision. The Freiburg Acuity Test (FrACT) relies on this and allows strokes and gaps down to 0.5 px when anti-aliasing is enabled [S: Bach 1996/2007, FrACT manual].
   - Snap only the optotype's **position**, so its left and top edges fall on a pixel boundary.
5. **Minimum renderable level** [D, stricter than FrACT for OLED subpixel layouts and uncontrolled viewing]:
   - Never present an acuity level whose `stroke_dev < 1.0`.
   - If the adaptive algorithm asks for a smaller size, present `stroke_dev = 1.0` and mark the result as **ceiling-limited**: "acuity at least as good as X".
   - In practice, test at a distance where logMAR −0.2 gives a stroke of at least 1 px_dev (table below).
6. **Colours:**
   - Pure black `#000` optotype on pure white `#fff`, which is the maximum contrast available.
   - Canvas default colour space `srgb`. Do not use `display-p3` for tests.
7. **Frame timing:** optotypes are static; present them until the user responds. Any moving stimulus (the blind-spot ball) must use time-based motion (`performance.now()`), never px-per-frame, because 120 Hz ProMotion displays would otherwise double the speed.

**Minimum device pixels per stroke: what our target devices can render** [V: arithmetic from the formula above; ppi from vendor specs]:

| Device (ppi) | d = 30 cm: stroke at logMAR 0 | Best logMAR with stroke ≥ 1 px | d = 40 cm: stroke at logMAR 0 | Best logMAR with stroke ≥ 1 px |
|---|---|---|---|---|
| iPhone 15/16 (460) | 1.58 px | −0.20 | 2.11 px | −0.32 |
| Pixel 8 (428) | 1.47 px | −0.17 | 1.96 px | −0.29 |
| Galaxy S24 (416) | 1.43 px | −0.16 | 1.91 px | −0.28 |
| iPhone SE 3 (326) | 1.12 px | −0.05 | 1.49 px | −0.17 |
| iPad 10th / iPad Pro 11 (264) | 0.91 px | +0.04 | 1.21 px | −0.08 |

**Consequence** [D]: run the acuity test at d ≥ 35 cm on phones and d ≥ 40 cm on tablets. If a 264 ppi tablet cannot reach logMAR −0.1, report the result as "≤ −0.08" (ceiling-limited). This is harmless for our purposes, because personalisation only acts on worse-than-normal results.

### 1.4 Limitations

- The card match depends on user care. Detect careless matching with the repeat-agreement rule above.
- Some Android browsers apply "text scaling" or page zoom. Recalibrate whenever `dpr` or `innerWidth` changes.
- OLED displays with PenTile or diamond subpixel layouts have lower red and blue resolution. Black-on-white stimuli use all subpixels, which is why we require black on white.

**Citations**
- Li Q, Joo SJ, Yeatman JD, Reinecke K. Controlling for participants' viewing distance in large-scale, psychophysical online experiments using a virtual chinrest. *Sci Rep* 2020;10:904. doi:10.1038/s41598-019-57204-1
- jsPsych `@jspsych/plugin-virtual-chinrest` v3.1.0 source (npm), defaults `item_width_mm = 85.6`, `item_height_mm = 53.98`.
- ISO/IEC 7810:2019 *Identification cards — Physical characteristics*.
- Bach M. The Freiburg Visual Acuity Test — automatic measurement of visual acuity. *Optom Vis Sci* 1996;73:49–53. Bach M. The Freiburg Visual Acuity Test — variability unchanged by post-hoc re-analysis. *Graefes Arch* 2007;245:965–971.
- MDN: `ResizeObserverEntry.devicePixelContentBoxSize`.

---

## 2. Viewing distance measurement

### 2.1 (a) The "virtual chinrest" blind-spot method (Li, Joo, Yeatman & Reinecke 2020)

**What the paper and reference code do**:

- **Phase 1:** card calibration, as in §1. [V: jsPsych plugin source]
- **Phase 2:** blind-spot localisation. [V: jsPsych plugin source]
  - The user closes the **right eye** and fixates a black square with the **left eye**. The square sits at the right edge of the test area.
  - A red ball starts at 85% of the area width, i.e. near fixation on its left, and moves **leftwards**, away from fixation into the temporal visual field of the left eye.
  - The user presses a key the moment the ball disappears. That is the moment the ball enters the blind spot at its nasal border.
  - Default **5 repetitions**. The plugin moves the ball 2 px per animation frame; do not copy that.
- **Distance formula** [V]: `viewDistance_mm = (x_square − mean(x_ball_at_disappearance))_px / (px per mm) / tan(13.5°)`.
- **The angle** [V, S]: "the blind spot is located at **13.5°** temporally". This is the eccentricity of the blind spot's nasal edge, where the ball disappears.
- **Validation** [S]: two lab studies. They used a 2 × 3 within-subjects design with 13″ and 23″ screens at 43, 53 and 66 cm.
  - Mean absolute error 3.25 cm (SD 2.40 cm), which is about 5–7% at those distances.
  - In online use, participants' distances ranged 17.4–68.3 cm (mean 47.3, SD 8.9). The within-subject SD across repetitions was 3.9 cm on average.
  - **The method was not validated on phones.**

**Blind-spot anatomy (context)** [U: textbook values, e.g. Rohrschneider 2004 IOVS for fovea–disc geometry]:
- Blind-spot centre about 15.5° temporal and about 1.5° below the horizontal meridian.
- Size about 5.5° wide × 7.5° high, so its nasal edge is at about 12.5–13.5° and its temporal edge at about 18°.
- Between-person SD of the location is about 1°. That gives about ±7% distance error from anatomy alone.
- Fine-scale border measurements: see PMC10494866 (2023).

**Feasibility on a phone held at 30–45 cm** [V: arithmetic]. The horizontal offset needed at 13.5° is `d·tan(13.5°)`:
- 30 cm → 7.20 cm
- 35 cm → 8.40 cm
- 40 cm → 9.60 cm
- 45 cm → 10.80 cm

Phone screens in **portrait** are only 5.8–7.3 cm wide, so **portrait is impossible at normal distances**: an iPhone 15 in portrait supports at most about 21 cm. In **landscape**, with a 1.5 cm margin for the fixation mark and ball:

| Device | Long side | Max d (landscape) | Max d (portrait) |
|---|---|---|---|
| iPhone 15 | 14.11 cm | 52.5 cm | 20.9 cm |
| iPhone 16 Pro Max | 15.84 cm | 59.7 cm | 24.1 cm |
| Pixel 8 | 14.24 cm | 53.1 cm | 20.4 cm |
| iPhone SE 3 | 10.39 cm | 37.0 cm | 18.1 cm |
| iPad 10th gen | 22.71 cm | 88.3 cm | 59.5 cm |

**Landscape is mandatory on phones.** Lock orientation or ask the user to rotate. Deduct safe-area insets (notch or Dynamic Island) from the usable width.

**Phone protocol** [D, derived from Li et al.]:

1. Landscape, card calibration done. The phone is held or propped at the user's habitual distance, **perpendicular to the line of sight**, with the fixation mark straight ahead of the tested eye.
2. **Left-eye run:** close or cover the right eye. Fixation square (side 0.5°, black) near the right edge of the screen.
3. The red disc (diameter 0.5°, `#e00000` on a white or light-grey background) starts 4° left of fixation. It moves leftwards at **2.0°/s**, computed in mm/s from an initial guess of d = 35 cm. With the true d between 25 and 50 cm the actual speed is 1.4–2.8°/s. The user taps anywhere on the screen when the disc vanishes.
4. **Reaction-time correction:**
   - At 2°/s a 250 ms reaction time overshoots by 0.5°, which inflates d by about 4%.
   - Cancel this by alternating trial types:
     - **"Disappear" trials:** outward motion, as above.
     - **"Reappear" trials:** the disc starts 16.0° from fixation (inside the blind spot, using the first estimate) and moves inward. The user taps when it reappears.
   - The mean of the two sets cancels the reaction-time bias to first order.
   - Use 4 + 4 trials per eye.
5. **Right-eye run:** mirror image, with fixation near the left edge and the disc moving rightwards.
6. **Per-trial estimate:** `d_i = offset_mm_i / tan(13.5°)`.
7. **Rejection rules:**
   - Discard trials with offset outside 4°–22° of the current estimate.
   - Reject the run if the coefficient of variation of the kept trials is above 10%. The expected within-subject SD is about 3.9 cm at about 47 cm, i.e. about 8%.
   - If the two eyes differ by more than 12%, repeat.
8. **Result:** `D_bs = median(all kept d_i)`. Expected accuracy is about ±3 cm, i.e. ±7% [S for desktop; unvalidated on phones, so validate in our pilot].

### 2.2 (b) Camera-based distance with MediaPipe Face Landmarker iris landmarks

**Model and landmarks** [V: MediaPipe source]:
- Face Landmarker (MediaPipe Tasks for Web) outputs 478 landmarks: 468 face landmarks plus 10 iris landmarks.
- Iris contour indices: `FACEMESH_RIGHT_IRIS = 469–472` and `FACEMESH_LEFT_IRIS = 474–477`.
- The iris centres are 468 (right) and 473 (left).

**The constant** [V: MediaPipe doc and code]:
- The documentation states that the horizontal iris diameter "remains roughly constant at **11.7 ± 0.5 mm** across a wide population".
- The reference C++ calculator `iris_to_depth_calculator.cc` actually uses `kIrisSizeInMM = 11.8`.
- Anthropometric source [S]: Rüfer et al. 2005, Orbscan white-to-white in 390 healthy adults aged 10–80:
  - 11.71 ± 0.42 mm overall.
  - Men 11.77 ± 0.37 mm; women 11.64 ± 0.47 mm.
  - Normal ranges 11.04–12.50 mm (men) and 10.70–12.58 mm (women).
- **Use 11.71 mm** as the population prior, and replace it with the per-user calibration below.
- Using the population value alone adds about 3.6% (1 SD) of person-specific error, i.e. about ±7% at 95%.

**MediaPipe's own depth algorithm** [V: source code], which we reproduce in JavaScript:
- `iris_px = (|p_top − p_bottom| + |p_left − p_right|) / 2`, i.e. the mean of the vertical and horizontal diameters of one iris, in image pixels.
- `r = |iris_center_px − image_center_px|`.
- `depth_mm = IRIS_MM · sqrt(f_px² + r²) / iris_px`. The `sqrt` term is the off-axis correction.
- Smoothing: exponential, `d_s = 0.9·d_s + 0.1·d_new`, per eye.

**Published accuracy** [S: Google Research blog, 2020]:
- Mean relative error **4.3%** (SD 2.4%) against the iPhone 11 depth sensor, with more than 200 participants.
- With eyeglasses: 4.8% (SD 3.1%).
- The documentation summarises this as "< 10% error".
- These figures assume a **known focal length**.

**Getting the focal length on the web.** `MediaStreamTrack.getSettings()` exposes resolution but no intrinsics, and there is no EXIF data for a live stream. Options, best first:

1. **Per-user calibration with the blind spot** [D, recommended]:
   - During the blind-spot run, keep the front camera on and record the median `iris_px` (both eyes, frontal pose) at the same moment. Call it `I0`.
   - Store the product `K = D_bs · I0 / sqrt(1 + (r/f)²)`, where `r/f` is about 0 for a centred face. This is in mm·px.
   - Afterwards: `D = K / iris_px`.
   - **This cancels the user's true iris size entirely**, because `K` absorbs both `f_px` and the user's iris size. The error reduces to the blind-spot error (about 5–7%) plus landmark noise.
   - `K` is only valid for that camera and that stream resolution. Store `{deviceId, width, height}` and rescale if the resolution changes: `K` scales with image width.
2. **Device focal length** [D]:
   - From calibration, `f_px = D_bs · I0 / 11.71`.
   - `f_px` is a device and camera property, so aggregate it anonymously per device model and resolution, using the median over users. Later users can then get distance without a blind-spot run, with an error of about 3.6% SD from iris variability.
3. **Last-resort prior** [U]: typical smartphone front cameras have a horizontal field of view of about 60–80°, so `f_px ≈ (W/2)/tan(HFOV/2)`. The error is ±15% or more. Use it only for coarse guidance, never for test scoring.
4. **Fusing estimates** [D]: when both a blind-spot value and a model-level `f_px` exist, combine them by inverse-variance weighting, using 7% for the blind-spot SD and 4% for the model-level SD.

**Practical rules** [D]:
- Request the front camera at 640×480 or 1280×720 with `facingMode:'user'`, and keep that resolution fixed during tests.
- Accept frames only if head yaw is under 20° and pitch under 20° (from the facial transformation matrix), and both irises are detected.
- Use the mean of the two eyes' depths.
- The camera sits off to the side of the stimulus. Viewing distance to a stimulus `Δ` mm from the camera in the screen plane is `d = sqrt(D_cam² + Δ²)`. `Δ` is known from the screen geometry, the camera position at the top bezel, and the calibration.
- During acuity and contrast trials:
  - Keep d within ±10% of the target. Blank the stimulus and show "move closer" or "move farther" when outside the tolerance.
  - Record the mean d per trial and use it in scoring. Size is recomputed per trial, so small drifts are corrected exactly.

### 2.3 (c) Typical viewing distances (defaults and priors)

| Source | Device/task | Distance |
|---|---|---|
| Bababekova, Rosenfield, Hue & Huang 2011, *Optom Vis Sci* 88:795–797 [S] | Smartphone, text message | mean **36.2 cm** (range 17.5–58.0) |
| same | Smartphone, web page | mean **32.2 cm** (range 19–60) |
| Naipal et al. 2025, *Ophthalmic Physiol Opt*, doi:10.1111/opo.13410 [S] | Smartphone, text / web (n = 160) | 37.13 ± 8.82 cm / 36.11 ± 7.98 cm. Presbyopes: median 41 / 40 cm. Non-presbyopes: 34 / 34 cm. |
| Boccardo, Gurioli & Grasso 2023, *PLoS ONE* 18:e0282947 [S] | Smartphone | Non-presbyopes hold phones closer than presbyopes; presbyopes use larger characters |
| Tablets (> 8.5″) [U; the only figure found is from patent literature, 39.7 ± 6 cm] | Tablet | about 35–45 cm; **measure, don't assume** |
| Traditional hard-copy near-work convention | Print | 40 cm |

**Defaults** [D]: phone 35 cm, tablet 40 cm. Always replace the default with the measured value.

**Citations (§2)**
- Li et al. 2020 (above).
- jsPsych virtual-chinrest source.
- Google Research blog: "MediaPipe Iris: Real-time Iris Tracking & Depth Estimation" (Aug 2020).
- google-ai-edge/mediapipe `docs/solutions/iris.md` and `mediapipe/graphs/iris_tracking/calculators/iris_to_depth_calculator.cc`.
- Ablavatski A et al. Real-time pupil tracking from monocular video for digital puppetry. arXiv:2006.11341.
- Rüfer F, Schröder A, Erb C. White-to-white corneal diameter: normal values in healthy humans obtained with the Orbscan II topography system. *Cornea* 2005;24:259–261.
- Bababekova et al. 2011. Naipal et al. 2025. Boccardo et al. 2023.

---

## 3. Visual acuity self-test on a phone

### 3.1 Definitions and conversions (exact)

**Core definitions** [V: arithmetic from definitions]:
- `MAR` (arcmin) = the angular stroke width = the gap of the optotype.
- `logMAR = log10(MAR)`.
- Standard optotypes are 5 × MAR high, so logMAR 0 means a 5′ optotype with a 1′ stroke.

**Physical letter height** for a logMAR value `L` at distance `d` (mm):
```
h_mm = 2 · d · tan( (5 · 10^L arcmin) / 2 ),  where 1 arcmin = π/10800 rad
stroke_mm = h_mm / 5
```
For example, at 40 cm: logMAR 0 → 0.582 mm; 0.3 → 1.161 mm; 0.5 → 1.840 mm; 1.0 → 5.818 mm. At 30 cm: logMAR 0 → 0.436 mm.

**Conversions:**
- Decimal acuity `V = 10^(−L)`.
- Snellen metric `6/x` with `x = 6 · 10^L`.
- Snellen imperial `20/x` with `x = 20 · 10^L`.
- M-units: `M = (d in m) · 10^L`. 1 M means the letter or x-height subtends 5′ at 1 m, i.e. 1.4544 mm.
- ETDRS letter score ≈ `85 − 50·L` [U: standard ETDRS convention].
- ETDRS letter-by-letter scoring: each letter is worth **0.02 logMAR** (5 letters per 0.1 line) [U: standard].
  `VA = logMAR(largest line attempted) + 0.1 − 0.02 × (letters read correctly from that line down)`.

| logMAR | decimal | 6/x | 20/x | ETDRS letters |
|---|---|---|---|---|
| −0.3 | 2.00 | 6/3 | 20/10 | 100 |
| −0.2 | 1.58 | 6/3.8 | 20/12.5 | 95 |
| −0.1 | 1.26 | 6/4.8 | 20/16 | 90 |
| 0.0 | 1.00 | 6/6 | 20/20 | 85 |
| 0.1 | 0.79 | 6/7.5 | 20/25 | 80 |
| 0.2 | 0.63 | 6/9.5 | 20/32 | 75 |
| 0.3 | 0.50 | 6/12 | 20/40 | 70 |
| 0.4 | 0.40 | 6/15 | 20/50 | 65 |
| 0.5 | 0.32 | 6/19 | 20/63 | 60 |
| 0.6 | 0.25 | 6/24 | 20/80 | 55 |
| 0.7 | 0.20 | 6/30 | 20/100 | 50 |
| 0.8 | 0.16 | 6/38 | 20/125 | 45 |
| 0.9 | 0.13 | 6/48 | 20/160 | 40 |
| 1.0 | 0.10 | 6/60 | 20/200 | 35 |
| 1.3 | 0.05 | 6/120 | 20/400 | 20 |

Display Snellen values using the conventional rounded chart denominators shown above; for example the exact 20/12.6 is shown as 20/12.5.

### 3.2 Optotype choice: Tumbling E vs Landolt C, 4AFC vs 8AFC

**ISO 8596:2017** [S]:
- The Landolt ring is the reference optotype. Outer diameter 5′, ring width 1′, gap 1′.
- It specifies **8 gap orientations** at 45° steps.
- It is intended for certification and licensing, not as a clinical-measurement standard.

**Agreement with letter charts** [S]: Treacy et al. 2015 (*Ophthalmology* 122:1062), 112 patients:
- Tumbling E vs ETDRS letters: the difference was not significant.
- Landolt C gave about **0.10 logMAR worse** acuity than ETDRS (P < 0.0001).
- In children, Tumbling E also gave better scores than Landolt C (+0.09 vs +0.14 logMAR) [S: Sci Rep 2021;11:18313].

**Guessing rates:** 4AFC (Tumbling E, or Landolt C with 4 gaps) is **25%**. 8AFC (Landolt C) is **12.5%**. A lower guessing rate gives more information per trial.

**Recommendation** [D]: **Tumbling E, 4AFC**, answered by swipe with 4 on-screen arrow buttons as a fallback.
- It needs no letter knowledge, which matters for Hebrew/English neutrality.
- It is the same optotype family as Peek Acuity, the most-validated smartphone test.
- It agrees with ETDRS on average.
- Four swipe directions are robust on touch screens; eight diagonal swipes are error-prone.
- Compensate for the higher guessing rate with more trials (§3.4).
- Option for later: Landolt C 8AFC (FrACT-style) behind a feature flag.

### 3.3 Crowding

- Crowding is strongest when flankers abut or sit 1 stroke-width away. Crowding extent is more consistent across tests when expressed in stroke-widths [S: Vision Res 2016, adults with paediatric optotypes]. A plain box surround crowds less than similar flankers [S].
- Isolated single optotypes overestimate acuity relative to charts, especially in amblyopia.
- Peek Acuity shows a single E inside a square to simulate crowding [S].

**Recommendation** [D]: present the E with **4 surround bars**:
- Thickness 1 stroke; length 5 strokes (the letter height).
- Edge-to-edge gap to the letter **2.5 strokes (0.5 letter width)**.
- Black, same contrast as the letter.

This gives chart-like crowding, and reading, the target use-case, is itself a crowded task. Keep it fixed across versions so longitudinal data stay comparable.

### 3.4 Adaptive procedure (recommended): Bayesian (QUEST-type) on logMAR

**Why Bayesian:**
- Staircases waste trials and have no principled end point.
- ETDRS line scoring needs 5 letters per line with an examiner.
- Bayesian placement at the posterior mean is the most efficient single-threshold method (Watson & Pelli 1983; King-Smith et al. 1994 showed the posterior **mean** beats the mode) [S].
- FrACT uses Bayesian "Best PEST" [S]. Its test–retest 95% limits of agreement are **±0.46 logMAR at 6 trials, ±0.17 at 18 trials and ±0.12 at 48 trials**, with 8AFC and 26 participants (Bach 2024, *Graefes Arch*) [S].
- The Stanford Acuity Test (Piech et al., AAAI 2020) reports a 74% error reduction against chart testing and up to 67% against FrACT using a Bayesian model with a fitted "visual response function" [S].

**Psychometric model** [D; slope from Carkeet et al. 2001, who report a probit SD of about 0.07 logMAR when well corrected and up to 0.12 with defocus [S]]:
```
ψ(L; T) = γ + (1 − γ − λ) · (1 − exp(−10^(β·(L − T))))
  L = presented logMAR (bigger letter = larger L = easier)
  T = threshold logMAR (the estimate); ψ(T) = γ + (1−γ−λ)(1−e^-1) ≈ 72% correct for γ = 0.25, λ = 0.03
  γ = 0.25 (4AFC), λ = 0.03 (lapse), β = 6.0 (in log10 units; the Gumbel spread 0.557/β ≈ 0.093 logMAR matches 0.07–0.12)
```

**Algorithm** [D]:
- Grid: `T ∈ [−0.60, +1.60]` in 0.01 steps.
- Prior: normal, mean 0.2, SD 0.6. Use an age-adjusted mean if known: 0.0 under 50, 0.2 at 50 and over.
- **Trial 1 and 2** (familiarisation): present at posterior mean + 0.3.
- **Trials 3…N:** present at the posterior mean, clipped to [−0.5, 1.5] and to the renderable minimum (§1.3).
  - If `L > 1.3` would be needed (letter height 11.6 mm at 40 cm), bring the device closer or report "worse than 1.3 at this distance" and route to the low-vision flow.
- **Catch trials:** 2 trials at posterior mean + 0.5, inserted at trial 9 and trial 17. They are included in the likelihood.
- **Update:** multiply the posterior by ψ (correct) or 1 − ψ (incorrect).
- **Stopping rule:**
  - 24 trials (4AFC), not counting catch trials.
  - Optional early stop at ≥ 18 trials if the posterior SD is ≤ 0.035.
  - Hard cap 30 trials.
  - Expected duration ≈ 26 trials × 2–3 s ≈ **55–75 s per eye**, which meets the 90 s target.
- **Final value:** posterior mean `T̂`, rounded to 0.02 logMAR (letter equivalents), plus the posterior SD and a 95% credible interval. Store `d` (the mean of per-trial distances), the eye, the correction worn, and the device.

**Our Monte-Carlo check of this design** [D: simulation, ideal observer with λ = 0.03, true slope β 4.6–8, 800 simulated test–retest pairs each]:

| Design | Test–retest 95% limits of agreement (± logMAR) | Bias |
|---|---|---|
| 4AFC, 18 trials | 0.12–0.17 | ≤ 0.01 |
| **4AFC, 24 trials** | **0.09–0.14** | ≤ 0.01 |
| 4AFC, 30 trials | 0.07–0.11 | ≤ 0.01 |
| 8AFC, 18 trials | 0.09–0.14 | ≤ 0.01 |

- The simulated 8AFC/18-trial value (±0.10–0.14) is below FrACT's empirical ±0.17. Real observers add about 0.05–0.1 of state variability, so **expect ±0.15–0.20 logMAR in the field for 4AFC/24 trials**.
- Lapses matter a lot. With a true lapse rate of 8% the simulated limits of agreement grew to ±0.20 (bias +0.02). At 15% they grew to ±0.38 (bias +0.08). Hence the reliability checks below.

**Fallback mode** (chart-like, for clinicians or demos) [U/D]:
- 5 optotypes per level, 0.1 logMAR steps, starting at 0.7.
- Stop when 3 or more of 5 are wrong. The chance of passing a level by pure guessing (≥ 3/5) in 4AFC is 10.4%.
- Score letter-by-letter at 0.02 logMAR per optotype.

**What validated smartphone tests do:**
- **Peek Acuity** (Bastawrous et al. 2015, *JAMA Ophthalmol* 133:930–937; 300 adults aged 55 and over in Kenya) [S]:
  - Single Tumbling E with an examiner swiping the response, using a proprietary staircase.
  - Mean difference from ETDRS **0.07 logMAR** (95% CI 0.05–0.09).
  - Test–retest 95% CI **±0.033 logMAR**. This is unusually small; it comes from an examiner-administered test.
- **Vision at Home** (Han et al. 2019, *TVST*) [S]: test–retest 95% limits of agreement −0.289 to +0.258 (distance) and −0.235 to +0.199 (near).
- **K-VA** (2023, *Ophthalmol Ther*) [S]: at 1 m vs ETDRS at 4 m, −0.006 (95% limits of agreement −0.129 to +0.117). At 40 cm vs near ETDRS, −0.007 (−0.105 to +0.090).
- **Systematic reviews:**
  - Thirunavukarasu et al. 2023 (*PLoS ONE* 18:e0281847) [S]: self-administered remote tests are often less accurate than clinical testing, and reporting is poor.
  - A home-VA review [S]: PC-based home tests showed a bias of about 1 letter; phone apps and websites about 6 letters.
  - Suo et al. 2022 (*JMIR mHealth* 10:e26275) is the meta-analysis of apps.

### 3.5 Detecting unreliable results (flag, then offer one repeat)

These rules are [D].
1. Both catch trials missed, or 3 or more misses among catch plus familiarisation trials → **unreliable** (inattention, wrong eye covered, or a misunderstood task).
2. Posterior SD above 0.08 at the end → unreliable.
3. Median response time under 300 ms, or 5 or more identical responses in a row → possible random tapping. Show a warning.
4. More than 20% of trials blanked for distance out of tolerance, or yaw over 20° → unreliable.
5. Squint detection: MediaPipe blendshape `eyeSquintLeft/Right` above 0.5 on more than 30% of trials. Squinting narrows the aperture and inflates acuity. Show a warning.
6. Occlusion check: ask "Is your other eye fully covered with your palm, not pressing on the eye?" Optionally, if both irises are visible to the camera during a monocular test, warn.
7. Across sessions: a change of 0.2 logMAR or more is flagged as a *possible* change only if it is confirmed by an immediate retest, because test–retest variability is ±0.15–0.20.

### 3.6 Monocular testing and occlusion instructions

**Procedure** [D, standard clinical practice]:
- Test the right eye first, then the left, then optionally both eyes together (binocular, used for personalisation).
- Instruction:
  > "Cover your LEFT eye with the palm of your left hand. Keep both eyes open behind your hand and don't press on the eye. Don't peek through your fingers. Don't squint."
- Covering is preferred over closing the eye, because closing one eye tends to narrow the other. Allow the user to rest between eyes.

### 3.7 Near testing (about 40 cm) and what the test measures

- The phone test measures **acuity at the tested distance with the tested correction**. At 35–40 cm this is **near/intermediate** acuity. It includes presbyopia effects: a 55-year-old without readers may score 0.3–0.5 at 40 cm with healthy eyes.
- For **screen personalisation** this is exactly the relevant quantity. For **distance acuity** it is not. Do not label a 40 cm result as "distance acuity".
- Near visual impairment by WHO/ICD-11 definition is presenting near acuity worse than **N6 or M0.8 at 40 cm** [S]. M0.8 at 0.4 m is logMAR log10(0.8/0.4) = **0.30**.
- **Optional intermediate or distance-like test** [D]: tablet at 1.0 m with responses on a paired phone. K-VA shows that 1 m testing agrees with 4 m ETDRS within ±0.12. Presbyopes need their intermediate or distance correction for this test.

### 3.8 Expected test–retest variability (to show engineers and users)

- **Self-test, 4AFC/24 trials:** expect about ±0.15–0.20 logMAR (95% limits of agreement), i.e. about 1.5–2 lines.
- Therefore:
  - Never present differences under 0.2 logMAR as real changes.
  - Internally, store logMAR to 0.02. **Manager decision (2026-09-28):** the default UI shows **no clinical notation** (no Snellen, decimal, logMAR or dioptres). Present results as the 0–100 "screen detail" score and the recommended text size instead (see IMPLEMENTATION SPEC SUMMARY, item 60).

**Citations (§3)**
- ISO 8596:2017.
- Treacy MP et al. *Ophthalmology* 2015;122:1062–1063.e1.
- Bach M. *Graefes Arch Clin Exp Ophthalmol* 2024. doi:10.1007/s00417-024-06638-z
- Watson AB, Pelli DG. QUEST. *Percept Psychophys* 1983;33:113–120.
- King-Smith PE et al. *Vision Res* 1994;34:885–912.
- Carkeet A, Lee L, Kerr JR, Keung MM. *Optom Vis Sci* 2001;78:113–121. Carkeet A. *Optom Vis Sci* 2001;78:529–538.
- Piech C et al. The Stanford Acuity Test. AAAI 2020;34:471–479 (arXiv:1906.01811).
- Bastawrous A et al. *JAMA Ophthalmol* 2015;133:930–937. doi:10.1001/jamaophthalmol.2015.1468
- Han X et al. *TVST* 2019 (Vision at Home).
- Thirunavukarasu AJ et al. *PLoS ONE* 2023;18:e0281847.
- Suo L et al. *JMIR mHealth uHealth* 2022;10:e26275.
- WHO ICD-11 vision impairment categories.

---
## 4. Reading and text-size recommendation

### 4.1 Evidence

**Acuity reserve and contrast reserve** (Whittaker & Lovie-Kitchin 1993, *Optom Vis Sci* 70:54–65) [S].
Four factors drive reading rate: acuity reserve, contrast reserve, field of view and central scotoma.
- **Acuity reserve** is the ratio of print size to acuity threshold. It maps to reading level as follows:
  - Spot reading (~40 wpm): **1.3:1** (0.1 log unit)
  - Fluent reading (~100 wpm): **2:1** (0.3 log unit)
  - Maximum speed: **≥ 3:1** (0.5 log unit)
  - Clinical practice usually uses 2:1; some practitioners use 3:1 for sustained reading. A 2:1 reserve is adequate for about 75% of low-vision readers.
- **Contrast reserve** is the ratio of print contrast to threshold contrast:
  - **10:1** for low-normal speed (174 wpm)
  - **4:1** for 88 wpm
  - **3:1** for spot reading (44 wpm)

**MNREAD** (Legge, Mansfield et al.) [S]
- Chart design: 19 sentences, each 60 characters on 3 lines, Times Roman, in 0.1 log-unit print-size steps.
- Outputs:
  - Reading acuity (RA): the smallest print read.
  - Critical print size (CPS): the smallest print that still supports maximum reading speed.
  - Maximum reading speed (MRS).
- CPS by NLME curve fitting is defined at **80% of MRS** (Cheung, Kallie, Legge & Cheong 2008, *IOVS* 49:828–835).
- Norms (Calabrèse et al. 2016, *IOVS* 57:3836) [S]:
  - CPS 0.08 logMAR from 8 to 23 years, rising to 0.21 at 68 years and 0.34 at 81 years.
  - MRS 200 ± 25 wpm between 16 and 40 years, falling to 175 wpm at 81 years.
  - RA −0.18 logMAR at 16 years, −0.05 at 81 years.
- Courier gives CPS 0.06 logMAR smaller and RA 0.05 logMAR better than Times in normal readers (Mansfield, Legge & Bane 1996) [S].

**Legge & Bigelow 2011** (*J Vis* 11(5):8) [S]
- Consensus CPS for normal readers is **0.2° x-height**, with an individual range of 0.15–0.3°.
- Fluent reading range is **0.2° to 2°** x-height.
- Newspapers and books use x-heights of **0.20–0.28°** (newspapers mean 0.23°, hardback books 0.24°).

*Note the disagreement:* MNREAD-scale CPS values of about 0.08–0.2 logMAR correspond to x-heights of about 6–8 arcmin (0.10–0.13°). Legge & Bigelow's consensus is about 12′. The two are summarising different test conditions (font, presentation mode). **Recommendation [D]:** use the Legge & Bigelow 0.2° as the *floor for body text*. Use the individual acuity or CPS rule for everything above that floor.

**Validation of the floor against system defaults** [V: arithmetic]:
- On an iPhone, iOS default Body is 17 pt = 17 px_css × 0.1657 mm = 2.82 mm em. SF x-height ratio 0.508 gives a 1.43 mm x-height.
- That subtends **0.273° at 30 cm, 0.234° at 35 cm and 0.205° at 40 cm**, i.e. almost exactly newspaper print.
- So Apple's default already sits at the ecological print size. **Never recommend below the platform default.**

### 4.2 Print-size units and font metrics

**Units**
- **M-units** measure the x-height of lower-case text. 1 M = 1.4544 mm, which subtends 5′ at 1 m. Print size in logMAR at distance d (m) = `log10(M / d)`.
- **N-points** give the typographic body size of Times Roman. N8 ≈ 1 M [U].
- **CSS `font-size`** sets the em box. It is *not* the letter height. Always convert through the x-height ratio.

**x-height / em ratios** (from font OS/2 metrics) [V: `@capsizecss/metrics` 4.3.0]:

| Font | unitsPerEm | xHeight | **x/em** | capHeight/em |
|---|---|---|---|---|
| SF Pro (`-apple-system`, `.SFNS-Regular`) | 2048 | 1040 | **0.508** | 0.705 |
| Roboto | 2048 | 1082 | **0.528** | 0.711 |
| Arial | 2048 | 1062 | **0.519** | 0.716 |
| Helvetica | 2048 | 1071 | **0.523** | 0.717 |
| Segoe UI | 2048 | 1024 | **0.500** | 0.700 |
| Noto Sans (Latin) | 1000 | 536 | **0.536** | 0.714 |

**Hebrew.** Hebrew has no upper/lower case and no x-height. Most letters share one body height. The exceptions are:
- ascender: ל
- descenders: ק ך ן ף ץ
- short letters: י and the upper part of ו/ז

I measured the glyph bounding boxes with fontTools on the Google Fonts TTFs [V: measured, variable fonts at the default instance]:

| Font | Hebrew body height / em (median of א ב ג ד ה ו ח ט כ מ ס ע פ צ ר ש ת ם) | Latin x/em (glyph "x") | ל top / em |
|---|---|---|---|
| **Noto Sans Hebrew** (Android system Hebrew) | **0.584** | 0.528 | 0.760 |
| Heebo | 0.575 | 0.528 | 0.750 |
| Rubik | 0.571 | 0.520 | 0.710 |
| Assistant | 0.545 | 0.478 | 0.717 |

In the same font, Hebrew body height is about **1.08–1.14×** the Latin x-height.

**Hebrew sizing rule [D]:**
- Treat the Hebrew body height as the x-height equivalent in every formula below.
- iOS renders Hebrew with Apple's system Hebrew face, whose metrics I could not access. **Measure the real ratio at runtime:**
  ```
  ctx.font = `100px ${fontStack}`
  hebRatio = ctx.measureText('ה').actualBoundingBoxAscent / 100
  latinRatio = ctx.measureText('x').actualBoundingBoxAscent / 100
  ```
  Fall back to 0.58 (Hebrew) and 0.52 (Latin) if measurement fails.
- Many Hebrew pairs are distinguished only by small features (ב/כ, ד/ר, ה/ח/ת, ו/ז/ן, ס/ם). Add a **+0.05 log-unit (×1.12) safety margin** for Hebrew body text [D, until a Hebrew reading test validates otherwise].
- Mixed Hebrew/English UI: compute the size for Hebrew and let Latin follow the same `font-size`.

### 4.3 Formula: from logMAR threshold and distance to a CSS px font size

```
Inputs:  L    = acuity threshold (logMAR) measured at distance d_test with the correction used for the phone
              (use binocular, or the better eye if binocular was not measured)
         d    = habitual viewing distance (mm), measured by camera (default 350 phone / 400 tablet)
         R    = acuity reserve: 2.0 (fluent; default) or 3.0 (max speed / long reading preference)
         xr   = x-height ratio of the UI font (runtime-measured; Hebrew body ratio for Hebrew)
         mmPerCss from calibration (§1)

1) Required x-height angle (arcmin):   θx = 5 · 10^L · R          (x-height treated as the "letter height" per the MNREAD convention)
2) Apply floor:                         θx = max(θx, 12′)          (0.2°, Legge & Bigelow)
   Hebrew margin:                       θx = θx · 1.12 (Hebrew UI only)
3) If a reading test gave CPS (logMAR at d_read): θx_cps = 5 · 10^(CPS + 0.1) ; θx = max(θx_floor, θx_cps)
   (the CPS-based value replaces step 1 when the reading test is reliable; +0.1 log = margin above CPS [D])
4) Physical x-height:                   x_mm = 2 · d · tan(θx/2)
5) CSS font-size:                       fs_px = x_mm / xr / mmPerCss
6) Never go below the platform default body (iOS 17 pt ≈ 17 px_css; Android 16 sp body ≈ 16 px_css) unless the user asks.
```

Step 1 assumes the angular threshold stays the same at the new distance. That holds only while `d` is inside the user's focus range (§9). If `d ≠ d_test`, re-test at `d`, or keep `d` within ±15% of `d_test` [D].

**Worked examples** (iPhone 15, 0.1657 mm/px_css, SF xr = 0.508, d = 350 mm, R = 2):

| L | θx | x-height | font-size | Nearest iOS Body step |
|---|---|---|---|---|
| 0.0 | 10′ → floored to 12′ | 1.22 mm | 14.5 px | keep default 17 (Large) |
| 0.3 | 20′ | 2.03 mm | **24.1 px** | AX1 = 28 |
| 0.5 | 31.6′ | 3.22 mm | **38.2 px** | AX3 = 40 |
| 0.7 | 50.1′ | 5.10 mm | **60.6 px** | exceeds AX5 = 53 → also recommend Zoom or Magnifier |
| 0.5, R = 3 | 47.4′ | 4.83 mm | 57.4 px | > AX5 |

Same L = 0.5 on a Pixel 8 with Roboto (0.1558 mm/px, xr 0.528): 3.22 mm → 6.10 mm em → **39.1 px ≈ 39 dp**. That needs about 2.4× the 16 sp body, which is beyond the 2.0 maximum. Recommend font scale 2.0, plus "Display size" Largest, plus magnification.

### 4.4 In-app reading test (MNREAD-like), recommended as a second-stage test

**Design [D, modelled on MNREAD]**
- Sentence sets in Hebrew and English. Each sentence is a single 3-line block of about 60 characters, of equal difficulty. **Hebrew sentences need linguistic validation**; there is no validated Hebrew MNREAD to copy.
- Print sizes from large to small in **0.1 log steps**, rendered with the product's UI font at the measured distance.
- The user reads aloud or silently and taps "done". The app records the time.
- Error scoring without an examiner:
  - Either a 2-choice comprehension check after each sentence,
  - Or a sentence-verification (true/false) variant.
  - Mark a sentence as failed if the check is wrong.
- **Stop** when a sentence takes more than 20 s or is failed at 2 consecutive sizes.

**Scoring**
- Reading speed (wpm) = `60 × words / time_s` [U: MNREAD standard counts 10 standard-length words per sentence].
- Fit `RS(p) = MRS · (1 − exp(−(p − p0)/τ))` for print sizes `p > p0` (logMAR) by least squares.
- **CPS = p0 + τ·ln(5)**, the size where RS = 0.8·MRS, matching the Cheung et al. 80% criterion.
- If the fit fails (fewer than 4 sizes), use CPS = the smallest size whose speed is ≥ 80% of the mean of the 3 fastest sizes.

**Polarity A/B:** run 3 sizes near CPS in both positive polarity (dark on light) and negative polarity (light on dark). Choose the polarity with the higher speed only if it is faster by more than 15% [D]. See §5.5.

**Citations (§4)**
- Whittaker SG, Lovie-Kitchin J. Visual requirements for reading. *Optom Vis Sci* 1993;70:54–65.
- Cheong AMY, Lovie-Kitchin JE, Bowers AR. Determining magnification for reading with low vision. *Clin Exp Optom* 2002;85:229–237.
- Legge GE, Bigelow CA. Does print size matter for reading? A review of findings from vision science and typography. *J Vis* 2011;11(5):8.
- Cheung SH, Kallie CS, Legge GE, Cheong AMY. Nonlinear mixed-effects modeling of MNREAD data. *IOVS* 2008;49:828–835.
- Calabrèse A et al. Baseline MNREAD measures for normally sighted subjects from childhood to old age. *IOVS* 2016;57:3836–3843.
- Mansfield JS, Legge GE, Bane MC. Psychophysics of reading XV: font effects in normal and low vision. *IOVS* 1996;37:1492–1501.
- Apple HIG Typography (JSON at developer.apple.com, change log to 16 Dec 2025).
- `@capsizecss/metrics` 4.3.0.
- Google Fonts TTFs: Noto Sans Hebrew, Heebo, Rubik, Assistant.

---

## 5. Contrast sensitivity on a screen

### 5.1 Principles (Pelli–Robson)

**Chart design** [S, plus U where marked]:
- The Pelli–Robson chart has **16 letter triplets**. Contrast falls by **0.15 log units** (a factor of √2) per triplet, from log CS 0.00 to 2.25.
- Letters are large, about 2.8–3° at the 1 m test distance, so the test targets the peak of the contrast sensitivity function rather than acuity.

**Scoring**:
- Original rule: threshold is the last triplet with **≥ 2 of 3 letters correct**.
- **Letter-by-letter scoring** (Elliott, Bullimore & Bailey 1991) gives each letter 0.05 log units, which improves reliability. Equivalent formula: `logCS = 0.05 × (letters correct) − 0.15` [U, derived from the chart layout].

**Interpretation used clinically** [S: clinical summaries]:

| log CS | Meaning |
|---|---|
| 2.0 | normal |
| < 1.5 | moderate loss |
| < 1.0 | disability |

**Age norms** (Mäntyjärvi & Laitinen 2001, *J Cataract Refract Surg* 27:261–266; n = 87, ages 6–75) [S]:
- Monocular means range from **1.84** (20–39 years) down to **1.68** (60+ years).
- Binocular means range from 1.73 to 1.99.

**Digital tests read higher than the printed chart.** Kollbaum et al. 2014 (*Optom Vis Sci* 91:291–296) used an iPad test with 2 letters per page, 0.1 log steps and contrast from 80% down to 0.5% [S]:

| Group | iPad | FrACT | Pelli–Robson |
|---|---|---|---|
| Normal vision | 1.98 ± 0.11 | 1.96 ± 0.06 | 1.65 ± 0.04 |
| Low vision | 1.45 ± 0.40 | 1.54 ± 0.37 | 1.30 ± 0.30 |

- Agreement: iPad vs FrACT 95% limits of agreement ±0.24.
- Repeatability (95% limits of agreement): iPad ±0.19, Pelli–Robson ±0.19, FrACT ±0.15.

**Smartphone test.** Peek Contrast Sensitivity (Habtamu et al. 2019, *TVST* 8(5):13), a Tumbling-E smartphone test, compared with a Tumbling-E Pelli–Robson chart [S]:

| Test | Test–retest r | Test–retest 95% limits of agreement |
|---|---|---|
| PeekCS | 0.93 | −0.31 to +0.29 |
| Tumbling-E Pelli–Robson | 0.96 | −0.20 to +0.21 |

### 5.2 Recommended phone test [D]

**Stimulus**
- Tumbling E, 4AFC, with the same swipe UI as acuity.
- Letter height **2.8°** at the measured distance (1.47 cm at 30 cm, 1.96 cm at 40 cm).
- Dark letter on a white background at maximum display white.
- Weber contrast `C = (Lbg − Lletter)/Lbg` in **linear light**. `logCS = −log10(C)`.

**Procedure: Bayesian (QUEST)** on `x = log10(C)`:
- Grid from −2.5 to 0.0 in 0.01 steps.
- `ψ(x) = γ + (1−γ−λ)·(1 − exp(−10^(β·(x − T))))`, with γ = 0.25, λ = 0.03 and **β = 3.5** (Watson & Pelli's contrast slope, in log10 units).
- Prior: mean log C = −1.7, SD 0.5.
- Familiarisation trials at C = 50% and 25%.
- **24 trials**, placing each at the posterior mean.
- Result: `logCS = −T̂`. Report to 0.05.
- Duration is about 60 s per eye.

**Alternative clinical-style mode**: triplets at 0.15-log steps with ≥ 2/3 correct.
- With 4AFC, the chance of passing a triplet by guessing is **15.6%** (3·0.25²·0.75 + 0.25³).
- With 8AFC Landolt C it is 4.3%.
- So if triplets are used, require 3/3, or use Landolt C.

**Reliability rules** are the same as §3.5. Add one: a miss on a catch trial at C = 50% counts as a lapse.

### 5.3 Screen gamma and luminance caveats (must implement)

**8-bit quantisation.** One code step below white (254 on 255) is already Weber C = 0.89%, i.e. logCS **2.05**. Steps 253, 252 and 250 give logCS 1.75, 1.58 and 1.36 [V: arithmetic with the sRGB EOTF]. Plain gray levels therefore cannot test normal thresholds, which are around 1.8–2.0.
**Use "bit-stealing"**: change R, G and B unequally so the luminance falls between gray steps. Luminance weights (Rec. 709 / sRGB) are Y = 0.2126 R + 0.7152 G + 0.0722 B.
- Near white, a 1-step change in B alone gives ΔY = 0.064%, i.e. logCS 3.19.
- R alone gives 0.189% (2.72). G alone gives 0.636% (2.20).
- Combinations give about 20 sub-steps between gray levels, with invisible chroma error on large letters.
- An alternative is 2×2 ordered spatial dithering between adjacent gray levels. It is fine for 2.8° letters on phones above 300 ppi.

**Gamma and transfer function.** Assume the sRGB transfer function (§7.1). Safari and Chrome colour-manage canvas as sRGB by default. Display P3 panels use the same transfer curve, so neutral contrasts are preserved. Individual panels deviate. Without a photometer the result is *screen-referred*, with an estimated additional uncertainty of about ±0.1 log [D]. Record the device model and brightness setting, and compare longitudinal results only on the same device.

**Brightness and ambient light**
- Require high brightness and no eye-comfort filters (§0.3).
- On OLED at low brightness, PWM dimming and near-black nonlinearity get worse. We therefore use a near-white background and never a dark one.
- Anti-aliased letter edges are blended in gamma space, not linear space. For letters this large the effect is negligible. Still, draw contrast letters with integer-snapped geometry because size is not critical here.

### 5.4 Normal ranges and flags (on our digital scale)

- Provisional lower limits of normal: **1.65 for ages < 60 and 1.50 for ages ≥ 60** [D, anchored to Mäntyjärvi and to the Pelli–Robson categories].
- Because digital adaptive tests read about 0.1–0.3 higher than the printed Pelli–Robson chart (Kollbaum 2014), **re-derive these cut-offs from our own pilot normative data** (≥ 100 normal eyes per age band) before launch.
- **Change criterion**: a drop of ≥ 0.3 log units, confirmed on retest, is a real change. This exceeds the ±0.2–0.3 test–retest limits of agreement.

### 5.5 How contrast results should change the UI [D]

**Rationale.** Whittaker & Lovie-Kitchin's 10:1 contrast reserve is defined relative to the contrast threshold *at the print size used*. Our measured logCS is the best case, for large letters. For small text the threshold is higher, so apply extra margin.

| Measured logCS (large letters) | Text contrast target (WCAG ratio) | Font weight | Size adjustment | Other |
|---|---|---|---|---|
| ≥ 1.65 | ≥ 4.5:1 (AA); app default ≥ 7:1 | Regular (400) | none | — |
| 1.35–1.64 | ≥ 7:1 (AAA); no gray-on-gray | Medium/Semibold (500–600) → suggest iOS/Android **Bold Text** | +1 step (×1.12) | Suggest **Increase Contrast** (iOS) / **Color contrast: Medium** (Android) |
| 1.00–1.34 | ≥ 12:1, i.e. near black on white | Bold (700) + system Bold Text | +2 steps (×1.26) | Increase Contrast / High or Outline text; stronger UI borders; enable image enhancement (§10) |
| < 1.00 | 21:1 (pure `#000`/`#fff`) | Bold | +3 steps (×1.41) | As above, plus magnifier guidance; offer the negative-polarity A/B test |

**Polarity**
- Default to **positive polarity**: dark text on light. It gives better acuity and proofreading in both younger and older adults, the benefit is largest for small text, and it goes with smaller pupils (Piepenbrock, Mayr & Buchner 2013, *Ergonomics* 56:1116–1124; 2014, *Hum Factors* 56:942–951) [S].
- Offer **negative polarity** (light text on a dark gray `#121212` background with `#E6E6E6` text, not pure white on pure black) when:
  1. the user reports glare or photophobia, or
  2. the reading A/B test (§4.4) shows it is more than 15% faster.

  Low-vision readers with **cloudy ocular media** (for example cataract) can read faster with reversed polarity (Legge, Rubin, Pelli & Schleske 1985, *Vision Res* 25:253–266; Legge, Rubin & Schleske 1987) [S].

**Citations (§5)**
- Pelli DG, Robson JG, Wilkins AJ. The design of a new letter chart for measuring contrast sensitivity. *Clin Vision Sci* 1988;2:187–199.
- Elliott DB, Bullimore MA, Bailey IL. Improving the reliability of the Pelli-Robson contrast sensitivity test. *Clin Vision Sci* 1991;6:471–475.
- Mäntyjärvi M, Laitinen T. 2001.
- Kollbaum PS et al. 2014.
- Habtamu E et al. 2019.
- Watson & Pelli 1983.
- Pelli DG, Zhang L. Accurate control of contrast on microcomputer displays. *Vision Res* 1991;31:1337–1350 [U].
- Tyler CW. Colour bit-stealing to enhance the luminance resolution of digital displays on a single pixel basis. *Spatial Vision* 1997;10:369–377 [U].
- Piepenbrock et al. 2013, 2014.
- Legge et al. 1985.

---

## 6. Astigmatism screening with a clock dial / fan chart

### 6.1 Procedure (clinical reference)

The clinical clock-dial test works like this [S: StatPearls "Subjective Refraction Technique: Astigmatic Dial"]:
1. The patient is **fogged** with plus lenses so both focal lines lie in front of the retina.
2. The patient reports the **darkest, sharpest** line.
3. **Minus-cylinder axis = (lower clock number of the darkest line) × 30°.** This is the "rule of 30": 360°/12 = 30° per clock hour.
   - Darkest line 12–6 → axis 180°.
   - Darkest line 3–9 → axis 90°.
   - Darkest line 1–7 → axis 30°.
4. Minus cylinder is then added until all lines look equal.

### 6.2 Phone implementation [D]

**Chart**
- Twelve spokes at 15° intervals, labelled with clock positions including half-hours.
- Each spoke has 3 parallel lines. Line width **1.5′** with a gap of 1.5′, at the measured distance.
  - At 35 cm, 1.5′ is 0.153 mm, about 2 device px on 460 ppi phones.
  - Render with the anti-aliasing rules from §1.3.
- Spoke length is 5° of visual angle. Black on white. Monocular.

**Procedure**
- The user looks at the centre and taps the spoke that looks **darkest or sharpest**, or taps "all equal".
- Repeat 3 times, rotating the whole dial by a random offset each time so position bias cannot drive the answer.
- A **consistent** choice means ≥ 2 of 3 answers within ±15°.

**Axis estimate**: `axis = 30° × h_low`, where `h_low` is the lower clock value of the chosen spoke in hours (half-hours allowed, e.g. 1.5 → 45°), and 6 → 180°.

**No fogging is possible on a phone.** Accommodation can move the focal lines, so young or hyperopic users may give inconsistent answers. Test without the user's distance glasses only if the product wants detection; test with habitual correction to check whether that correction is adequate.

### 6.3 Validity

- There is little published validation of self-administered dial tests. Pilot smartphone astigmatism apps exist (for example the Schepens far-point dial approach: *IOVS* 2023 ARVO abstract; *TVST* 2022 [S]).
- Reviews and product literature agree that dial tests can **flag possible astigmatism but cannot measure cylinder power or axis for a prescription** [S].
- Expected sensitivity [U]: dials detect roughly ≥ 0.75–1.00 D of uncorrected cylinder. Lower amounts are often missed.
- Why that threshold [V: arithmetic]: 1 D of meridional defocus with a 4 mm pupil smears one meridian over about 13.75′. That exceeds the 1.5′ line pitch, so the difference is visible. At 0.5 D with a 3 mm pupil the smear is about 5′, and the difference becomes subtle.
- **Product use**: a consistent darkest-line result means "possible astigmatism — an eye exam can confirm and correct it". Never show a cylinder value.

### 6.4 What screen adaptation can and cannot do for astigmatism

**Cannot**
- Correct meridional blur optically (see §11).
- Pre-distort text to cancel the blur on a standard display.

**Can help** [D, from general blur and legibility principles]:
- Larger text, using the acuity rule of §4.
- Heavier weight (≥ 500–600). Blur spreads thin strokes and lowers their contrast.
- Positive polarity, which gives a smaller pupil and therefore less blur (Piepenbrock 2014 pupil-size data).
- Slightly increased letter spacing, +0.02–0.05 em [D], to reduce blur-induced crowding.
- Avoid thin, light, or condensed fonts. Apple HIG also advises avoiding Ultralight, Thin and Light weights [V].

**"Halation" in dark mode** (white text appearing to bloom on black for astigmatic users) is widely asserted in design and grey literature. I found **no peer-reviewed quantification** of it. Do not claim it. Offer dark mode as dark-gray/off-white per §5.5, and let the A/B reading test decide.

---
## 7. Colour vision

### 7.1 sRGB ↔ linear transfer functions (IEC 61966-2-1:1999) [V: libDaltonLens code; U: standard text]

```
decode (0..1 encoded → linear):   c_lin = c / 12.92                      if c <= 0.04045
                                   c_lin = ((c + 0.055) / 1.055) ^ 2.4    otherwise
encode (linear → 0..1 encoded):   c = 12.92 · c_lin                       if c_lin <= 0.0031308
                                   c = 1.055 · c_lin ^ (1/2.4) − 0.055     otherwise
relative luminance (sRGB/Rec.709 primaries, D65):  Y = 0.2126 R + 0.7152 G + 0.0722 B     (R,G,B linear)
linear sRGB → XYZ (D65):  [[0.4124564, 0.3575761, 0.1804375],
                           [0.2126729, 0.7151522, 0.0721750],
                           [0.0193339, 0.1191920, 0.9503041]]
```

**Pipeline for any colour transform** (simulation, daltonisation, colour filters):
1. Decode sRGB to linear.
2. Apply the 3×3 matrix.
3. Clamp to [0, 1].
4. Encode back to sRGB.

In WebGL: upload textures as `SRGB8_ALPHA8`, or decode manually in the shader. Never apply the matrices to encoded values.

### 7.2 What is validated for computerised colour-vision testing

**Cambridge Colour Test (CCT)** (Regan, Reffin & Mollon 1994, *Vision Res* 34:1279–1299) [S]
- Stimulus: a Landolt C made of discs of random size and **random luminance** (luminance noise). The C differs from the background only in chromaticity, so luminance cues cannot be used.
- Chromatic displacement is varied along **protan, deutan and tritan confusion lines** with a staircase. The test runs on a calibrated display with 14-bit luminance control.
- "Trivector" normal limits: **protan ≤ 100, deutan ≤ 100, tritan ≤ 150** (units of 10⁻⁴ u′v′) [S: CCT handbook summary].

**Confusion-line copunctal points** (CIE 1931 xy) [S]:
- Protan (0.747, 0.253)
- Deutan (1.40, −0.40)
- Tritan (0.171, 0.000)

Equivalently, and simpler to implement: a confusion line for a given dichromat is a line along which only the **missing cone's** excitation changes.
- Protan axis = L-cone-isolating direction.
- Deutan axis = M-cone-isolating direction.
- Tritan axis = S-cone-isolating direction.

**Waggoner Computerized Color Vision Test (CCVT / ColorDx)** [S]:
- Desktop: 95% sensitivity, 100% specificity. Protan/deutan classification agreed with anomaloscope 89% of the time.
- On **iPad**: sensitivity and specificity against anomaloscope and Ishihara **97.7% and 98%**, with test–retest agreement AC1 = 0.95.

These results show that commodity tablets **can** screen red–green deficiency. They were obtained on known device models with manufacturer-controlled display settings.

**Pseudo-isochromatic plates** (Ishihara, HRR): their printed inks are designed for illuminant C/D65 and do not reproduce on screens without calibration. Ishihara plates are also copyrighted. **Do not copy the plates.** Use the CCT-style method instead.

### 7.3 Procedure for an uncalibrated phone [D]

**Stimulus**
- A Landolt-C-style ring, 4AFC gap (up/down/left/right), about 5° outer diameter at the measured distance. It is built from about 200–300 non-overlapping discs of random diameter (0.2–0.5°).
- The background is made of the same kind of discs.
- **Luminance noise:** each disc gets a random luminance factor from 6 equally spaced levels spanning ±20% around the mean linear luminance. Target and background discs draw from the *same* distribution.
- **Neutral point:** linear RGB (0.20, 0.20, 0.20), i.e. sRGB ≈ 124. This is a mid gray with gamut headroom in all directions.

**Chromatic displacement.** Convert the neutral point to LMS, then scale **one** cone coordinate:
- `LMS_target = LMS_bg ⊙ (1 + c·e_k)`, with `e_k` = (1,0,0) for protan, (0,1,0) for deutan, (0,0,1) for tritan.
- Convert back to linear RGB and check that it is in gamut.
- Matrices [V: DaltonLens, Smith & Pokorny 1975 cone fundamentals with the sRGB/BT.709 primaries matrix]:
  ```
  LMS_from_linearRGB = [[0.17885956, 0.43997117, 0.03596577],
                        [0.03380394, 0.27515242, 0.03620635],
                        [0.00031087, 0.00191661, 0.01528089]]
  linearRGB_from_LMS = [[ 8.0053286 , -12.8819545 ,  11.68064943],
                        [-0.97821149,   5.26944903, -10.18300433],
                        [-0.04016823,  -0.39885058,  66.48078797]]
  ```
- Apply the luminance-noise factor to the displaced colour, not to the cone contrast.
- Report thresholds both as cone contrast `c` and as Δu′v′ (via the XYZ matrix in §7.1), so they can be compared with CCT norms.
- Near sRGB 128 gray, one 8-bit code step moves u′v′ by about **8–12 × 10⁻⁴** [V: computed]. The CCT normal limits of 100–150 × 10⁻⁴ are therefore only about 10 steps away. Use temporal or spatial dithering to get sub-step resolution.

**Adaptive procedure**
- Three interleaved Bayesian staircases (protan, deutan, tritan), each on log10(c), with 4AFC and γ = 0.25.
- About 16 trials per axis, 48 in total, taking about 2.5 minutes.
- Cap `c` at the in-gamut maximum. Reaching that cap twice counts as "ceiling", consistent with dichromacy.
- Show 1.5 s per stimulus, or until response.
- Test **each eye** (congenital defects are symmetric; acquired ones are often asymmetric) and then both eyes.

**Classification** (thresholds `P`, `D`, `T` expressed in multiples of the normal limit from our own normative data):
- **Normal:** all three ≤ 1.
- **Red–green deficiency:** `max(P, D) > 1` and `T ≤ 1.5`.
  - **Protan** if `P/D ≥ 1.25`.
  - **Deutan** if `D/P ≥ 1.25`.
  - Otherwise "red–green, type uncertain". Protan and deutan thresholds are both raised in most red–green deficient observers. Separation relies on which axis is worse and on the luminance-sensitivity difference; protans see reds as darker.
- **Tritan:** `T > 1.5` and `P, D ≤ 1.5` → tritan-like loss. This is **usually acquired**, so it is a red flag (§13).
- **Generalised loss:** all three > 1.5. Suggests acquired loss, or a test/display problem.
- **Severity estimate** for choosing correction strength: `s = clamp( log(X/1) / log(Xceil/1), 0, 1 )`, where `X` is the worst-axis threshold and `Xceil` the gamut ceiling. `s = 1` means a dichromat-like result.
  - Map `s` to the Machado severity and to the OS colour-filter intensity.
  - The user then fine-tunes by preference. Severity is **not** a diagnosis.
- **Optional protan/deutan tie-breaker:** a flicker-free luminance-matching task between a red (sRGB 255,0,0) and a variable gray. Protans set red much darker, about 0.4–0.5 of the normal match [U]. Add this as a secondary cue.

**Limitations**
- Display primaries vary: sRGB vs Display-P3 panels, and OLED spectral peaks differ.
- Colour filters and night modes are invisible to the web.
- Ambient light chromaticity affects the result.
- Cone fundamentals vary between individuals, including macular pigment.
- This is **screening**, not a diagnosis of anomaloscope-grade type or severity.
- Validate against Ishihara and HRR and, ideally, an anomaloscope before any public claim of accuracy.

### 7.4 CVD simulation matrices (Machado, Oliveira & Fernandes 2009) — EXACT, applied in linear RGB [V]

**Source and cross-check**
- These are the per-severity matrices published on the authors' supplementary page (`inf.ufrgs.br/~oliveira/pubs_files/CVD_Simulation/CVD_Simulation.html`).
- They were transcribed here from two independent libraries that both copied that page: *colorspacious* 1.1.2 (`cvd.py`) and *DaltonLens-Python* 0.1.5 (`simulate.py`). The two agree on all 297 numbers.
- Sanity check: every row sums to 1 ± 0.000001, so white is preserved.

**Usage**
- Model: anomalous trichromacy is modelled as a spectral shift of the affected cone. Severity 1.0 corresponds to a 20 nm shift, which is approximately dichromacy [S].
- Severity s ∈ [0, 1]. For values between the 0.1 steps, interpolate the matrices linearly, as colorspacious does.
- Apply to linear RGB column vectors: `[R′,G′,B′]ᵀ = M · [R,G,B]ᵀ`.

#### Protanomaly (Machado et al. 2009), linear RGB, `rgb_sim = M · rgb`

| severity | row 1 (R′) | row 2 (G′) | row 3 (B′) |
|---|---|---|---|
| 0.0 | [1.000000, 0.000000, -0.000000] | [0.000000, 1.000000, 0.000000] | [-0.000000, -0.000000, 1.000000] |
| 0.1 | [0.856167, 0.182038, -0.038205] | [0.029342, 0.955115, 0.015544] | [-0.002880, -0.001563, 1.004443] |
| 0.2 | [0.734766, 0.334872, -0.069637] | [0.051840, 0.919198, 0.028963] | [-0.004928, -0.004209, 1.009137] |
| 0.3 | [0.630323, 0.465641, -0.095964] | [0.069181, 0.890046, 0.040773] | [-0.006308, -0.007724, 1.014032] |
| 0.4 | [0.539009, 0.579343, -0.118352] | [0.082546, 0.866121, 0.051332] | [-0.007136, -0.011959, 1.019095] |
| 0.5 | [0.458064, 0.679578, -0.137642] | [0.092785, 0.846313, 0.060902] | [-0.007494, -0.016807, 1.024301] |
| 0.6 | [0.385450, 0.769005, -0.154455] | [0.100526, 0.829802, 0.069673] | [-0.007442, -0.022190, 1.029632] |
| 0.7 | [0.319627, 0.849633, -0.169261] | [0.106241, 0.815969, 0.077790] | [-0.007025, -0.028051, 1.035076] |
| 0.8 | [0.259411, 0.923008, -0.182420] | [0.110296, 0.804340, 0.085364] | [-0.006276, -0.034346, 1.040622] |
| 0.9 | [0.203876, 0.990338, -0.194214] | [0.112975, 0.794542, 0.092483] | [-0.005222, -0.041043, 1.046265] |
| 1.0 | [0.152286, 1.052583, -0.204868] | [0.114503, 0.786281, 0.099216] | [-0.003882, -0.048116, 1.051998] |

#### Deuteranomaly (Machado et al. 2009), linear RGB, `rgb_sim = M · rgb`

| severity | row 1 (R′) | row 2 (G′) | row 3 (B′) |
|---|---|---|---|
| 0.0 | [1.000000, 0.000000, -0.000000] | [0.000000, 1.000000, 0.000000] | [-0.000000, -0.000000, 1.000000] |
| 0.1 | [0.866435, 0.177704, -0.044139] | [0.049567, 0.939063, 0.011370] | [-0.003453, 0.007233, 0.996220] |
| 0.2 | [0.760729, 0.319078, -0.079807] | [0.090568, 0.889315, 0.020117] | [-0.006027, 0.013325, 0.992702] |
| 0.3 | [0.675425, 0.433850, -0.109275] | [0.125303, 0.847755, 0.026942] | [-0.007950, 0.018572, 0.989378] |
| 0.4 | [0.605511, 0.528560, -0.134071] | [0.155318, 0.812366, 0.032316] | [-0.009376, 0.023176, 0.986200] |
| 0.5 | [0.547494, 0.607765, -0.155259] | [0.181692, 0.781742, 0.036566] | [-0.010410, 0.027275, 0.983136] |
| 0.6 | [0.498864, 0.674741, -0.173604] | [0.205199, 0.754872, 0.039929] | [-0.011131, 0.030969, 0.980162] |
| 0.7 | [0.457771, 0.731899, -0.189670] | [0.226409, 0.731012, 0.042579] | [-0.011595, 0.034333, 0.977261] |
| 0.8 | [0.422823, 0.781057, -0.203881] | [0.245752, 0.709602, 0.044646] | [-0.011843, 0.037423, 0.974421] |
| 0.9 | [0.392952, 0.823610, -0.216562] | [0.263559, 0.690210, 0.046232] | [-0.011910, 0.040281, 0.971630] |
| 1.0 | [0.367322, 0.860646, -0.227968] | [0.280085, 0.672501, 0.047413] | [-0.011820, 0.042940, 0.968881] |

#### Tritanomaly (Machado et al. 2009), linear RGB, `rgb_sim = M · rgb`

| severity | row 1 (R′) | row 2 (G′) | row 3 (B′) |
|---|---|---|---|
| 0.0 | [1.000000, 0.000000, -0.000000] | [0.000000, 1.000000, 0.000000] | [-0.000000, -0.000000, 1.000000] |
| 0.1 | [0.926670, 0.092514, -0.019184] | [0.021191, 0.964503, 0.014306] | [0.008437, 0.054813, 0.936750] |
| 0.2 | [0.895720, 0.133330, -0.029050] | [0.029997, 0.945400, 0.024603] | [0.013027, 0.104707, 0.882266] |
| 0.3 | [0.905871, 0.127791, -0.033662] | [0.026856, 0.941251, 0.031893] | [0.013410, 0.148296, 0.838294] |
| 0.4 | [0.948035, 0.089490, -0.037526] | [0.014364, 0.946792, 0.038844] | [0.010853, 0.193991, 0.795156] |
| 0.5 | [1.017277, 0.027029, -0.044306] | [-0.006113, 0.958479, 0.047634] | [0.006379, 0.248708, 0.744913] |
| 0.6 | [1.104996, -0.046633, -0.058363] | [-0.032137, 0.971635, 0.060503] | [0.001336, 0.317922, 0.680742] |
| 0.7 | [1.193214, -0.109812, -0.083402] | [-0.058496, 0.979410, 0.079086] | [-0.002346, 0.403492, 0.598854] |
| 0.8 | [1.257728, -0.139648, -0.118081] | [-0.078003, 0.975409, 0.102594] | [-0.003316, 0.501214, 0.502102] |
| 0.9 | [1.278864, -0.125333, -0.153531] | [-0.084748, 0.957674, 0.127074] | [-0.000989, 0.601151, 0.399838] |
| 1.0 | [1.255528, -0.076749, -0.178779] | [-0.078411, 0.930809, 0.147602] | [0.004733, 0.691367, 0.303900] |

### 7.5 Alternatives: Viénot (1999) and Brettel (1997) dichromat simulation [V: libDaltonLens v public-domain source, sRGB + Smith–Pokorny LMS]

**Viénot, Brettel & Mollon 1999.** A single projection plane gives one 3×3 matrix in linear RGB. It is accurate for **protanopia and deuteranopia**. The authors of libDaltonLens warn that it is *not* accurate for tritanopia.
```
protan: [[0.11238, 0.88762, 0.00000], [0.11238, 0.88762, -0.00000], [0.00401, -0.00401, 1.00000]]
deutan: [[0.29275, 0.70725, 0.00000], [0.29275, 0.70725, -0.00000], [-0.02234, 0.02234, 1.00000]]
```

**Brettel, Viénot & Mollon 1997.** Two half-planes. Choose the matrix by the sign of `n · rgb_lin`: use `M1` if the dot product is ≥ 0, otherwise `M2`. This is the reference method for **tritanopia**.
```
protan  M1 = [[0.14980, 1.19548, -0.34528], [0.10764, 0.84864, 0.04372], [0.00384, -0.00540, 1.00156]]
        M2 = [[0.14570, 1.16172, -0.30742], [0.10816, 0.85291, 0.03892], [0.00386, -0.00524, 1.00139]]
        n  = [ 0.00048,  0.00393, -0.00441]
deutan  M1 = [[0.36477, 0.86381, -0.22858], [0.26294, 0.64245, 0.09462], [-0.02006, 0.02728, 0.99278]]
        M2 = [[0.37298, 0.88166, -0.25464], [0.25954, 0.63506, 0.10540], [-0.01980, 0.02784, 0.99196]]
        n  = [-0.00281, -0.00611,  0.00892]
tritan  M1 = [[1.01277, 0.13548, -0.14826], [-0.01243, 0.86812, 0.14431], [0.07589, 0.80500, 0.11911]]
        M2 = [[0.93678, 0.18979, -0.12657], [0.06154, 0.81526, 0.12320], [-0.37562, 1.12767, 0.24796]]
        n  = [ 0.03901, -0.02788, -0.01113]
severity blend (libDaltonLens):  rgb_out = s · rgb_cvd + (1 − s) · rgb
```

**Which to use**
- Use **Machado** for anomalous trichromacy at a given severity. This is our default for protan and deutan, because most colour-deficient users are anomalous trichromats.
- Use **Brettel** for tritan.
- Viénot is fine for fast protan/deutan dichromat previews.
- The published Viénot and Brettel papers used CRT phosphors. The matrices above are their modern sRGB re-derivations (DaltonLens), which is what our pipeline needs.

### 7.6 Daltonisation (recolouring) algorithms and evidence

**Error-projection daltonize** (Fidaner, Lin & Ozguven 2005, Stanford EE368 report; widely reimplemented) [V: `joergdietrich/daltonize` source]:
```
sim  = S · rgb_lin                    (S = Machado matrix for the user's type/severity)
err  = rgb_lin − sim                  (information the user cannot see)
corr = E · err,   E = [[0, 0, 0], [0.7, 1, 0], [0.7, 0, 1]]      (protan/deutan: shift red-green error into G and B)
out  = clamp(rgb_lin + corr, 0, 1)
tritan variant [D]: E_t = [[1, 0, 0.7], [0, 1, 0.7], [0, 0, 0]]
```
- Apply the output with a user "strength" slider k ∈ [0, 1]: `out = rgb + k·corr`.
- For video and the live camera, run it as a WebGL fragment shader: two 3×3 multiplies per pixel, well within budget.

**Evidence**
- Simon-Liedtke & Farup 2016 (*J Vis Commun Image Represent* 35:236–247) [S]: in a behavioural visual-search study, some daltonisation methods improved **accuracy but not response time**. Kotera's and Fidaner's methods ranked highest. Benefits depend on the image type.
- Customised daltonisation per severity has been proposed (Univ Access Inf Soc 2021) [S].

**Honest summary:** recolouring can make some colour-coded distinctions (charts, maps, traffic-light UI states) distinguishable. It **does not restore normal colour vision**, and it can make natural images look unnatural. For UI, **design colour-safe palettes plus non-colour cues**; that is always preferable to recolouring UI. Use daltonisation for third-party images, video and camera.

**OS equivalents:** iOS Color Filters and Android Color correction (§12). Map protan → iOS "Red/Green Filter (Protanopia)" / Android "Red-green, red weak (Protanomaly)", and so on.

### 7.7 Limitations (colour)

- Screen-based classification is less reliable for **tritan** defects: display blue primaries vary, and older users have yellowing lenses.
- Female carriers, mixed defects and acquired defects do not fit the classification scheme.
- A result of "normal" must never be presented as clearing the user for occupational colour standards (pilots, electricians, and so on).

**Citations (§7)**
- IEC 61966-2-1:1999.
- Machado GM, Oliveira MM, Fernandes LAF. A physiologically-based model for simulation of color vision deficiency. *IEEE TVCG* 2009;15(6):1291–1298. doi:10.1109/TVCG.2009.113
- Brettel H, Viénot F, Mollon JD. Computerized simulation of color appearance for dichromats. *JOSA A* 1997;14:2647–2655.
- Viénot F, Brettel H, Mollon JD. Digital video colourmaps for checking the legibility of displays by dichromats. *Color Res Appl* 1999;24:243–252.
- libDaltonLens (public domain, github.com/DaltonLens/libDaltonLens).
- colorspacious 1.1.2.
- DaltonLens-Python 0.1.5.
- Regan BC, Reffin JP, Mollon JD 1994.
- Mollon & Regan, Cambridge Colour Test Handbook.
- Waggoner CCVT evaluations (desktop; iPad: *Afr Vision Eye Health* and related 2021–2025 reports).
- Simon-Liedtke JT, Farup I 2016.
- Fidaner O, Lin P, Ozguven N. Analysis of color blindness (Stanford EE368 project, 2005) [U].

---

## 8. Amsler grid self-screening for macular problems

> **Scope note (manager decision, 2026-09-28):** the Amsler grid is **out of product scope** for regulatory reasons. This section is kept as background only. Do not implement it without regulatory sign-off.

### 8.1 Standard geometry [S]

- 10 cm × 10 cm square, divided into 20 × 20 squares of 5 mm, with a central fixation dot.
- Viewed at **30 cm** with the reading correction, one eye at a time. Each square subtends about 1°: exactly 0.955° for 5 mm at 30 cm. The whole grid covers **±10°** around fixation.
- Chart 1 is white lines on a black background.

### 8.2 Phone and tablet presentation [D]

**Scale by angle, not by millimetres.** At the camera-measured distance `d`:
- Square side = `2·d·tan(0.5°)`: 5.24 mm at 30 cm, 6.11 mm at 35 cm, 6.98 mm at 40 cm.
- Full 20° grid = `2·d·tan(10°)`: 10.58 cm at 30 cm.

**Phone short sides are 5.8–7.3 cm, so a full 20° grid does not fit** at 30 cm. Use one of two layouts:

1. **Central grid.** A 10° × 10° grid (±5°) with fixation at its centre. At 30 cm this is 5.3 cm and fits every phone in portrait. It covers the fovea and parafovea, where most metamorphopsia is noticed.
2. **Quadrant method** (covers the full ±10°). Four screens, each a 10° × 10° grid, with the fixation dot at the corner nearest the true centre:
   - upper-left quadrant: fixation at the bottom-right corner;
   - and likewise for the other three quadrants.

   The user fixates the corner dot on each screen. Run it in landscape.

Tablets show the full 20° grid in one view.

**Rendering**
- Lines about 2.5′ wide (0.22 mm at 30 cm), at least 2 px_dev.
- White lines on black (Chart 1 style). Offer black-on-white if the user prefers it.
- Central fixation dot 0.5° in diameter.
- Brightness per §0.3. Keep the distance within ±10% of target using the camera.
- The user wears their reading or phone correction. Test each eye separately, with the other covered.

**Questions** (show one at a time; the user answers by touch):
1. Can you see the centre dot?
2. While looking at the dot, can you see all four sides and corners of the grid?
3. Are any lines wavy, bent or distorted?
4. Are any areas missing, blurred, darker or discoloured?
5. If you answered yes to 3 or 4, draw around the area with your finger.

Store the drawn map in grid coordinates (degrees) for longitudinal comparison. Repeat weekly for users over 50 or with known AMD, and compare with the previous map.

### 8.3 Evidence and limitations

- Faes et al. 2014 (*Eye* 28:788–796), meta-analysis [S]: Amsler grid pooled **sensitivity 0.78** (95% CI 0.64–0.87), **specificity 0.97** (0.91–0.99). Preferential hyperacuity perimetry was more sensitive.
- Bjerager et al. 2023 (*JAMA Ophthalmol* 141:315–323), self-assessment, 10 studies, 1890 eyes [S]:

  | Comparison group | Sensitivity for neovascular AMD | Specificity |
  |---|---|---|
  | Healthy controls | **67%** | **99%** |
  | Non-neovascular AMD | 71% | 63% |

  Conclusion: at-risk patients should have regular examinations **regardless of Amsler results**.
- **A normal Amsler result must never reassure.** Show the text: "A normal result does not rule out eye disease."
- Hyperacuity-based home tests (for example ForeseeHome and Alleye) are regulated medical devices. Leave them out of scope unless regulatory work is planned.

### 8.4 Red-flag outcomes (urgent)

Any of the following, in either eye:
- **new** or **changed** distortion (wavy or bent lines);
- a new missing, dark or blurred patch;
- inability to see the fixation dot;
- a sudden drop in central vision.

**Required app response:**

> "Contact an eye doctor or eye emergency service **today** (within 24 hours). Don't wait for your next routine appointment."

**Basis:** NICE NG82 (2018) [S]:
- Urgent referral to a macula service for suspected late (wet, active) AMD, "normally within 1 working day" (not an emergency referral).
- Anti-VEGF treatment within 14 days of referral.

If the user reports sudden severe vision loss, a curtain or shadow, or flashes and floaters, show the emergency (same-day) message instead (§13).

**Citations (§8)**
- Amsler M. Earliest symptoms of diseases of the macula. *Br J Ophthalmol* 1953;37:521–537 [U].
- StatPearls "Amsler Grid" (NBK538141).
- Faes L et al. *Eye* 2014;28:788–796. doi:10.1038/eye.2014.104
- Bjerager J et al. *JAMA Ophthalmol* 2023;141:315–323.
- NICE guideline NG82: Age-related macular degeneration (2018).

---

## 9. Focus range: near point, far point, and viewing-distance recommendation

### 9.1 Age norms (Hofstetter 1950) [S]

Amplitude of accommodation (D) by age A (years):
- **minimum = 15 − 0.25·A**
- **mean = 18.5 − 0.30·A**
- **maximum = 25 − 0.40·A**

Example at 45 years: minimum 3.75 D, mean 5.0 D, maximum 7.0 D.

Hofstetter's equations are based on old datasets. A 2022 analysis of 5,433 subjects reports that they **overestimate** measured amplitude, especially in older subjects. Use the minimum formula as the flag threshold, not the mean.

### 9.2 Near point of accommodation (NPA): camera-assisted modified push-up [D]

**Method basis.** The classic push-up method **overestimates** amplitude: the target's angular size grows as it approaches, and depth of focus helps. In one comparison, push-up gave 10.20 ± 0.96 D and the minus-lens method 9.66 ± 0.75 D [S]. We remove the size cue by rescaling the target every frame so that its **angular size stays constant**. This is only possible because we measure distance with the camera.

**Procedure**
- One eye, other eye covered. The user wears their distance correction, or none if they have no glasses.
- Target: a 2-line sentence whose x-height is held at **max(user's logMAR + 0.2, 0.3) logMAR**, recomputed per frame from the camera distance.
- The user starts at about 40 cm and **slowly** brings the phone towards the eye. Show a guidance cue if movement exceeds 3 cm/s. The user taps "blurry" at the **first sustained blur**.
- 3 runs per eye. Take the median `d_np`.

**Result**
- `Amp ≈ 1000/d_np(mm) − 1000/d_fp(mm)`. The second term is 0 for users who are corrected or emmetropic.
- The camera cannot track reliably below about 15 cm (the face leaves the frame). If `d_np < 150 mm`, report "near point ≤ 15 cm (≥ 6.7 D)".

### 9.3 Far point for uncorrected myopes [D + S]

**Procedure**
- Same constant-angle target, set at **logMAR 0.1**, or at the user's best acuity + 0.1.
- The user moves the phone **away** from 20 cm and taps when the text **first becomes blurry**. 3 runs; take the median `d_fp`.
- Only far points **≤ 65 cm** (arm's length) can be measured, which corresponds to myopia of about ≥ 1.5 D.

**Result:** spherical-equivalent estimate `SE ≈ −1000/d_fp(mm)` D.

**Evidence** [S]:
- A Schepens-type smartphone far-point app (*TVST* 2022) holds three 20/20 Tumbling E's at constant angular size. In 201 eyes from 0 to −10.2 D it found R = 0.91 against clinical refraction, with a 0.17 D bias. Reported limits of agreement were on the order of ±0.9 D.
- A 2025 over-refraction study (*Photonics* 12:772) in artificially myopised young eyes found 89.5% of estimates within 0.25 D, with a mean difference of 0.00 ± 0.44 D.
- Astigmatism above about 2 D invalidates spherical-equivalent estimates.

### 9.4 What refractive estimates may responsibly be shown [D]

**Do show:**
- The **focus range**: "Text stays sharp for you between X cm and Y cm with your current glasses."
- Qualitative flags:
  - "Your near focus is farther than typical for your age": NPA beyond `1000/Hofstetter_min(A)` mm, confirmed on retest.
  - "Distant text may be blurry for you — possible nearsightedness."

**Do NOT show:**
- A spectacle prescription (sphere, cylinder, axis or add).
- A dioptric value presented as a prescription.

Refraction estimates are regulated medical-device functionality in the EU, US and Israel, and can mislead. They may be kept internally as an **uncertain** estimate with ±1 D uncertainty, to drive recommendations such as "consider reading glasses; see an optometrist".

### 9.5 From focus range to recommended viewing distance and text size [D]

**Comfort rule.** Sustaining no more than about ½ of the amplitude is a clinical convention used when prescribing reading adds [U: half-amplitude rule, standard optometry texts]. So:
`d_min_comfort (mm) = 1000 / (0.5·Amp)`.

**Recommended distance:** `d_rec = clamp(max(d_habitual, d_min_comfort), 250 mm, min(d_fp, 600 mm))`.
- If `d_min_comfort > 600 mm` (arm's length), which is typical from about 50–55 years without readers:
  - Recommend reading glasses or an eye exam.
  - Set `d_rec` to the user's habitual distance and compensate with **larger text** (§4 at `d_rec`).
- If `d_fp < d_min_comfort`, the user is a myope with presbyopia and no clear comfortable distance. Recommend an exam.

**Text size:** always run the formula in §4.3 at `d_rec`. When `d_rec` differs from the acuity-test distance by more than 15%, repeat the acuity test at `d_rec` (quick 12-trial version).

**Citations (§9)**
- Hofstetter HW. A useful age-amplitude formula. *Optom World* 1950;38:42–45.
- Burns DH et al. Sources of error in clinical measurement of the amplitude of accommodation. *J Optom* 2020 [S].
- *TVST* 2022 "Preliminary Evaluation of a Smartphone App for Refractive Error Measurement".
- *Photonics* 2025;12:772.
- *TVST* 2025/2026 "Myopia Prescription Based on Smartphone App: A Feasibility Study in Africa" [S].

---

## 10. Image, video and live-camera enhancement for low vision

### 10.1 Evidence

**Peli's adaptive enhancement** (Peli et al. 1991, *IOVS* 32:2337–2350) [S]
- Enhances a band of spatial frequencies, controlling *local contrast* as a function of local mean luminance.
- Parameters were derived from each patient's measured contrast-sensitivity loss.
- Tested with patients with central scotoma or cataract.

**Face recognition** (Peli, Lee, Trempe & Buzney 1994, *JOSA A* 11:1929–1939) [S]
- The **4–8 cycles/face** band is critical for recognition.
- Patients **preferred** enhancement at higher frequencies, about 16 c/face, which is at least 1 octave above the critical band.
- Individually selected enhancement did not beat a uniform setting on recognition.
- Enhancement that hurts normal observers can still help low-vision observers.

**Wideband enhancement for TV** (Peli, Kim, Yitzhaky, Goldstein & Woods 2004, *JOSA A* 21:937–950) [S]
- Adds a **bipolar contour map** of edges and bars to the image.
- Patients preferred **moderate** levels and rejected visible artefacts.
- Perceived-quality gains were significant in only **22%** of patients.
- **No improvement** on content questions.

**MPEG/DCT enhancement** (Fullerton & Peli 2006, *J SID* 14:15–24; Fullerton, Woods, Vera-Diaz & Peli 2007, *JOSA A* 24:B174–B187) [S]
- Scales DCT coefficients by a user gain `k` inside the decoder.
- 24 patients chose preferred levels **consistently**.
- The chosen level **correlated with letter contrast sensitivity**.
- Training and video type did not affect the choice.

**Contour enhancement** (Satgunam et al. 2012, *Optom Vis Sci* 89:E1364–E1373) [S]: preference and visual-search effects in 24 low-vision subjects, acuity 20/52–20/240. Benefits were modest and individual.

**Bottom line:** enhancement reliably improves *preference* for many users, while *objective task* gains are inconsistent. The product must present it as an optional, user-tuned comfort feature, not a treatment.

### 10.2 Implementation parameters [D]

Run as a WebGL2 fragment-shader pipeline on the luma channel `Y′` (gamma-encoded, to limit halo visibility). Leave chroma unchanged, or apply daltonisation separately.

1. **Map the user's resolution limit to image space**
   - Cutoff frequency `f_c = 30 / 10^L` cycles/deg (logMAR 0 ≈ 30 c/deg).
   - Pixels per degree on screen: `ppd = d·tan(1°) / mmPerDev`, in device px/deg. An iPhone 15 at 30 cm gives ≈ 95 and at 40 cm ≈ 126.
   - Enhancement centre frequency `f0 = 0.35·f_c` (c/deg). This boosts detail that is visible but attenuated.
   - Band: difference of Gaussians with `σ1 = ppd / (2π·f0)` px and `σ2 = 2·σ1`, i.e. about a 1-octave band.
2. **Adaptive (local-contrast) gain, Peli-style:**
   ```
   base = G_σ2 * Y′                  (local mean)
   band = G_σ1 * Y′ − G_σ2 * Y′
   Y′out = clamp( Y′ + k · band · (Y′mean_global / max(base, 0.05))^0.5 , 0, 1 )
   ```
   - The `(…)^0.5` term partially normalises for local luminance, so dark regions get proportionally more help.
   - Use a guided or bilateral base instead of a Gaussian when `k > 1`, to reduce halos.
3. **Gain from contrast sensitivity:** `k = clamp(1.25·(1.80 − logCS), 0, 1.5)`.
   - Examples: 1.8 → 0; 1.5 → 0.38; 1.2 → 0.75; 1.0 → 1.0; ≤ 0.6 → 1.5.
   - Show it as a 0–100% slider pre-set to this value.
   - Let the user refine it with a 6-step **preference staircase** (A/B pairs with a halving step), as in Fullerton 2007.
4. **Wideband / contour mode** (severe loss, `L ≥ 0.7` or `logCS < 1.0`):
   - Detect edges with a Laplacian-of-Gaussian at `σ = σ1`.
   - Overlay bipolar contours: dark on the dark side, light on the light side. Line width 1.5·σ1, opacity 0.3–0.7 (user control).
5. **Global contrast for the live camera and dim scenes:** CLAHE on luma, clip limit 2.0, 8×8 tiles. Preserve the global mean.
6. **Magnification recommendation**
   - `M_needed = 10^((L + log10 R) − L_detail)`, where `L_detail` is the logMAR-equivalent size of the detail at the current zoom.
   - For text in images or the camera: `M = x_needed_mm / x_present_mm`. This is the same acuity-reserve logic as in §4 (Lovie-Kitchin / Cheong 2002).
   - Default reserve R = 2. Cap the in-app zoom at 8×. Beyond that, recommend the OS Magnifier or Zoom, which on iOS reaches 15× (§12).
7. **Performance:** at 1080p on mid-range phones, use separable Gaussians and half-resolution blurs. Target 30 fps or better.

### 10.3 Limitations

- Halos, noise amplification and compression-artefact amplification.
- The benefit is individual. Nothing here restores acuity.
- Do not apply enhancement to text UI. For text, change size, weight and contrast instead.

---

## 11. What is physically impossible in software: "vision-correcting" screens

### 11.1 Physics

- A conventional 2D display emits light whose angular distribution the software **cannot** control. Every pixel sends the same image to every part of the pupil.
- Refractive blur is a convolution of the retinal image with a defocus point-spread function, a uniform disk (for a circular pupil) of angular diameter `β(rad) = pupil(m) × ΔD(dioptres)`.

**Examples** [V: arithmetic]:

| Defocus | Pupil | Blur disk | First MTF zero |
|---|---|---|---|
| 1 D | 4 mm | 13.75′ | 5.3 c/deg |
| 0.5 D | 3 mm | 5.2′ | 14.2 c/deg |

The first zero of the MTF is at `f = 1.22/β` cycles/rad.
- Letters are identified mainly from about 3 cycles per letter [U: Solomon & Pelli 1994].
- A newspaper-size x-height of 14′ therefore needs about 13 c/deg, which sits beyond the first zero for 1 D of blur.

**Why it can't be undone on the display:**
- Pre-filtering (deconvolving) the displayed image would require:
  1. amplifying frequencies near the MTF zeros **without bound** (information at the zeros is lost);
  2. **negative light**, which has to be emulated by adding an offset, collapsing contrast to a few percent;
  3. exact knowledge of pupil size, accommodation, eye position and distance, all of which change continuously.
- Published single-display pre-filtering (for example Alonso & Barreto 2003; Montalto et al. 2015 [U]) achieves only small gains at **severely reduced contrast**.

### 11.2 What the research prototypes needed

**Huang, Wetzstein, Barsky & Raskar 2014** ("Eyeglasses-free display", *ACM TOG* 33(4):59, SIGGRAPH) [S]:
- A **light-field display**: a printed **pinhole mask mounted 5.4 mm in front** of an iPod touch 4 screen (326 ppi, 78 µm pixel pitch).
- Pinholes about 75 µm, spaced about 390 µm.
- Combined with 4D pre-filtering, so that different pupil positions receive different images.
- This adds hardware, costs resolution and brightness, and still requires a known eye position and prescription.

**Earlier work**:
- Pamplona et al. 2012 "Tailored displays" (*ACM TOG* 31(4)).
- Huang et al. 2012 multilayer displays (*ACM TOG* 31(6)).

**Recent claims** (for example arXiv:2501.01450, "high-contrast inverse blurring", 2025) remain research demonstrations with contrast/sharpness trade-offs.

**Conclusion:** a normal phone or tablet screen **cannot optically correct** myopia, hyperopia, presbyopia or astigmatism. No software update can change this.

### 11.3 Honest product statements

**Allowed:**
- "We adapt what's on your screen — size, weight, contrast, colour and spacing — to what you can see best."
- "We help you set up your phone's own accessibility settings."
- "Image/video enhancement can make details easier to see for some people."

**Not allowed:**
- "Corrects your vision"
- "Replaces glasses"
- "Glasses-free screen"
- "Treats / improves your eyesight"
- "Optically sharpens blur caused by your eyes"

---

## 12. System-wide accessibility settings to map a profile onto

**How to read this section**
- Menu paths are for **iOS/iPadOS 26** (current as of 2025–26; iOS 27 shipped in September 2026 and its announced vision changes are in Magnifier and Accessibility Reader), **Android 15–16 on Pixel/AOSP**, and **Samsung One UI 7–8**.
- **Android 17 (2026) reorganises the accessibility settings** [S: press coverage]. Keep all paths in a server-side, per-OS-version table, and re-verify them on real devices for every major OS release.
- Labels are en-US. Localise them from the OS's own Hebrew strings, captured from real devices, **not by translating them ourselves**.

### 12.1 iOS / iPadOS

| Setting | Path | Values / steps | Tag |
|---|---|---|---|
| **Larger Text** (Dynamic Type) | Settings > Accessibility > Display & Text Size > Larger Text | Slider with **7 standard sizes**: xSmall, Small, Medium, **Large (default)**, xLarge, xxLarge, xxxLarge. Toggle **Larger Accessibility Sizes** adds **AX1–AX5**. | [V: HIG] [S: Apple Support] |
| Body text size (pt) per step | — | xS **14**, S **15**, M **16**, L **17**, xL **19**, xxL **21**, xxxL **23**, AX1 **28**, AX2 **33**, AX3 **40**, AX4 **47**, AX5 **53**. iOS default body 17 pt; minimum 11 pt. | [V: Apple HIG Typography] |
| **Bold Text** | Settings > Accessibility > Display & Text Size > Bold Text | on/off | [S] |
| **Increase Contrast** | Settings > Accessibility > Display & Text Size > Increase Contrast | on/off | [S] |
| Reduce Transparency | Settings > Accessibility > Display & Text Size > Reduce Transparency | on/off | [S] |
| Differentiate Without Color; Button Shapes; On/Off Labels | Settings > Accessibility > Display & Text Size | on/off | [S/U] |
| Smart Invert / Classic Invert | Settings > Accessibility > Display & Text Size | on/off | [S] |
| **Color Filters** | Settings > Accessibility > Display & Text Size > Color Filters | Toggle, then one of: **Grayscale**; **Red/Green Filter (Protanopia)**; **Green/Red Filter (Deuteranopia)**; **Blue/Yellow Filter (Tritanopia)**; **Color Tint**. **Intensity** slider (continuous) for all; Color Tint also has a **Hue** slider. | [S] |
| **Reduce White Point** | Settings > Accessibility > Display & Text Size > Reduce White Point | Toggle plus slider **25%–100%** (a higher % is dimmer) | [S] |
| Auto-Brightness | Settings > Accessibility > Display & Text Size > Auto-Brightness | on/off | [S] |
| **Zoom** | Settings > Accessibility > Zoom | Full Screen Zoom or Window Zoom. **Maximum Zoom Level 1.2×–15×**. Zoom Filter: None, Inverted, Grayscale, Grayscale Inverted, Low Light. Follow Focus, Smart Typing, Zoom Controller. Gesture: double-tap with three fingers. | [S; gesture U] |
| **Magnifier** | Magnifier app (pre-installed). Can be added to Control Center, the Action button (15 Pro and later), or the Accessibility Shortcut | Camera magnifier with zoom, filters, brightness and contrast. iOS 26/27 add AI descriptions. | [S] |
| Per-App Settings | Settings > Accessibility > Per-App Settings | Per-app overrides for text size, bold, contrast, and so on | [U] |
| Accessibility Shortcut | Settings > Accessibility > Accessibility Shortcut (triple-click side/top button) | Choose Zoom, Magnifier, Color Filters, Reduce White Point, and others | [U] |
| Accessibility Reader (iOS 26+) | Systemwide reading mode | Font, colour and spacing options | [S] |

**Detecting settings from our PWA** (to confirm the user applied them):
- **Text size** [S; mapping D]: compute the size of an element styled `font: -apple-system-body`. WebKit scales it with Dynamic Type. Map the pixel value to the nearest step in the table above.
- **Increase Contrast** [U]: `matchMedia('(prefers-contrast: more)')`.
- **Invert** [U]: `(inverted-colors: inverted)`.
- **Bold Text, Color Filters, Zoom and Reduce White Point cannot be detected from the web.** Ask the user to confirm instead.

### 12.2 Android (AOSP / Pixel, Android 15–16)

| Setting | Path | Values / steps | Tag |
|---|---|---|---|
| **Font size** | Settings > Accessibility > **Display size and text** > Font size | 7 steps: **0.85, 1.0 (default), 1.15, 1.30, 1.50, 1.80, 2.0** (`entryvalues_font_size`) | [V: AOSP SettingsLib `arrays.xml`] |
| Non-linear scaling (Android 14+) | automatic | Above 1.0 the sp→dp mapping is non-linear (`FontScaleConverterFactory`, linear interpolation between anchors). Body **14 sp** → 11.9 / 14.0 / 16.4 / 18.8 / 22.0 / 24.4 / **26.0 dp**. Body **16 sp** → 13.6 / 16.0 / 18.1 / 20.2 / 23.0 / 26.0 / **28.0 dp**. Text ≥ 100 sp is not enlarged. | [V: AOSP source; 16 sp values interpolated] |
| **Display size** | Settings > Accessibility > Display size and text > Display size | Slider "Make everything bigger or smaller". This is display density. The number of steps is device-dependent, typically 3–5, and scales all dp, not just text. | [V: label; U: steps] |
| **Bold text** | Settings > Accessibility > Display size and text > Bold text | on/off. Implemented as font-weight adjustment **+300** (700 − 400) via `Settings.Secure.FONT_WEIGHT_ADJUSTMENT`. | [V: AOSP] |
| **High contrast text** (≤ Android 15) → **Outline text** (Android 16+) | Settings > Accessibility > Display size and text | on/off. Old: "Change text color to black or white". New AOSP string: "Maximize text contrast — Add a black or white background around text". | [V: AOSP strings; S: Android 16 naming] |
| **Color contrast** (Android 15+) | Settings > Accessibility > Color and motion > Color contrast | **Default / Medium / High**. Affects Material You dynamic-colour apps only. | [V: strings; S: path] |
| **Color correction** | Settings > Accessibility > Color and motion > Color correction | "Use color correction". Modes: **Deuteranomaly "Red-green, green weak"**, **Protanomaly "Red-green, red weak"**, **Tritanomaly "Blue-yellow"**, **Grayscale**. **Intensity** slider on Android 15+ (Pixel); unavailable in Grayscale mode. | [V: AOSP strings; S: Android 15 intensity] |
| Color inversion; Dark theme; Remove animations | Settings > Accessibility > Color and motion | on/off | [V] |
| **Extra dim** | Settings > Accessibility > Extra dim (also a Quick Settings tile). Pixel with Android 15+ also has a Display-level "Extra dim — Allow device to go dimmer than usual". | Toggle plus **Intensity** slider (Dimmer ↔ Brighter), "Keep on after device restarts" | [V: AOSP strings] |
| **Magnification** | Settings > Accessibility > Magnification | Shortcut (accessibility button, volume keys, or triple-tap), full screen or partial window, follow typing | [V: strings] |

**Detecting settings from our PWA:**
- **Font scale** [S]: Chrome 138+ exposes the OS text scale as `env(preferred-text-scale)`. Chrome 139+ supports `<meta name="text-scale" content="scale">`, which makes `rem` follow the OS font scale.
- **Other settings** [U]: Color correction, Bold text and Outline text are not detectable. `prefers-contrast` is supported, but Android maps it inconsistently.

### 12.3 Samsung One UI 7–8

**Verify on devices** (S23, S24, S25, A-series). Samsung support pages confirm the paths, but the option lists vary by model and region.

| Setting | Path | Notes | Tag |
|---|---|---|---|
| **Font size**, **Bold font**, Font style | Settings > Display > **Font size and style** | Font-size slider; Bold font toggle | [S: Samsung support] |
| **Screen zoom** | Settings > Display > Screen zoom | Equivalent of Android Display size | [S] |
| **High contrast fonts** | Settings > Accessibility > **Vision enhancements** > High contrast fonts | Adds an outline to all text | [S] |
| High contrast keyboard | Settings > Accessibility > Vision enhancements | | [S] |
| **Color correction** ("Color adjustment" on S23/S24) | Settings > Accessibility > Vision enhancements > Color correction | Grayscale; red–green / green–red / blue–yellow presets; a personalised option built from a colour-arrangement test; intensity slider | [S path; U option list] |
| Color filter | Settings > Accessibility > Vision enhancements > Color filter | Tinted overlay with opacity | [S] |
| Extra dim; Color inversion; Magnification; Magnifier window | Settings > Accessibility > Vision enhancements | | [U] |
| Relumino mode (selected models) | Settings > Accessibility > Vision enhancements | Outlines and edge enhancement for low vision | [S] |
| Dim strobing (One UI 8.5) | Settings > Accessibility > Vision enhancements | | [S] |

### 12.4 Profile → settings mapping [D]

Inputs:
- `fs_px`: the recommended body size (§4.3, in px_css = iOS pt ≈ Android dp)
- `logCS` (§5)
- CVD type and severity `s` (§7)
- polarity preference (§4.4 / §5.5)
- `L` (§3)

1. **iOS Larger Text.** Pick the smallest step whose Body is ≥ `fs_px` from {14, 15, 16, 17, 19, 21, 23, 28, 33, 40, 47, 53}.
   - Never go below Large (17) unless the user asks.
   - If the step is > 23, instruct them to switch on **Larger Accessibility Sizes** first.
   - If `fs_px` > 53, choose AX5 and add Zoom (step 6).
2. **Android Font size.** Pick the smallest step whose converted **16 sp** value is ≥ `fs_px`, from {0.85: 13.6, 1.0: 16.0, 1.15: 18.1, 1.3: 20.2, 1.5: 23.0, 1.8: 26.0, 2.0: 28.0}.
   - If `fs_px` > 28, choose 2.0, then raise **Display size** step by step until the in-app check passes (each step is about +10–15% [U]).
   - If it is still short, add Magnification.
   - Samsung: use the same logic with its Font size slider. Its steps differ, so verify the result by re-reading `env(preferred-text-scale)` where available.
3. **Bold.** Turn on iOS Bold Text / Android Bold text / Samsung Bold font if `logCS < 1.65` **or** `L ≥ 0.3`, or if the user prefers it.
4. **Contrast.** For `logCS < 1.65`: iOS **Increase Contrast**, Android **Color contrast = Medium**. For `logCS < 1.35`: Android **Color contrast = High** and **Outline text / High contrast text**, Samsung **High contrast fonts**. On iOS, add **Reduce Transparency**.
5. **Colour** (only if the user opts in; many colour-deficient users prefer no filter):

   | Type | iOS | Android | Samsung |
   |---|---|---|---|
   | protan | Red/Green Filter (Protanopia) | "Red-green, red weak" (Protanomaly) | red–green option |
   | deutan | Green/Red Filter (Deuteranopia) | "Red-green, green weak" (Deuteranomaly) | green–red option |
   | tritan | Blue/Yellow Filter (Tritanopia) | "Blue-yellow" | blue–yellow option |

   Initial intensity = `round(100·s)`%. Android: Low / Medium / High by `s < 0.34`, `< 0.67`, or higher. The user then adjusts while viewing our test image.
6. **Zoom / Magnifier.** If `L ≥ 0.7`, or `fs_px` exceeds the system maximum: set up the iOS Zoom shortcut with Maximum Zoom Level 8× (adjustable) and the Magnifier in Control Center; Android Magnification shortcut; Samsung Magnification.
7. **Dim / white point** (symptom-driven only, never from test scores): if the user reports glare, photophobia or night use, suggest iOS **Reduce White Point**, starting at 50% [D], or Android/Samsung **Extra dim**.
8. **Dark theme** only if the polarity A/B test or user preference says so (§5.5).
9. **After every change,** re-run a 10-second in-app legibility check (one sentence at the new size) and record whether the user confirmed the change.

---

## 13. Red flags: when to recommend an eye-care professional

**Principles** [D]:
- Every flag is based on a **confirmed** result: an immediate retest on the same session, same eye, same correction. The one exception is symptom-based emergencies.
- Every results screen carries the standing message: "This is not an eye examination. A normal result does not rule out eye disease."
- The **Amsler grid is out of product scope** (manager decision). Its row below is informational only, in case it is ever reinstated.

**Urgency levels:**

| Level | Meaning |
|---|---|
| **EMERGENCY** | Now or same day, via an emergency department or eye emergency service |
| **URGENT** | Within 24 hours |
| **SOON** | Within 1–2 weeks |
| **ROUTINE** | Book an eye exam within 1–3 months |
| **INFO** | No referral; information only |

| # | Trigger (confirmed) | Level | Rationale / source |
|---|---|---|---|
| R1 | User reports **sudden** loss or dimming of vision in one or both eyes; a **curtain or shadow**; a new shower of **floaters or flashes**; a painful red eye; halos with eye pain, headache or nausea; new double vision | **EMERGENCY** | Standard ophthalmic triage for retinal detachment, vascular occlusion, acute angle closure, and neurological causes [U]. Ask a symptom checklist before every test session. |
| R2 | New distortion or missing area in central vision (self-reported, or Amsler if ever reinstated) | **URGENT** | NICE NG82: suspected wet AMD → macula service within 1 working day [S] |
| R3 | Monocular acuity at the tested distance, with the correction the user uses, **worse than logMAR 0.30** (6/12, 20/40, decimal 0.5) | **ROUTINE**. **SOON** if worse than 0.50 (about 6/19). **SOON/URGENT** if worse than 1.0 and new. | WHO ICD-11: presenting acuity worse than 6/12 is mild impairment; worse than 6/18 is moderate [S]. Near impairment is worse than N6/M0.8 at 40 cm = logMAR 0.30 [S]. EU Directive 2006/126/EC Group-1 drivers need binocular ≥ 0.5 decimal [S]. |
| R3a | Same as R3, but age ≥ 45, tested at ≤ 45 cm **without** reading correction, and the other eye is similar | **ROUTINE** + "reading glasses may help" | Presbyopia is the likely cause (Hofstetter, §9) |
| R4 | **Interocular difference ≥ 0.20 logMAR** (2 lines) | **ROUTINE**. **SOON** if either eye is worse than 0.30. | AAO Amblyopia PPP: a difference of ≥ 2 lines [S]. Unilateral disease must be excluded. Retest first, because test–retest variability is ±0.15–0.20. |
| R5 | **Worsening ≥ 0.20 logMAR** against the user's own baseline on the same device and distance | **SOON**. **URGENT** if the change happened over days, or R1 symptoms are present. | Exceeds the test–retest limits (§3.8) |
| R6 | **Contrast sensitivity** below the age lower limit (provisional: < 1.65 if under 60, < 1.50 if 60 or older), or a drop of ≥ 0.30 from baseline | **ROUTINE**. **SOON** if < 1.0 or a rapid drop. | Pelli–Robson categories (< 1.5 moderate, < 1.0 disability) and age norms [S] |
| R7 | **Colour:** tritan-type loss; **asymmetry between eyes** (worst-axis thresholds differ by > 1.5× or the classification differs); generalised loss; or any **change** from baseline | **SOON** | These patterns suggest acquired dyschromatopsia (optic neuropathy, glaucoma, diabetic or macular disease, drug toxicity such as hydroxychloroquine or ethambutol) [U]. Congenital red–green defects are symmetric and lifelong. |
| R7a | Symmetric red–green (protan or deutan) pattern | **INFO** | Offer colour tools. Mention that occupational colour standards need formal testing. |
| R8 | **Near point** worse than the age minimum: amplitude < (15 − 0.25·age) − 2 D, age < 40, confirmed | **ROUTINE** | Possible accommodative insufficiency; Hofstetter minimum [S/D] |
| R9 | Astigmatism dial: a **consistent** darkest meridian (≥ 2 of 3 within ±15°) | **ROUTINE** | Possible uncorrected astigmatism (§6) |
| R10 | Far point measurable (≤ 65 cm) while the user reports **no distance correction**, i.e. possible myopia of 1.5 D or more | **ROUTINE** | Uncorrected refractive error (§9) |
| R11 | Test **unreliable twice** in a row (§3.5) | **ROUTINE** | "We couldn't measure reliably — a professional test is recommended" |
| R12 | No red flag | **INFO** + exam-interval reminder | AAO PPP (adults without risk factors): under 40 every 5–10 years; 40–54 every 2–4 years; 55–64 every 1–3 years; 65+ every 1–2 years [S]. People with diabetes, glaucoma family history, and similar risks need more frequent exams. |

**Wording rules** [D]:
- Never name a disease as the user's diagnosis. Say "can be a sign of eye conditions that an eye-care professional should check".
- Localise the emergency contacts per country. In Israel, list the nearest hospital eye emergency department and national emergency number 101 (MDA) [U: verify with legal/ops].

**Citations (§13)**
- WHO ICD-11 vision impairment categories.
- AAO Amblyopia PPP 2022.
- AAO Comprehensive Adult Medical Eye Evaluation PPP (2020, 2025 update).
- EU Directive 2006/126/EC Annex III.
- NICE NG82 (2018).
- Mäntyjärvi & Laitinen 2001.
- Hofstetter 1950.

---

## IMPLEMENTATION SPEC SUMMARY

This list is copy-ready. Tags as in §0.1. Distances `d` are in mm. `L` = logMAR.

**Calibration and rendering**
1. Card: ID-1, **85.60 × 53.98 mm**, corner radius 3.18 mm. Long side parallel to the device's long axis. `mmPerCss = 85.60 / rectLong_css`. Two matches must agree within ≤ 1.5%, else take the median of 3. Accept only if `mmPerCss·dpr` (device pixel pitch) is between 0.040 and 0.120 mm. [V/D]
2. `mmPerDev = mmPerCss / dpr`. Store `{mmPerCss, dpr, screen.w, screen.h}`. Recalibrate if `dpr` or screen size changes, or if `visualViewport.scale ≠ 1`. [D]
3. Canvas backing size = `round(cssSize·dpr)`, using `devicePixelContentBoxSize` where available. Draw optotypes as vector geometry with anti-aliasing. **Never snap sizes**; snap only positions to whole pixels. [D]
4. `stroke_dev = 2·d·tan(10^L · π/21600) / mmPerDev`; letter = 5 strokes. Minimum `stroke_dev` is **1.0**; below that, report the result as "ceiling-limited". Stimuli are `#000` on `#fff` in the `srgb` canvas colour space. [D]
5. Test distance: at least 350 mm on phones and at least 400 mm on tablets. [D]

**Viewing distance**
6. Blind spot: **13.5°** temporal; `d = offset_mm / tan(13.5°)`. Phones must be in **landscape** (portrait supports at most about 21 cm).
   - Disc 0.5° wide, moving at **2°/s** using time-based animation.
   - Per eye: 4 "disappear" trials (start 4° from fixation, moving out) and 4 "reappear" trials (start 16°, moving in).
   - Reject if the coefficient of variation exceeds 10% or the two eyes differ by more than 12%. `D_bs` = median. Expected error about ±7%. [V/S/D]
7. Iris landmarks 468–472 (right eye) and 473–477 (left eye). `iris_px` = mean of the horizontal and vertical diameters. `depth = IRIS_MM·sqrt(f² + r²)/iris_px`. Population `IRIS_MM` = **11.71 mm** (SD 0.42); MediaPipe's own code uses 11.8. Smooth with `0.9·old + 0.1·new`. [V/S]
8. Per-user calibration constant `K = D_bs·I0`, then `D = K/iris_px` (this cancels individual iris size). Per-device focal length `f_px = D_bs·I0/11.71`; crowd-source its median per model and resolution. Published accuracy with a known focal length is 4.3% ± 2.4% (4.8% with glasses). [V/S/D]
9. Distance during tests must stay within ±10% of target, with head yaw and pitch ≤ 20°. Distance to the stimulus is `d = sqrt(D_cam² + Δ²)`. Default distances: 350 mm (phone), 400 mm (tablet). Literature: 36.2 cm for texting, 32.2 cm for web. [S/D]

**Acuity**
10. Letter height: `h = 2·d·tan(5·10^L arcmin / 2)`.
    - Decimal = `10^−L`; Snellen `6/(6·10^L)` and `20/(20·10^L)`; M = `d_m·10^L`; 1 M = 1.4544 mm.
    - ETDRS letters = `85 − 50L`; 0.02 logMAR per letter.
    - Conversions are for internal use and clinician export only (see item 62). [V/U]
11. Optotype: Tumbling E, 4AFC (guess rate 25%; 8AFC would be 12.5%).
    - Surround bars: 1 stroke thick, 5 strokes long, with a gap of 2.5 strokes.
    - Landolt C reads about 0.1 logMAR worse than ETDRS; Tumbling E is about equal to ETDRS. [S/D]
12. Psychometric function: `ψ = γ + (1−γ−λ)(1 − exp(−10^(β(L−T))))` with **γ = 0.25, λ = 0.03, β = 6.0**.
    - Parameter grid for T: −0.60 to 1.60 in steps of 0.01.
    - Prior: normal, mean 0.2 (0.0 if age < 50), SD 0.6. [D]
13. Trial sequence and stopping:
    - 2 familiarisation trials at posterior mean + 0.3.
    - Catch trials at posterior mean + 0.5 as trials 9 and 17.
    - Place each trial at the **posterior mean**.
    - **24 trials**; may stop early after ≥ 18 trials if posterior SD ≤ 0.035; hard cap 30.
    - Expected time 55–75 s per eye. Result = posterior mean rounded to 0.02, reported with SD and 95% CI. [D]
14. Mark the result **unreliable** if any of these hold:
    - both catch trials missed;
    - posterior SD > 0.08;
    - median reaction time < 300 ms;
    - 5 or more identical responses in a row;
    - more than 20% of trials blanked for distance;
    - squint blendshape > 0.5 on more than 30% of trials. [D]
15. Expected test–retest 95% limits of agreement: **±0.15–0.20** (simulated ±0.09–0.14 plus state noise; FrACT with 18 trials gives ±0.17). A change counts only if it is ≥ 0.20 and confirmed. [S/D]

**Reading and text size**
16. Reserves:
    - Acuity reserve **2:1** (0.3 log, fluent reading) by default; offer **3:1** (0.5 log) for long reading; 1.3:1 is spot reading only.
    - Contrast reserve 10:1 for fluent reading, 4:1 for 88 wpm, 3:1 for spot reading. [S]
17. Target x-height angle:
    - `θx = max(5·10^L·R, 12′)` (12′ is the 0.2° floor).
    - Hebrew: multiply by 1.12.
    - If a reliable reading test exists: `θx = max(12′, 5·10^(CPS+0.1))`. [S/D]
18. Physical size: `x_mm = 2·d·tan(θx/2)`; `fs_px = x_mm / xr / mmPerCss`. Never go below the platform default (iOS 17 pt; Android 16 sp). [D]
19. x-height ratio `xr`: SF 0.508, Roboto 0.528, Arial 0.519, Helvetica 0.523, Segoe UI 0.500, Noto Sans 0.536. Hebrew body height: Noto Sans Hebrew 0.584, Heebo 0.575, Rubik 0.571, Assistant 0.545. Prefer measuring at runtime with `measureText('ה'/'x').actualBoundingBoxAscent`. [V/D]
20. Sanity checks: iOS 17 pt body gives a 0.234° x-height at 35 cm, about newspaper size (0.23°). Legge & Bigelow: critical print size 0.2°, fluent range 0.2–2°. MNREAD CPS by age: 0.08 (8–23 y), 0.21 (68 y), 0.34 (81 y) logMAR. [V/S]
21. Reading test: print sizes in 0.1-log steps. Fit `RS = MRS·(1 − e^(−(p−p0)/τ))`; `CPS = p0 + τ·ln 5` (the 80%-of-MRS point). Switch polarity only if it is more than 15% faster. [S/D]

**Contrast**
22. Tumbling E, 2.8° tall. Weber contrast in linear light; `logCS = −log10 C`.
    - QUEST: γ = 0.25, λ = 0.03, **β = 3.5**, grid −2.5 to 0.0, prior mean −1.7 (SD 0.5).
    - 24 trials. Triplet method (if used): 0.15-log steps, and require 3/3 correct with 4AFC (2/3 gives a 15.6% guess-pass rate). [S/D]
23. Bit-stealing is required:
    - A 254-on-255 grey step is already logCS **2.05**; 253 gives 1.75.
    - Single-channel steps near white: B = 3.19, R = 2.72, G = 2.20 (using Y = 0.2126R + 0.7152G + 0.0722B). [V]
24. Provisional lower limits of normal: **1.65** (age < 60), **1.50** (age ≥ 60). Re-derive from pilot data, because digital tests read 0.1–0.3 higher than the Pelli–Robson chart (iPad 1.98 vs PR 1.65). A change counts if ≥ 0.30. [S/D]
25. UI tiers by logCS:
    - **≥ 1.65**: contrast ≥ 4.5:1 (app default 7:1).
    - **1.35–1.64**: ≥ 7:1, weight 500–600, +1 size step.
    - **1.00–1.34**: ≥ 12:1, bold, +2 steps.
    - **< 1.00**: 21:1, bold, +3 steps.
    - Default to positive polarity (dark text on light background). Dark mode uses `#121212` background with `#E6E6E6` text. [D]

**Astigmatism**
26. Dial: 12 spokes at 15° intervals, 3 lines per spoke, lines 1.5′ wide with 1.5′ gaps, spokes 5° long. Show 3 randomised rotations. "Consistent" means ≥ 2 of 3 answers within ±15°.
    - Axis (internal only) = `30° × lower clock hour` (6 o'clock → 180°).
    - Never display a cylinder value. [S/D]

**Colour**
27. sRGB decode: `c ≤ 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`. Encode: `c ≤ 0.0031308 ? 12.92c : 1.055c^(1/2.4) − 0.055`. XYZ matrix as in §7.1. [V]
28. Colour-space matrices `LMS_from_linearRGB` and `linearRGB_from_LMS` exactly as in §7.3 (Smith–Pokorny cone fundamentals with sRGB primaries). [V]
29. Test stimulus (CCT-like):
    - Disc mosaic with a 4AFC C-gap, 5° wide.
    - Luminance noise: 6 levels, ±20%.
    - Neutral grey: linear 0.20 (sRGB about 124).
    - Cone-isolating displacement `LMS·(1 + c·e_k)`.
    - 3 interleaved Bayesian staircases, 16 trials each.
    - One 8-bit step is about 8–12×10⁻⁴ u′v′; CCT normal limits are 100/100/150×10⁻⁴. [S/V/D]
30. Classification (P, D, T = threshold on each axis ÷ normal limit):
    - Normal: all ≤ 1.
    - Red–green deficiency: max(P, D) > 1 and T ≤ 1.5. Protan if P/D ≥ 1.25; deutan if D/P ≥ 1.25.
    - Tritan: T > 1.5 and P, D ≤ 1.5 (red flag).
    - Severity: `s = clamp(ln X / ln Xceil, 0, 1)`. [D]
31. Machado 2009 simulation matrices (§7.4), exact, in linear RGB. Interpolate linearly between the 0.1 severity steps. [V]
32. Brettel 1997 (use for tritan) and Viénot 1999 (protan/deutan) matrices from libDaltonLens (§7.5). [V]
33. Daltonise: `out = rgb + k·E·(rgb − S·rgb)` with `E = [[0,0,0],[0.7,1,0],[0.7,0,1]]`. For tritan use `[[1,0,0.7],[0,1,0.7],[0,0,0]]` (this is D). User strength `k` from 0 to 1. [V/D]

**Focus range**
34. Hofstetter amplitude (D): minimum `15 − 0.25A`; mean `18.5 − 0.30A`; maximum `25 − 0.40A`. These overestimate real amplitude, so flag against the minimum. [S]
35. Near point: constant-angle target at `max(L+0.2, 0.3)` logMAR, moved ≤ 3 cm/s. Take the median of 3 runs.
    - `Amp = 1000/d_np − 1000/d_fp`.
    - Camera floor 150 mm, so the maximum measurable amplitude is 6.7 D. [D]
36. Far point: constant-angle target at logMAR 0.1. Measurable if `d_fp ≤ 650 mm`.
    - `SE ≈ −1000/d_fp` D is **internal only**. Literature accuracy: bias 0.17 D, limits of agreement about ±0.9 D. [S/D]
37. Comfortable near distance: `d_min_comfort = 2000/Amp` mm (half-amplitude rule, U).
    - Recommended distance: `d_rec = clamp(max(d_hab, d_min_comfort), 250, min(d_fp, 600))`.
    - Recompute text size at `d_rec`. Retest acuity if `d_rec` differs from the test distance by more than 15%. [D]

**Enhancement**
38. Cutoff frequency `f_c = 30/10^L` c/deg.
    - Pixels per degree: `ppd = d·tan(1°)/mmPerDev` (iPhone 15: about 95 at 30 cm, about 126 at 40 cm).
    - Enhancement centre `f0 = 0.35·f_c`.
    - Filter widths: `σ1 = ppd/(2π f0)`, `σ2 = 2σ1`. [D]
39. `Y′out = clamp(Y′ + k·(G_σ1 − G_σ2)*Y′ · (Ȳ/max(G_σ2*Y′, 0.05))^0.5, 0, 1)` on luma only. [D]
40. Enhancement gain `k = clamp(1.25·(1.80 − logCS), 0, 1.5)`, then refined with a 6-step preference staircase. [D, informed by Fullerton 2007]
41. Contour (wideband) mode when `L ≥ 0.7` or `logCS < 1.0`: Laplacian-of-Gaussian edges at σ1, opacity 0.3–0.7. Live-camera CLAHE: clip limit 2.0, 8×8 tiles. [D]
42. Magnification `M = 10^((L + log10 R) − L_detail)`. Cap in-app zoom at 8×; beyond that use OS Zoom (iOS up to 15×) or Magnifier. [D]

**System settings**
43. iOS Body size (pt) per Larger Text step:
    - Standard: xS 14, S 15, M 16, **L 17 (default)**, xL 19, xxL 21, xxxL 23.
    - Accessibility sizes: AX1 28, AX2 33, AX3 40, AX4 47, AX5 53.
    - Choose the smallest step ≥ `fs_px` (1 pt = 1 px_css). [V]
44. Android font scale: 0.85, 1.0, 1.15, 1.30, 1.50, 1.80, 2.0.
    - Resulting dp for 16 sp text: 13.6, 16.0, 18.1, 20.2, 23.0, 26.0, 28.0.
    - Resulting dp for 14 sp text: 11.9, 14.0, 16.4, 18.8, 22.0, 24.4, 26.0. (Non-linear above 1.0.)
    - Choose the smallest step ≥ `fs_px`. If it is still too small, increase Display size, then use Magnification. [V]
45. Bold Text / Bold text / Bold font when `logCS < 1.65` or `L ≥ 0.3`. Android implements bold as a +300 font-weight adjustment. [V/D]
46. Contrast settings:
    - `logCS < 1.65`: iOS Increase Contrast; Android Color contrast = Medium.
    - `logCS < 1.35`: Android Color contrast = High plus High contrast text / Outline text; Samsung High contrast fonts. [V/D]
47. Colour vision deficiency mapping:
    - Protan: iOS Red/Green (Protanopia); Android "Red-green, red weak".
    - Deutan: iOS Green/Red (Deuteranopia); Android "Red-green, green weak".
    - Tritan: Blue/Yellow.
    - Intensity = `round(100·s)`%. Opt-in only. [S/V/D]
48. Zoom and Magnifier when `L ≥ 0.7` or the needed size exceeds AX5 / scale 2.0. Reduce White Point (25–100%) and Extra dim are driven by symptoms only, never by test scores. [S/D]
49. Settings we can detect from the web: `font: -apple-system-body` (iOS Dynamic Type), `env(preferred-text-scale)` (Chrome 138+), `<meta name="text-scale" content="scale">` (Chrome 139+), `prefers-contrast`. Everything else must be confirmed by the user. [S/U]
50. Menu paths come from the §12 tables. Keep them in a server-side, versioned table and re-verify at each major OS release (Android 17 reorganised the menus). [D]

**Red flags** (all must be confirmed by a retest; see §13)
51. Emergency symptom checklist before every session: sudden vision loss, curtain or shadow, flashes or floaters, painful red eye, halos with pain, new double vision → **EMERGENCY**. [U]
52. Monocular acuity:
    - `L > 0.30` → ROUTINE.
    - `L > 0.50` → SOON.
    - `L > 1.0` and new → SOON/URGENT.
    - Presbyopia exception (R3a) for age ≥ 45 tested without readers. [S/D]
53. Difference between eyes ≥ 0.20 → ROUTINE (SOON if either eye is worse than 0.30). Worsening from baseline ≥ 0.20 → SOON (URGENT if the change was rapid). [S/D]
54. Contrast sensitivity below the provisional lower limit (1.65 / 1.50), or a drop ≥ 0.30 → ROUTINE; `logCS < 1.0` → SOON. [S/D]
55. Colour: tritan pattern, difference between eyes, generalised loss, or change → SOON. Symmetric red–green loss → INFO only. [U/D]
56. Near point: amplitude below `(15 − 0.25A) − 2` D at age < 40 → ROUTINE. Consistent astigmatism dial result → ROUTINE. Measurable far point without glasses → ROUTINE. Two unreliable tests in a row → ROUTINE. [D]
57. Amsler grid: **out of scope**. If it is ever reinstated, new distortion → URGENT (NICE NG82: within 1 working day). [S]
58. Exam-interval reminder per AAO: under 40 every 5–10 years; 40–54 every 2–4; 55–64 every 1–3; 65+ every 1–2. [S]
59. Always show: "This is not an eye examination; a normal result doesn't rule out eye disease." [D]

**User-facing results** (manager decision: no clinical notation in the default UI)
60. **"Screen detail" score (0–100, per eye and binocular)**, computed from the internal logMAR `L` measured at the user's habitual distance with their usual correction:
    ```
    screenDetail = clamp( round( 100 · (1.0 − L) / 1.2 ), 0, 100 )
    ```
    - Anchors: L −0.2 → 100; 0.0 → 83; 0.1 → 75; 0.2 → 67; 0.3 → 58; 0.5 → 42; 0.7 → 25; 1.0 → 0.
    - The mapping is linear in logMAR, so each letter-equivalent (0.02) is about 1.7 points.
    - Ceiling-limited results show "83+" or "100".
    - Because the scale is linear in logMAR, test–retest noise of ±0.15–0.20 logMAR equals **±13–17 points**. **Never present a change of less than 15 points as real.**
    - The red-flag cutoff `L > 0.30` corresponds to a score **< 58**. [D]
61. Plain-language bands for the score:
    - **83–100:** "You see fine screen detail well."
    - **67–82:** "Good. Slightly larger text may feel more comfortable."
    - **50–66:** "Fine detail is harder for you. We've enlarged text."
    - **25–49:** "Small text is difficult. We've enlarged and strengthened text."
    - **0–24:** "Screen detail is hard to see. Magnification tools are recommended."

    Contrast and colour findings are plain-language too. Examples: "Low-contrast text is harder for you than for most people your age"; "You may confuse some reds and greens".
    The recommended text size is shown as a preview ("this size"), plus the OS setting name to apply. [D]
62. Clinical notation (logMAR, Snellen, decimal, log CS, dioptres) is stored internally. It is shown **only** in an optional "share with your eye-care professional" export, with the test distance, correction and device noted. [D]
63. RTL: all stimuli are drawn in a `direction:ltr` container and never mirrored. Response directions refer to the physical screen. [D]

---

## PRODUCT CLAIMS: allowed vs not allowed

The claims specific to "vision-correcting display" are in §11.3. The table below covers every other area. Regulatory note [U]: software whose intended purpose is to screen for, diagnose or monitor disease can be a medical device (EU MDR Rule 11; US FDA; Israel AMAR). Visual-acuity and refraction apps have been regulated as devices. The claims below are written for a **non-diagnostic, screen-personalisation** intended purpose. Legal and regulatory must confirm them against `business-legal-payments.md` before launch.

| Area | ✅ Allowed (with the stated conditions) | ❌ Not allowed |
|---|---|---|
| Purpose | "Personalise your phone's display to how you see." "Find the text size, weight, contrast and colour settings that work for you." | "Eye test", "eye exam", "vision screening for eye disease", "diagnose", "detect [disease]", "monitor your [condition]" |
| Acuity result | "Screen detail score" (0–100); "your recommended text size at your usual distance" | Snellen, logMAR or decimal in the default UI (manager decision); "your visual acuity is 20/20"; "your vision is normal" |
| Refraction | "Text looks sharpest for you between X and Y cm" (focus range) | Any prescription, dioptre, sphere, cylinder, axis or "reading-glasses strength"; "no need for an optometrist" |
| Astigmatism dial | "Lines in one direction looked clearer to you. An eye exam can check whether glasses would help." | "You have astigmatism of X", "axis X", "measures astigmatism" |
| Contrast | "Low-contrast text is harder for you; we've increased contrast and weight." | "Detects cataract / glaucoma"; "contrast sensitivity test" as a clinical claim |
| Colour | "You may confuse some colours (red–green / blue–yellow). These settings may make colours easier to tell apart." | "Diagnoses colour blindness", "certifies colour vision" (for jobs, driving, aviation), "restores / cures colour vision", "see colours like everyone else" |
| Enhancement | "Enhancement can make details in photos, video and the camera view easier to see for some people." | "Improves your eyesight", "restores sharpness", "clinically proven to improve vision" (unless we run and publish a trial) |
| Correction | See §11.3 | "Corrects your vision", "replaces glasses", "glasses-free screen" |
| Red-flag messages | "Some results suggest you should see an eye-care professional (within [timeframe])." "This is not an eye examination; a normal result doesn't rule out eye disease." | "You have [disease]"; "your eyes are healthy"; "no need to see a doctor" |
| Accuracy | "Our tests are based on published methods (e.g., adaptive tumbling-E, Pelli–Robson principles)." After our own validation study: "agreed with clinic measurements within X in our study of N people." | "Clinically validated", "as accurate as a doctor", "medical-grade", before a published validation exists |
| Amsler grid | *(Out of scope; no claims.)* | Any macular-degeneration screening or monitoring claim |
| Privacy (engineering fact) | "Camera images are processed on your device and are not uploaded." (Only if true in the build.) | Any privacy claim the implementation does not enforce |

*End of document.*
