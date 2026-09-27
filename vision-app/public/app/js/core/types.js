// @ts-check
/**
 * SHARED CONTRACTS — the single source of truth for data shapes exchanged between modules.
 * Owned by the manager. Agents must not change existing fields; propose additions to the manager.
 * This file contains only JSDoc typedefs (no runtime code except the exported constants below).
 */

/** @typedef {'he'|'en'} Lang */
/** @typedef {'right'|'left'|'both'} Eye */

/**
 * Physical screen calibration.
 * @typedef {Object} ScreenCalibration
 * @property {number} cssPxPerMm        CSS pixels per physical millimetre on this screen.
 * @property {number} dpr               window.devicePixelRatio at calibration time.
 * @property {'card'|'ruler'|'default'} method
 * @property {number} screenWidthCssPx  screen.width at calibration time (portrait/landscape as measured).
 * @property {number} screenHeightCssPx screen.height at calibration time.
 * @property {string} measuredAt        ISO-8601 timestamp.
 */

/**
 * Viewing distance calibration (eye to screen).
 * @typedef {Object} DistanceCalibration
 * @property {number} distanceMm        Typical eye-to-screen viewing distance in mm used for the tests.
 * @property {'blindspot'|'camera'|'manual'} method
 * @property {number} [focalLengthPx]   Front-camera focal length in video pixels (width-normalised to 640 px), if calibrated.
 * @property {string} measuredAt
 */

/**
 * Live distance measurement via the front camera. Created by calibration/distance-tracker.js.
 * @typedef {Object} DistanceTracker
 * @property {() => (number|null)} current                       Latest smoothed distance in mm, or null (no face / not ready).
 * @property {(cb: (mm: number|null) => void) => (() => void)} subscribe  Returns an unsubscribe function.
 * @property {() => void} stop                                    Stops the camera and releases all resources.
 */

/**
 * Context passed to every interactive test/calibration view.
 * @typedef {Object} TestContext
 * @property {Lang} lang
 * @property {ScreenCalibration} [screen]
 * @property {DistanceCalibration} [distance]
 * @property {Eye} [eye]                              Eye under test (monocular tests).
 * @property {AbortSignal} [signal]                   Abort => view cleans up and rejects with an AbortError DOMException.
 * @property {DistanceTracker|null} [distanceTracker] Optional live distance; when present, size stimuli using current().
 * @property {(fraction: number) => void} [onProgress] Progress 0..1 for the shell's progress bar.
 * @property {number} [age]
 */

/**
 * @typedef {Object} AcuityResult
 * @property {Eye} eye
 * @property {number} logMAR        Final estimate at distanceMm (lower is better; 0 = 6/6).
 * @property {number} decimal       10^-logMAR
 * @property {string} snellen6      e.g. "6/12"
 * @property {string} snellen20     e.g. "20/40"
 * @property {number} distanceMm    Distance the result refers to.
 * @property {boolean} reliable     False when the response pattern was inconsistent.
 * @property {boolean} floorLimited True when the user resolved the smallest renderable size (true acuity may be better).
 * @property {number} trials
 * @property {number} durationMs
 */

/**
 * @typedef {Object} ReadingResult
 * @property {number} criticalPrintSizeLogMAR  Smallest print size read at (near) maximum speed, logMAR at distanceMm.
 * @property {number} readingAcuityLogMAR      Smallest print size read at all.
 * @property {number} maxReadingSpeedWpm
 * @property {number} distanceMm
 * @property {boolean} reliable
 */

/**
 * @typedef {Object} ContrastResult
 * @property {Eye} eye
 * @property {number} logCS        Log contrast sensitivity (Pelli-Robson-like scale).
 * @property {boolean} reliable
 */

/**
 * @typedef {Object} ColorResult
 * @property {'normal'|'protan'|'deutan'|'tritan'|'unclassified'} type
 * @property {number} severity     0 (none) .. 1 (dichromat-like)
 * @property {number} confidence   0..1
 * @property {boolean} reliable
 */

/**
 * @typedef {Object} AstigmatismResult
 * @property {Eye} eye
 * @property {boolean} suspected
 * @property {number|null} axisDeg  0..180 estimated axis, or null.
 */

/**
 * @typedef {Object} AmslerResult
 * @property {Eye} eye
 * @property {boolean} abnormal
 * @property {Array<'wavy'|'missing'|'blurry'|'dark'>} findings
 */

/**
 * @typedef {Object} FocusRangeResult
 * @property {Eye} eye
 * @property {number|null} nearPointMm  Closest distance at which text stays sharp, or null if not measured.
 * @property {number|null} farPointMm   Farthest distance at which small text stays sharp, null = beyond measurable range.
 */

/**
 * Optional prescription typed in by the user from an eye-care professional (informational).
 * @typedef {Object} Rx
 * @property {number} [sph]
 * @property {number} [cyl]
 * @property {number} [axis]
 * @property {number} [add]
 */

/**
 * Everything the profile engine needs.
 * @typedef {Object} ProfileInput
 * @property {ScreenCalibration} screen
 * @property {DistanceCalibration} distance
 * @property {number} [age]
 * @property {boolean} [wearsCorrection]   Tests were done with the glasses/lenses the user wears for the phone.
 * @property {{right?: Rx, left?: Rx}} [rx]
 * @property {{right?: AcuityResult, left?: AcuityResult, both?: AcuityResult}} acuity
 * @property {ReadingResult} [reading]
 * @property {ContrastResult} [contrast]
 * @property {ColorResult} [color]
 * @property {{right?: AstigmatismResult, left?: AstigmatismResult}} [astigmatism]
 * @property {{right?: AmslerResult, left?: AmslerResult}} [amsler]
 * @property {FocusRangeResult} [focus]
 * @property {{theme?: 'light'|'dark'|'auto', lightSensitivity?: 'low'|'normal'|'high'}} [prefs]
 */

/**
 * Rendering parameters for images / video / live camera / UI. Consumed by render/*.
 * @typedef {Object} FilterParams
 * @property {number[]} colorMatrix   3x3 row-major matrix applied in LINEAR RGB. Identity = [1,0,0, 0,1,0, 0,0,1].
 * @property {number} contrast        1 = unchanged. Applied around mid-grey (0.5) in sRGB space.
 * @property {number} brightness      1 = unchanged (multiplier in sRGB space).
 * @property {number} saturation      1 = unchanged.
 * @property {number} sharpenAmount   0 = off. Unsharp-mask gain (band-pass enhancement).
 * @property {number} sharpenSigmaPx  Gaussian sigma of the unsharp mask, in CSS px at zoom 1.
 * @property {number} zoom            1 = no magnification.
 * @property {boolean} invert         Polarity reversal (light-on-dark).
 * @property {number} warmth          0..1, reduces short-wavelength (blue) light.
 */

/**
 * Typography recommendation for the user at their viewing distance.
 * @typedef {Object} TextParams
 * @property {number} baseFontPx      Recommended body text size in CSS px.
 * @property {number} scale           baseFontPx / 16.
 * @property {number} fontWeight      400..700
 * @property {number} lineHeight      unitless
 * @property {number} letterSpacingEm
 * @property {number} wordSpacingEm
 */

/**
 * Platform-neutral targets that system-guide.js maps onto concrete OS menus/values.
 * @typedef {Object} SystemSettingsTarget
 * @property {number} textScale              Relative to the platform default text size (1 = default).
 * @property {boolean} boldText
 * @property {boolean} increaseContrast
 * @property {null|{type: 'protan'|'deutan'|'tritan', intensity: number}} colorFilter  intensity 0..1
 * @property {boolean} reduceWhitePoint
 * @property {boolean} darkMode
 * @property {number} displayZoom            1 = default "Display size"/"Display Zoom"; >1 = larger.
 * @property {boolean} magnificationShortcut
 */

/**
 * @typedef {Object} ProfileFlag
 * @property {'info'|'recommend'|'urgent'} level
 * @property {string} code   Stable machine code, e.g. 'LOW_ACUITY_RIGHT', 'AMSLER_ABNORMAL_LEFT'.
 * @property {Object<string, (string|number)>} [params]  Values for message interpolation.
 */

/**
 * The personal vision profile. Stored on-device only.
 * @typedef {Object} VisionProfile
 * @property {1} version
 * @property {string} id
 * @property {string} name          Display name, e.g. "Me", "Mom".
 * @property {string} createdAt     ISO-8601
 * @property {string} updatedAt     ISO-8601
 * @property {ProfileInput} input   Raw measurements (kept for re-computation).
 * @property {TextParams} text
 * @property {FilterParams} media   For photos / video / live camera (stronger).
 * @property {FilterParams} ui      For the app UI itself (milder, readability-first).
 * @property {SystemSettingsTarget} system
 * @property {ProfileFlag[]} flags
 * @property {{recommendedDistanceMm: (number|null)}} viewing
 */

/**
 * One section of the system-wide settings guide.
 * @typedef {Object} GuideSection
 * @property {string} id            Stable id, e.g. 'text-size'.
 * @property {string} title
 * @property {string} why           One-sentence reason tied to the user's results.
 * @property {string[]} steps       Ordered, concrete menu steps.
 * @property {string} [value]       The exact value to set, e.g. "Step 5 of 7 (xxLarge)".
 * @property {boolean} recommended  False => optional / informational.
 */

/** @typedef {'ios'|'ipados'|'android'|'samsung'|'desktop'|'other'} Platform */

/** Identity 3x3 matrix (row-major). */
export const IDENTITY3 = Object.freeze([1, 0, 0, 0, 1, 0, 0, 0, 1]);

/** @returns {FilterParams} neutral parameters (no change). */
export function neutralFilterParams() {
  return {
    colorMatrix: [...IDENTITY3],
    contrast: 1,
    brightness: 1,
    saturation: 1,
    sharpenAmount: 0,
    sharpenSigmaPx: 1,
    zoom: 1,
    invert: false,
    warmth: 0,
  };
}

/** Default reference: 1 CSS inch = 96 CSS px (used only when no calibration exists). */
export const DEFAULT_CSS_PX_PER_MM = 96 / 25.4;
