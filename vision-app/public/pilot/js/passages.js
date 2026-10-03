// @ts-check
/**
 * Reading passages for the SeeTuned pilot study. Written for this study (original text, not taken from any
 * published reading test). Three parallel passages per language: everyday topics, plain vocabulary, similar
 * length (55–65 words, within ±6 % in characters inside each language) and one 3-choice comprehension
 * question each, whose answer is stated once in the text. Hebrew and English sets are parallel in content.
 * A short practice text teaches the Start / Done routine and is never scored.
 */

/** @typedef {{id: string, text: string, question: string, options: string[], answer: number}} Passage */

/** @type {Record<'he'|'en', {practice: string, passages: Passage[]}>} */
export const PASSAGES = {
  en: {
    practice: 'This short text is only for practice. Tap Start, read it at your usual pace, and tap Done when you reach the end.',
    passages: [
      {
        id: 'en-1',
        text: 'Every Friday morning, Dana walks to the small market near her home. She likes to arrive early, before the streets fill with people and cars. First she buys warm bread from the bakery on the corner. Then she chooses tomatoes, cucumbers and a few lemons. On the way back she stops at a little café, orders a hot tea and reads the weekend paper.',
        question: 'What does Dana drink at the café?',
        options: ['Coffee', 'Tea', 'Orange juice'],
        answer: 1,
      },
      {
        id: 'en-2',
        text: 'The bus to the city was late again, so Yossi decided to walk. The morning was cool and the sky was clear after a night of rain. He took the path along the park, where children played near the old fountain and a few people walked their dogs. When he reached the office, he was surprised that the walk had taken only twenty minutes.',
        question: 'Why did Yossi walk to the office?',
        options: ['The bus was late', 'He wanted some exercise', 'His car broke down'],
        answer: 0,
      },
      {
        id: 'en-3',
        text: 'On Saturday evening the whole family came to dinner at Grandma Ruth\'s house. She cooked rice with vegetables, a big salad and the chicken soup that everyone loves. The grandchildren set the table and folded the napkins with care. After the meal they all sat on the balcony, ate slices of cold watermelon and talked and laughed until it was dark outside.',
        question: 'What did the family eat on the balcony?',
        options: ['Ice cream', 'Cake', 'Watermelon'],
        answer: 2,
      },
    ],
  },
  he: {
    practice: 'הטקסט הקצר הזה הוא רק לתרגול. לוחצים על ״התחלה״, קוראים בקצב הרגיל שלכם, ולוחצים על ״סיימתי״ כשמגיעים לסוף.',
    passages: [
      {
        id: 'he-1',
        text: 'בכל יום שישי בבוקר דנה הולכת לשוק הקטן שליד הבית. היא אוהבת להגיע מוקדם, לפני שהרחובות מתמלאים באנשים ובמכוניות. קודם היא קונה לחם חם מהמאפייה הקטנה שבפינה. אחר כך היא בוחרת עגבניות, מלפפונים וכמה לימונים. בדרך חזרה היא עוצרת בבית קפה קטן, מזמינה כוס תה חם וקוראת את עיתון סוף השבוע בנחת, בלי למהר לשום מקום, ואז חוזרת הביתה.',
        question: 'מה דנה שותה בבית הקפה?',
        options: ['קפה', 'תה', 'מיץ תפוזים'],
        answer: 1,
      },
      {
        id: 'he-2',
        text: 'האוטובוס לעיר שוב איחר, ולכן יוסי החליט ללכת ברגל עד העבודה. הבוקר היה קריר, והשמיים היו בהירים אחרי לילה של גשם. הוא הלך בשביל שלאורך הפארק, שם שיחקו ילדים קטנים ליד המזרקה הישנה וכמה אנשים טיילו עם הכלבים שלהם. כשהגיע למשרד, הוא הופתע לגלות שכל ההליכה נמשכה רק עשרים דקות, והרגיש רענן ומלא אנרגיה לקראת יום העבודה הארוך.',
        question: 'למה יוסי הלך ברגל למשרד?',
        options: ['האוטובוס איחר', 'הוא רצה להתעמל', 'המכונית שלו התקלקלה'],
        answer: 0,
      },
      {
        id: 'he-3',
        text: 'במוצאי שבת כל המשפחה הגיעה, כמו בכל שבוע, לארוחת ערב בבית של סבתא רות. היא בישלה אורז עם ירקות, סלט ירקות גדול ומרק עוף שכולם אוהבים. הנכדים ערכו את השולחן וקיפלו את המפיות בזהירות. אחרי הארוחה כולם ישבו במרפסת, אכלו פרוסות גדולות של אבטיח קר, דיברו וצחקו עד שהיה חושך בחוץ, ואז הנכדים הקטנים נרדמו על הספה בסלון.',
        question: 'מה המשפחה אכלה במרפסת?',
        options: ['גלידה', 'עוגה', 'אבטיח'],
        answer: 2,
      },
    ],
  },
};

/** @param {string} id @returns {Passage|null} */
export function passageById(id) {
  for (const set of Object.values(PASSAGES)) {
    const p = set.passages.find((x) => x.id === id);
    if (p) return p;
  }
  return null;
}
