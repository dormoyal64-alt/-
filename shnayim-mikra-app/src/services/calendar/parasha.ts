/**
 * Computes the "shnayim mikra" week context for a given date: which
 * parasha (or combined parashot) is assigned to that Hebrew-calendar week
 * under the annual reading cycle, for Israel or the Diaspora.
 *
 * This intentionally uses @hebcal/core's `Sedra` class, which already knows
 * how to correctly combine/split parashot around holidays, leap years, and
 * the Israel/Diaspora divergence — none of that is re-derived or guessed
 * here. When a Shabbat's public Torah reading is fully replaced by a
 * holiday reading (`chag: true`), there is genuinely no new annual-cycle
 * parasha that week; the app surfaces that plainly instead of inventing one.
 */
import { HDate, getSedra, type SedraResult } from '@hebcal/core';
import type { Country, ParashaInfo, SpecialWeekReason, WeekReadingContext, IsoDate } from '@/types';
import { getHebrewDateInfo, isoDateToJsDate, jsDateToIsoDate } from './hebrewCalendar';

const PARSHA_HE_NAMES: Record<string, string> = {
  Bereshit: 'בראשית',
  Noach: 'נח',
  'Lech-Lecha': 'לך לך',
  Vayera: 'וירא',
  'Chayei Sara': 'חיי שרה',
  Toldot: 'תולדות',
  Vayetzei: 'ויצא',
  Vayishlach: 'וישלח',
  Vayeshev: 'וישב',
  Miketz: 'מקץ',
  Vayigash: 'ויגש',
  Vayechi: 'ויחי',
  Shemot: 'שמות',
  Vaera: 'וארא',
  Bo: 'בא',
  Beshalach: 'בשלח',
  Yitro: 'יתרו',
  Mishpatim: 'משפטים',
  Terumah: 'תרומה',
  Tetzaveh: 'תצוה',
  'Ki Tisa': 'כי תשא',
  Vayakhel: 'ויקהל',
  Pekudei: 'פקודי',
  Vayikra: 'ויקרא',
  Tzav: 'צו',
  Shmini: 'שמיני',
  Tazria: 'תזריע',
  Metzora: 'מצורע',
  'Achrei Mot': 'אחרי מות',
  Kedoshim: 'קדושים',
  Emor: 'אמור',
  Behar: 'בהר',
  Bechukotai: 'בחוקותי',
  Bamidbar: 'במדבר',
  Nasso: 'נשא',
  "Beha'alotcha": 'בהעלותך',
  "Sh'lach": 'שלח',
  Korach: 'קרח',
  Chukat: 'חוקת',
  Balak: 'בלק',
  Pinchas: 'פנחס',
  Matot: 'מטות',
  Masei: 'מסעי',
  Devarim: 'דברים',
  Vaetchanan: 'ואתחנן',
  Eikev: 'עקב',
  "Re'eh": 'ראה',
  Shoftim: 'שופטים',
  'Ki Teitzei': 'כי תצא',
  'Ki Tavo': 'כי תבוא',
  Nitzavim: 'ניצבים',
  Vayeilech: 'וילך',
  "Ha'azinu": 'האזינו',
  'Vezot Haberakhah': 'וזאת הברכה',
};

export function parshaNameHe(id: string): string {
  return PARSHA_HE_NAMES[id] ?? id;
}

function buildParashaInfo(ids: string[], nums: number[]): ParashaInfo {
  const namesHe = ids.map(parshaNameHe);
  return {
    ids,
    namesHe,
    displayNameHe: namesHe.join('-'),
    parshaNum: nums,
  };
}

function toNums(num: number | number[]): number[] {
  return Array.isArray(num) ? num : [num];
}

/**
 * Given any date, returns the shnayim-mikra week context: the Shabbat that
 * anchors the week containing `date`, and the parasha (or holiday override)
 * assigned to that week.
 */
export function getWeekReadingContext(date: IsoDate, country: Country): WeekReadingContext {
  const il = country === 'IL';
  const jsDate = isoDateToJsDate(date);
  const hd = new HDate(jsDate);
  const sedra = getSedra(hd.getFullYear(), il);
  const result: SedraResult = sedra.lookup(hd);

  const shabbatIso = jsDateToIsoDate(result.hdate.greg());
  const hebrewDateShabbat = getHebrewDateInfo(shabbatIso).displayHe;

  if (result.chag) {
    const holidayName = result.parsha[0];
    const reason: SpecialWeekReason = 'yomtov-shabbat-no-regular-torah-reading';
    return {
      shabbatDate: shabbatIso,
      hebrewDateShabbat,
      parasha: null,
      country,
      hasRegularParasha: false,
      specialReason: reason,
      note:
        `השבת הזו (${hebrewDateShabbat}) חלה על "${holidayName}" ואין באותו שבוע פרשה חדשה מסבב הקריאה השנתי. ` +
        `לכן אין השלמה של שניים מקרא ואחד תרגום לשבוע הזה — הפרשה הקודמת כבר הושלמה. בדוק מול מקור הלכתי מוסמך אם יש לך ספק.`,
    };
  }

  const parasha = buildParashaInfo(result.parsha, toNums(result.num));
  return {
    shabbatDate: shabbatIso,
    hebrewDateShabbat,
    parasha,
    country,
    hasRegularParasha: true,
    specialReason: 'none',
  };
}
