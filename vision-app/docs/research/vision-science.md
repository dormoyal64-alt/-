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
  - Present acuity to users in 0.1-step categories (for example "about 6/9"), with the exact value available in details.

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
