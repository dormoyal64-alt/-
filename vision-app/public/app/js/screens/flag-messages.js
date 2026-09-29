// @ts-check
/**
 * Plain-language messages for engine ProfileFlag codes (functional wording, no disease names).
 * If the engine exports its own describer (describeFlag / flagMessage), results.js prefers it.
 * Codes may end with _RIGHT / _LEFT / _BOTH; unknown codes fall back to a message per level.
 */
import { makeT } from '../core/i18n.js';

/** @typedef {import('../core/types.js').ProfileFlag} ProfileFlag */
/** @typedef {import('../core/types.js').Lang} Lang */

const STRINGS = {
  he: {
    eyeRight: 'בעין ימין',
    eyeLeft: 'בעין שמאל',
    eyeBoth: 'בשתי העיניים',
    LOW_ACUITY: 'פרטים קטנים על המסך נראו פחות ברורים {eye}.',
    ACUITY_DIFFERENCE: 'יש הבדל ניכר בין שתי העיניים בראיית פרטים קטנים.',
    NEAR_ACUITY_REDUCED: 'טקסט קטן מקרוב נראה פחות ברור.',
    READING_REDUCED: 'קריאה של טקסט קטן הייתה פחות נוחה.',
    LOW_CONTRAST: 'טקסט דהוי (בניגודיות נמוכה) היה קשה יותר לראות.',
    CONTRAST_REDUCED: 'טקסט דהוי (בניגודיות נמוכה) היה קשה יותר לראות.',
    COLOR_DIFFICULTY: 'חלק מהצבעים היו קשים יותר להבחנה.',
    COLOR_DEFICIENCY: 'חלק מהצבעים היו קשים יותר להבחנה.',
    LINES_UNEVEN: 'קווים בכיוונים מסוימים נראו פחות חדים {eye}.',
    ASTIGMATISM_SUSPECTED: 'קווים בכיוונים מסוימים נראו פחות חדים {eye}.',
    FOCUS_RANGE_LIMITED: 'טווח המרחקים שבו טקסט נשאר חד הוא מצומצם.',
    UNRELIABLE: 'חלק מהתשובות לא היו עקביות, ולכן התוצאות פחות ודאיות. כדאי לחזור על הבדיקה בתנאי תאורה טובים.',
    DEFAULT_CALIBRATION: 'הבדיקה נעשתה בלי כיול מלא של המסך או המרחק, ולכן התוצאות משוערות.',
    'level.info': 'הערה לגבי התוצאות שלכם.',
    'level.recommend': 'חלק מהתוצאות שונות מהמצופה.',
    'level.urgent': 'חלק מהתוצאות דורשות תשומת לב.',
    'advice.recommend': 'מומלץ לקבוע בדיקת עיניים אצל אופטומטריסט או רופא עיניים.',
    'advice.urgent': 'מומלץ לפנות בהקדם לרופא עיניים. אם הראייה השתנתה פתאום, פנו לטיפול עוד היום.',
  },
  en: {
    eyeRight: 'in your right eye',
    eyeLeft: 'in your left eye',
    eyeBoth: 'in both eyes',
    LOW_ACUITY: 'Small details on the screen looked less clear {eye}.',
    ACUITY_DIFFERENCE: 'There is a noticeable difference between your two eyes in seeing small details.',
    NEAR_ACUITY_REDUCED: 'Small text up close looked less clear.',
    READING_REDUCED: 'Reading small text was less comfortable.',
    LOW_CONTRAST: 'Faint (low-contrast) text was harder to see.',
    CONTRAST_REDUCED: 'Faint (low-contrast) text was harder to see.',
    COLOR_DIFFICULTY: 'Some colours were harder to tell apart.',
    COLOR_DEFICIENCY: 'Some colours were harder to tell apart.',
    LINES_UNEVEN: 'Lines in some directions looked less sharp {eye}.',
    ASTIGMATISM_SUSPECTED: 'Lines in some directions looked less sharp {eye}.',
    FOCUS_RANGE_LIMITED: 'The range of distances where text stays sharp is narrow.',
    UNRELIABLE: 'Some answers were inconsistent, so the results are less certain. Consider repeating the check in good lighting.',
    DEFAULT_CALIBRATION: 'The check ran without full screen or distance calibration, so results are approximate.',
    'level.info': 'A note about your results.',
    'level.recommend': 'Some of your results are different from what we expect.',
    'level.urgent': 'Some of your results need attention.',
    'advice.recommend': 'We recommend an eye exam with an optometrist or ophthalmologist.',
    'advice.urgent': 'Please see an eye doctor soon. If your vision changed suddenly, get care today.',
  },
};

/**
 * @param {ProfileFlag} flag @param {Lang} lang
 * @returns {{level: ProfileFlag['level'], text: string, advice: string|null, known: boolean}}
 */
export function describeFlag(flag, lang) {
  const t = makeT(STRINGS, lang);
  const code = String(flag?.code || '');
  const m = /^(.*?)(?:_(RIGHT|LEFT|BOTH))?$/.exec(code);
  const base = m?.[1] || code;
  const eyeKey = m?.[2] === 'RIGHT' ? 'eyeRight' : m?.[2] === 'LEFT' ? 'eyeLeft' : m?.[2] === 'BOTH' ? 'eyeBoth' : null;
  const params = { ...(flag?.params || {}), eye: eyeKey ? t(eyeKey) : '' };
  const known = Object.prototype.hasOwnProperty.call(STRINGS.en, base) && !base.startsWith('level.') && !base.startsWith('advice.');
  const level = flag?.level === 'urgent' || flag?.level === 'recommend' ? flag.level : 'info';
  const text = (known ? t(base, params) : t(`level.${level}`)).replace(/\s+\./g, '.').replace(/\s{2,}/g, ' ').trim();
  const advice = level === 'info' ? null : t(`advice.${level}`);
  return { level, text, advice, known };
}
