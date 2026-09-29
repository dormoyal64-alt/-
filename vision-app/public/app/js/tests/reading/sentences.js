// @ts-check
/**
 * Original reading-test sentences (written for SeeTuned; NOT the copyrighted MNREAD sentences).
 * Design (vision-science.md §4.4): each sentence is about 60 characters (spaces included), uses everyday
 * vocabulary, has no digits, names or punctuation, and is laid out as a 3-line block. Hebrew and English
 * sets are parallel in content and length. `word` appears in the sentence; `foil` does not — they drive the
 * 2-choice check after each sentence. Hebrew sentences still need linguistic validation (§4.4).
 */

/** @typedef {{text: string, word: string, foil: string}} Sentence */

/** @type {Record<'he'|'en', {practice: Sentence, sentences: Sentence[]}>} */
export const SENTENCES = {
  en: {
    practice: { text: 'This short sentence is only for practice so take your time', word: 'practice', foil: 'music' },
    sentences: [
      { text: 'The old dog slept in the sun by the door for most of the day', word: 'dog', foil: 'cat' },
      { text: 'We packed a small lunch and walked to the lake after school', word: 'lake', foil: 'park' },
      { text: 'She planted red flowers along the fence behind her new house', word: 'flowers', foil: 'trees' },
      { text: 'The train was late so we had a cup of tea at the station cafe', word: 'tea', foil: 'soup' },
      { text: 'My brother likes to ride his bike to work when the sky is clear', word: 'bike', foil: 'car' },
      { text: 'The children built a tall tower of blocks on the kitchen floor', word: 'tower', foil: 'bridge' },
      { text: 'Grandma keeps a jar of sweet cookies on the top shelf for us', word: 'cookies', foil: 'apples' },
      { text: 'A little bird sang outside my window very early in the morning', word: 'bird', foil: 'frog' },
      { text: 'We could hear the waves as we walked along the quiet beach', word: 'beach', foil: 'river' },
      { text: 'He fixed the broken chair and painted it a bright shade of blue', word: 'chair', foil: 'table' },
      { text: 'The farmer woke up early to feed the cows and gather the eggs', word: 'cows', foil: 'sheep' },
      { text: 'Our neighbor plays soft music on the piano every single evening', word: 'piano', foil: 'guitar' },
      { text: 'They carried warm blankets up the hill to look at the stars', word: 'stars', foil: 'moon' },
      { text: 'The baker sold fresh bread and sweet cakes to the long line', word: 'cakes', foil: 'pies' },
      { text: 'My friend wrote me a long letter about her trip to the big city', word: 'letter', foil: 'story' },
      { text: 'The cat jumped onto the table and knocked over a glass of milk', word: 'milk', foil: 'water' },
      { text: 'We waited under a large tree until the heavy rain had stopped', word: 'rain', foil: 'snow' },
      { text: 'Dad made hot soup with carrots and beans on a cold winter night', word: 'carrots', foil: 'onions' },
      { text: 'The small boat moved slowly across the calm water of the bay', word: 'boat', foil: 'ship' },
      { text: 'Every spring the birds come back to build nests in our garden', word: 'garden', foil: 'forest' },
    ],
  },
  he: {
    practice: { text: 'המשפט הקצר הזה נועד רק לתרגול ולכן אפשר לקרוא אותו לאט ובנחת', word: 'לתרגול', foil: 'למוזיקה' },
    sentences: [
      { text: 'הכלב הזקן ישן בשמש החמימה ליד הדלת כמעט כל היום ולא זז משם', word: 'הכלב', foil: 'החתול' },
      { text: 'ארזנו ארוחה קטנה והלכנו יחד ברגל אל האגם אחרי שנגמרו הלימודים', word: 'האגם', foil: 'הפארק' },
      { text: 'היא שתלה פרחים אדומים לאורך הגדר שמאחורי הבית החדש שלה בכפר', word: 'פרחים', foil: 'עצים' },
      { text: 'הרכבת איחרה מאוד ולכן שתינו כוס תה בבית הקפה הקטן שליד התחנה', word: 'תה', foil: 'מרק' },
      { text: 'אחי הגדול אוהב לרכוב על האופניים לעבודה כשהשמיים בהירים ונקיים', word: 'האופניים', foil: 'המכונית' },
      { text: 'הילדים בנו מגדל גבוה מאוד מקוביות צבעוניות על הרצפה של המטבח', word: 'מגדל', foil: 'גשר' },
      { text: 'סבתא שומרת בשבילנו צנצנת גדולה של עוגיות מתוקות על המדף העליון', word: 'עוגיות', foil: 'תפוחים' },
      { text: 'ציפור קטנה שרה מחוץ לחלון של החדר שלי מוקדם מאוד בכל בוקר', word: 'ציפור', foil: 'צפרדע' },
      { text: 'שמענו את קול הגלים הרכים בזמן שהלכנו לאט לאורך החוף השקט בערב', word: 'החוף', foil: 'הנהר' },
      { text: 'הוא תיקן בזהירות את הכיסא השבור וצבע אותו בצבע כחול בהיר מאוד', word: 'הכיסא', foil: 'השולחן' },
      { text: 'החקלאי קם מוקדם בבוקר כדי להאכיל את הפרות ולאסוף את הביצים', word: 'הפרות', foil: 'הכבשים' },
      { text: 'השכן הנחמד שלנו מנגן מוזיקה שקטה בפסנתר בכל ערב אחרי ארוחת הערב', word: 'בפסנתר', foil: 'בגיטרה' },
      { text: 'בלילה הם סחבו שמיכות חמות במעלה הגבעה כדי להסתכל על הכוכבים', word: 'הכוכבים', foil: 'הירח' },
      { text: 'האופה מכר לחם טרי וגם עוגות מתוקות לכל האנשים שחיכו בתור הארוך', word: 'עוגות', foil: 'פשטידות' },
      { text: 'חברה טובה שלי כתבה לי מכתב ארוך על הטיול שלה לעיר הגדולה בצפון', word: 'מכתב', foil: 'סיפור' },
      { text: 'החתול הצעיר קפץ על השולחן והפיל כוס גדולה מלאה בחלב קר על הרצפה', word: 'בחלב', foil: 'במים' },
      { text: 'חיכינו מתחת לעץ גדול עד שסוף סוף הגשם הכבד הפסיק לרדת מהשמיים', word: 'הגשם', foil: 'השלג' },
      { text: 'אבא הכין לנו מרק חם עם גזר ושעועית בערב חורף קר וגשום במיוחד', word: 'גזר', foil: 'בצל' },
      { text: 'הסירה הקטנה והלבנה שטה לאט על פני המים השקטים של המפרץ הרחב', word: 'הסירה', foil: 'הספינה' },
      { text: 'בכל אביב הציפורים הקטנות חוזרות אלינו כדי לבנות קנים בגינה שלנו', word: 'בגינה', foil: 'ביער' },
    ],
  },
};

/**
 * Split a sentence into 3 lines of near-equal character length, breaking only at spaces.
 * @param {string} text
 * @param {number} [lines]
 * @returns {string[]}
 */
export function splitIntoLines(text, lines = 3) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= lines) return words;
  /** @type {string[]} */
  let best = [text];
  let bestKey = [Infinity, Infinity];
  /** @param {number} start @param {number} k @param {string[]} acc */
  const search = (start, k, acc) => {
    if (k === 1) {
      const cand = [...acc, words.slice(start).join(' ')];
      const lens = cand.map((l) => l.length);
      const key = [Math.max(...lens), Math.max(...lens) - Math.min(...lens)];
      if (key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = cand; bestKey = key; }
      return;
    }
    for (let i = start + 1; i <= words.length - (k - 1); i++) search(i, k - 1, [...acc, words.slice(start, i).join(' ')]);
  };
  search(0, lines, []);
  return best;
}

/**
 * Whole-word containment (Hebrew prefixes are part of the written word, so compare tokens exactly).
 * @param {string} text @param {string} word
 */
export function containsWord(text, word) {
  return text.split(/\s+/).includes(word);
}
