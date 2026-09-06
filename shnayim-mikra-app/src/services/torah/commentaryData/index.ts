/**
 * Original, short, plain-language explanations ("הסבר קצר"), written for
 * this app — NOT copied from any copyrighted commentary. Keyed by parasha
 * id (as used by @hebcal) and aliyah number (1-7).
 *
 * Coverage is intentionally incremental: content is data (JSON-like modules
 * under this folder), not code, so adding a parasha never requires touching
 * the reading engine or screens. See README "מקורות ותוכן" for the current
 * coverage status and how to extend it.
 */
import type { CommentaryEntry } from '@/types';

export interface AliyahCommentarySource {
  aliyah: number;
  text: string;
}

const DATA: Record<string, AliyahCommentarySource[]> = {
  Bereshit: [
    { aliyah: 1, text: 'בריאת העולם בשישה ימים, וביום השביעי שבת ה׳ ממלאכתו — זהו יסוד מנוחת השבת.' },
    { aliyah: 2, text: 'תיאור נוסף של בריאת האדם והאישה, ותיאור גן עדן והנהרות היוצאים ממנו.' },
    { aliyah: 3, text: 'האדם והאישה מצטווים שלא לאכול מעץ הדעת; הנחש מפתה את האישה, והם חוטאים ונענשים.' },
    { aliyah: 4, text: 'קין והבל מביאים קורבנות; קין מקנא והורג את אחיו, ונענש בנדודים.' },
    { aliyah: 5, text: 'רשימת צאצאי קין ותחילת התרבות האנושית — מלאכה, מוזיקה ומתכת.' },
    { aliyah: 6, text: 'שלשלת הדורות מאדם ועד נח, המונה את שנות חייהם הארוכות.' },
    { aliyah: 7, text: 'העולם מתמלא חמס, ונח מוצא חן בעיני ה׳ — פתיחה לסיפור המבול.' },
  ],
  Noach: [
    { aliyah: 1, text: 'ה׳ מצווה את נח לבנות תיבה מפני המבול הקרב, ומפרט את מידותיה.' },
    { aliyah: 2, text: 'נח מכניס לתיבה את בני משפחתו ואת בעלי החיים, כפי שנצטווה.' },
    { aliyah: 3, text: 'המבול מציף את הארץ ומכלה כל חי מחוצה לתיבה.' },
    { aliyah: 4, text: 'המים מתחילים לשכוך, והתיבה נחה על הרי אררט.' },
    { aliyah: 5, text: 'נח יוצא מהתיבה, מקריב קורבן, וה׳ מבטיח שלא להביא עוד מבול — קשת בענן כאות.' },
    { aliyah: 6, text: 'סיפור נח וכרם היין, ותוכחת בניו; רשימת צאצאי בני נח ופיזורם.' },
    { aliyah: 7, text: 'סיפור מגדל בבל ובלבול הלשונות, ושלשלת הדורות עד אברהם.' },
  ],
  Nitzavim: [
    {
      aliyah: 1,
      text: 'משה מעמיד את כל העם — מגדול ועד קטן — בברית עם ה׳, ברית הנמשכת גם לדורות הבאים.',
    },
    { aliyah: 2, text: 'אזהרה חמורה מפני עבודה זרה, וקללות קשות למי שיסטה מן הברית בסתר לבו.' },
    { aliyah: 3, text: 'לאחר הגלות והעונש, ה׳ מבטיח לקבץ את העם בחזרה ולרחם עליו כשישוב בתשובה.' },
  ],
  Vayeilech: [
    { aliyah: 4, text: 'משה, בגיל מאה ועשרים, מודיע שלא יעבור את הירדן, ומחזק את יהושע שימשיך תחתיו.' },
    { aliyah: 5, text: 'משה כותב את התורה ומצווה לקרוא אותה לעם כל שבע שנים במעמד הקהל.' },
    { aliyah: 6, text: 'ה׳ מודיע למשה שהעם יסטה מהדרך אחרי מותו, ומצווה לכתוב שירה שתעיד בו.' },
    { aliyah: 7, text: 'משה מוסר את התורה ללויים ומצווה לקבץ את הזקנים לפני שיאמר את השירה.' },
  ],
  "Ha'azinu": [
    { aliyah: 1, text: 'משה פותח בשירה המזכירה שמיים וארץ כעדים, ומשבח את צדקת ה׳.' },
    { aliyah: 2, text: 'תזכורת לחסדי ה׳ עם ישראל מאז ימי המדבר, כמו בת עין שנשמרת.' },
    { aliyah: 3, text: 'תיאור השפע שה׳ נתן לישראל, ואזהרה שמא ישמינו וישכחו את מקור הטובה.' },
    { aliyah: 4, text: 'ישראל פונה לעבודה זרה, וה׳ מסתיר פניו וממאס בעם בגלל בגידתם.' },
    { aliyah: 5, text: 'ה׳ שוקל להעניש, אך נמנע מכך כדי שלא ייחסו האויבים את הניצחון לעצמם.' },
    { aliyah: 6, text: 'ה׳ מבטיח נקמה באויבי ישראל ורחמים על עמו בסופו של דבר.' },
    { aliyah: 7, text: 'סיום השירה, וה׳ מצווה את משה לעלות להר נבו ולראות את הארץ מרחוק לפני מותו.' },
  ],
};

export function getOriginalCommentaryForAliyah(
  parashaIds: string[],
  aliyah: number
): CommentaryEntry | undefined {
  for (const id of parashaIds) {
    const entry = DATA[id]?.find((e) => e.aliyah === aliyah);
    if (entry) {
      return {
        text: entry.text,
        kind: 'original-short-explanation',
        coversVerses: [],
      };
    }
  }
  return undefined;
}

export function hasCommentaryCoverage(parashaIds: string[]): boolean {
  return parashaIds.some((id) => Boolean(DATA[id]));
}
