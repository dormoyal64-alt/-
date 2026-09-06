# שניים מקרא – כל יום

**"פרשת השבוע, קצת בכל יום."**

אפליקציית מובייל (React Native + Expo + TypeScript) שעוזרת להתמיד בקריאה היומית של שניים מקרא ואחד תרגום, עם חלוקה יומית אוטומטית של פרשת השבוע, פירוש קצר, תזכורות, ומעקב רצף ימים (streak). כתובה בעברית מלאה, RTL, Mobile First.

---

## 1. למה React Native + Expo (ולא Next.js PWA)

הועדף כי המטרה המוצהרת היא גם iOS וגם Android עם קוד אחד, ושני צרכים מרכזיים באפליקציה — **התראות יומיות אמינות** ו-**Offline מלא** — פשוטים ויציבים משמעותית ב-Native/Expo:

- Web Push ב-iOS Safari מוגבל ומורכב (דורש PWA מותקן למסך הבית, תמיכה חלקית, לא local-first).
- `expo-notifications` נותן התראות מקומיות אמיתיות שפותחות מסך ספציפי, גם ללא רשת.
- Offline מלא (טקסט מוקאש למכשיר) פשוט יותר עם AsyncStorage/SQLite מאשר Service Worker + Cache API.
- דרישה מפורשת בבקשה המקורית: "כדי שאוכל בעתיד להוציא את האפליקציה גם ל-iPhone וגם ל-Android".

---

## 2. ארכיטקטורה

```
shnayim-mikra-app/
  app/                          # מסכים (expo-router, file-based routing)
    _layout.tsx                 # Root: פונטים, RTL, AppProvider, ניתוב התראות
    onboarding.tsx
    reading.tsx                 # מסך הקריאה (מוצג כ-modal מלא)
    about.tsx
    settings/
      notification-time.tsx
    (tabs)/                     # ניווט תחתון
      _layout.tsx
      index.tsx                 # מסך הבית
      progress.tsx              # ההתקדמות שלי
      calendar.tsx               # לוח שנה
      settings.tsx               # הגדרות

  src/
    types/                      # טיפוסי דומיין משותפים (לא תלויים בשום ספק חיצוני)
    services/
      calendar/                 # מנוע לוח השנה והחלוקה היומית (הלב ההלכתי-טכני)
        hebrewCalendar.ts        # תאריך עברי, חגים, שבת/ערב שבת — עוטף @hebcal/core
        parasha.ts                # פרשת השבוע לפי שבוע, כולל שבתות מיוחדות — עוטף Sedra
        readingDivision.ts        # חלוקת הפרשה ל-7 עליות + 2 מנהגי חלוקה יומית
        index.ts                  # getDailyReadingPlan() — הפונקציה המרכזית
      torah/                     # ספק טקסט המקרא/אונקלוס
        TorahTextProvider.ts       # ממשק — מאפשר להחליף מקור נתונים בעתיד
        SefariaProvider.ts          # מימוש מול Sefaria API
        CachingTorahTextProvider.ts # עטיפת Offline-cache שקופה
        commentaryData/              # "הסבר קצר" מקורי, לפי פרשה+עלייה
        readingContent.ts             # מרכיב את תוכן היום המלא למסך הקריאה
        prefetch.ts                    # הורדת כל השבוע מראש ל-Offline
      storage/                    # שכבת ה-database (AsyncStorage, מאחורי ממשק)
        LocalStore.ts, settingsRepo.ts, progressRepo.ts, textCacheRepo.ts
      notifications/
        scheduler.ts               # תזמון/ביטול/Snooze של תזכורות מקומיות
      streak/
        streakEngine.ts             # חישוב רצף נוכחי/שיא, בהתחשב בימי מנוחה (חג/שבת)
    hooks/                        # AppProvider (state גלובלי), useDailyPlan, useReadingContent...
    components/                   # רכיבי UI משותפים (Card, PrimaryButton, VerseBlock...)
    theme/                        # צבעים וטיפוגרפיה (RTL, כהה/בהיר)

  __tests__/                     # Jest — לוח שנה וחלוקת קריאה (ראה סעיף 6)
```

**עקרון מפתח:** `src/services/calendar` ו-`src/services/torah` הם שתי שכבות נפרדות לגמרי:
לוח השנה (מבוסס `@hebcal/core`/`@hebcal/leyning`, קוד פתוח MIT) קובע **מה** צריך לקרוא; ספק הטקסט (`TorahTextProvider`) קובע **מאיפה** מביאים את הטקסט בפועל. אפשר להחליף את Sefaria במקור אחר בעתיד בלי לגעת בלוח השנה, במסכים, או בהתקדמות/streak.

---

## 3. איך מריצים

```bash
cd shnayim-mikra-app
npm install
npx expo start
```

לאחר מכן סרקו את ה-QR עם אפליקציית **Expo Go** (Android/iOS), או הריצו:

```bash
npm run android   # דורש Android Studio + אמולטור, או מכשיר מחובר
npm run ios       # דורש macOS + Xcode
```

### הרצת בדיקות

```bash
npm test           # מריץ את כל בדיקות היחידה (Jest)
npm run typecheck  # בדיקת טיפוסים מלאה (TypeScript, ללא build)
```

---

## 4. בניית APK לבדיקה (EAS Build)

1. התקנת הכלי (חד פעמי):
   ```bash
   npm install -g eas-cli
   eas login
   ```
2. מתוך תיקיית `shnayim-mikra-app`:
   ```bash
   eas build --platform android --profile preview
   ```
   הפרופיל `preview` (מוגדר ב-`eas.json`) בונה **APK** (לא AAB) שאפשר להתקין ישירות על מכשיר לבדיקה, ללא חשבון Google Play.
3. בסיום ה-build תקבלו קישור להורדת ה-APK ישירות מהטרמינל / מדשבורד expo.dev.

לבדיקה מקומית מהירה יותר בלי חשבון EAS: `npx expo run:android` (בונה ומתקין ישירות על אמולטור/מכשיר מחובר, דורש Android SDK מותקן).

---

## 5. פרסום עתידי לחנויות

### Google Play
1. `eas build --platform android --profile production` (בונה App Bundle `.aab`).
2. פתחו חשבון Google Play Console (עלות חד-פעמית).
3. `eas submit --platform android` — מעלה את ה-AAB ישירות ל-Play Console (דורש הגדרת Service Account, ר' [תיעוד EAS Submit](https://docs.expo.dev/submit/android/)).
4. מלאו את דף החנות (תיאור, צילומי מסך, מדיניות פרטיות — יש טיוטה בסיסית בסעיף 8 למטה) ושלחו לבדיקה.

### Apple App Store
1. חשבון Apple Developer (עלות שנתית).
2. `eas build --platform ios --profile production`.
3. `eas submit --platform ios`.
4. מילוי App Store Connect (תיאור, צילומי מסך, פרטיות) ושליחה לבדיקה.

**לפני שליחה בפועל לחנויות** — חובה להשלים:
- אייקון ומסך פתיחה (splash) סופיים תחת `assets/` (כרגע יש placeholder בסיסי מה-template של Expo).
- אימות תנאי הרישיון של Sefaria בפועל (ר' סעיף 7 — לא היה ניתן לאמת מתוך סביבת הפיתוח).
- מדיניות פרטיות פומבית (גם אם "אין איסוף נתונים", החנויות דורשות קישור).

---

## 6. בדיקות שבוצעו (Unit Tests) — `__tests__/`

כל התאריכים בבדיקות **אומתו בפועל מול @hebcal/core בזמן הפיתוח** (לא הונחו מהזיכרון) — ראו הערות בקוד הבדיקות. מכסה את כל התרחישים שהתבקשו:

| תרחיש | קובץ בדיקה |
|---|---|
| יום רגיל באמצע השבוע | `parasha.test.ts`, `readingDivision.test.ts` |
| ערב שבת | `parasha.test.ts`, `hebrewCalendar.test.ts` |
| שבת | `parasha.test.ts`, `hebrewCalendar.test.ts` |
| מוצאי שבת (המעבר ליום ראשון) | `parasha.test.ts` |
| ראש השנה | `hebrewCalendar.test.ts`, `parasha.test.ts` |
| יום כיפור | `hebrewCalendar.test.ts` |
| סוכות (כולל חול המועד) | `hebrewCalendar.test.ts`, `parasha.test.ts` |
| פסח (כולל יום ח׳ בחו״ל בלבד) | `hebrewCalendar.test.ts` |
| שבועות | `hebrewCalendar.test.ts` |
| שבת שחג דוחה בה את פרשת השבוע | `parasha.test.ts` ("Sukkot I on Shabbat", "Rosh Hashana on Shabbat") |
| שנה מעוברת | `hebrewCalendar.test.ts` (5787=מעוברת, 5786=לא) |
| מעבר בין שנים עבריות | `parasha.test.ts` (חזרה לבראשית אחרי סוכות) |
| הבדל ארץ ישראל מול חו״ל | `parasha.test.ts` (סטייה ואיחוד מחדש בין הלוחות ב-5786) |
| חלוקת שניים מקרא (2 מנהגים) | `readingDivision.test.ts` |
| רצף ימים (streak) שלא נשבר בגלל יום מנוחה הלכתי | `streakEngine.test.ts` |

הרצה: `npm test`.

---

## 7. מקורות הטקסט, רישיונות ודיוק הלכתי

### לוח שנה עברי ופרשת השבוע
מחושב באמצעות `@hebcal/core` ו-`@hebcal/leyning` (קוד פתוח, רישיון MIT/BSD, זו הספרייה שמפעילה את hebcal.com). **לא מומצא** — הפרשה, החגים, השבתות המיוחדות והבדלי ארץ/חו״ל מגיעים ישירות מהספרייה.

### חלוקת שניים מקרא ליום
גבולות 7 העליות מגיעים מ-`@hebcal/leyning` (מקור נתונים תורני קבוע). **לאיזה יום משבצים כל עלייה הוא עניין של מנהג** — לא הלכה מוסכמת אחת. האפליקציה מציעה שני מנהגים נפוצים לבחירה בהגדרות ומסמנת אותם ככאלה (לא כפסק מחייב).

### נוסח המקרא ותרגום אונקלוס
מגיעים מ-**Sefaria API** (`https://www.sefaria.org/api/texts/...`), API פתוח וללא צורך במפתח, הכולל טקסט עם ניקוד ותרגום אונקלוס מלא.

**⚠️ הגבלה חשובה מהעבודה על הפרויקט:** במהלך הפיתוח, גישה ישירה ל-`sefaria.org` הייתה **חסומה ברמת הפרוקסי** של סביבת העבודה (ראה `WebFetch` errors ב-session). לכן:
- לא ניתן היה לאמת בפועל, בזמן אמת, את הניסוח המדויק של תנאי השימוש בדף `sefaria.org/terms`.
- הקוד ב-`src/services/torah/SefariaProvider.ts` **קורא ובודק את שדה ה-`license`/`heLicense`** שמוחזר מכל בקשת API (Sefaria חושפת רישיון per-version — לדוגמה `Public Domain`, `CC0`, `CC-BY`) ומציג אותו יחד עם הטקסט, אבל רשימת הרישיונות ה"מותרים" (`PERMISSIVE_LICENSES` בקובץ) נכתבה מתוך ידע כללי על מודל הרישוי של Sefaria, לא מאימות חי.
- **לפני פרסום ציבורי**, יש חובה לבדוק ידנית מול `sefaria.org/terms` ומול תיעוד ה-API (`developers.sefaria.org`) שהשימוש בפועל תואם לרישיון של כל גרסת טקסט שנטענת, ולעדכן את `PERMISSIVE_LICENSES` בהתאם אם צריך.

### פירושים ("הסבר קצר")
**לא הוכנס אף פירוש מוגן בזכויות יוצרים.** הפירושים הקצרים תחת `src/services/torah/commentaryData/` הם טקסט מקורי שנכתב במיוחד עבור האפליקציה הזו, ומסומנים בקוד (`kind: 'original-short-explanation'`) ובממשק ("פירוש — הסבר קצר").

**כיסוי תוכן נוכחי (v1):** בראשית, נח, ניצבים, וילך, האזינו — 28 בלוקים (7 עליות × 4 פרשות). זהו כיסוי **מכוון להיות חלקי** לגרסה ראשונה: כתיבת פירוש מקורי אחראי ומדויק לכל 54 הפרשות (378 עליות) היא עבודת תוכן משמעותית שלא ניתן היה לבצע בשלמותה בסבב עבודה אחד מבלי לפגוע באיכות. **הארכיטקטורה תומכת בהרחבה מיידית** — הוספת פרשה נוספת היא הוספת אובייקט JSON אחד בקובץ, ללא שינוי קוד. במסך הקריאה, פרשה ללא פירוש זמין פשוט לא מציגה בלוק פירוש (לא קורס ולא ממציאה תוכן).

### הפרדה בין סוגי המידע (כפי שהתבקש)
1. **נתוני לוח שנה** — `@hebcal/core`/`@hebcal/leyning` (חיצוני, קוד פתוח, לא ניתן לעריכה מקומית).
2. **נוסח המקרא** — Sefaria (חיצוני, עם ציון רישיון).
3. **תרגום אונקלוס** — Sefaria (חיצוני, עם ציון רישיון).
4. **מנהג חלוקת שניים מקרא** — לוגיקה מקומית (`readingDivision.ts`), מוצג כבחירה לא כפסק.
5. **הסברים/פירושים** — תוכן מקורי מקומי, מסומן בבירור ("הסבר קצר").

---

## 8. פרטיות

אין התחברות/חשבון בגרסה זו. כל הנתונים (הגדרות, התקדמות, streak) נשמרים מקומית במכשיר בלבד דרך `@react-native-async-storage/async-storage`, מאחורי שכבת `src/services/storage/LocalStore.ts`. שכבה זו נבנתה בכוונה כממשק מופשט כדי שאפשר יהיה בעתיד להוסיף חשבון/סנכרון ענן/גיבוי בלי לשנות את שאר האפליקציה.

---

## 9. הרחבות עתידיות (הארכיטקטורה מוכנה עבורן, לא מומשו עדיין)

- **זמני הלכה אמיתיים** (אחרי שחרית, לפני שקיעה, לפני כניסת שבת) — ניתן להשתמש ב-`Location`/`Zmanim` מ-`@hebcal/core` יחד עם מיקום המשתמש (`expo-location`) כדי לחשב שקיעה/הדלקת נרות אמיתיים במקום שעה קבועה בלבד. כרגע ההתראות תומכות רק בשעה קבועה + ימים נבחרים.
- **שיטות חלוקה נוספות** — `READING_DIVISION_SCHEMES` ב-`readingDivision.ts` הוא Record פתוח; הוספת מנהג שלישי היא הוספת ערך אחד.
- **מקור טקסט חלופי** — כל דבר שממש את `TorahTextProvider` (ראו `TorahTextProvider.ts`) יכול להחליף את `SefariaProvider` בקובץ `torah/index.ts` בלבד.
- **חשבון/סנכרון ענן** — שכבת ה-storage כבר מבודדת מאחורי ממשק (`LocalStore.ts`).

---

## 10. הגבלות ידועות בגרסה זו

- כיסוי הפירושים חלקי (ראו סעיף 7).
- קביעת "תאריך עברי נוכחי" מבוססת על תאריך גרגוריאני אזרחי (חצות), ולא על שקיעה בפועל — כמו רוב אפליקציות הלוח העברי, אך לא זהה ל-100% לזמן ההלכתי המדויק של תחילת היום.
- אימות רישיון Sefaria נעשה ברמת קוד (בדיקת שדה `license`) אך לא אומת ידנית מול התנאים המלאים (ראו סעיף 7).
- לא נבדק בפועל על מכשיר/אמולטור פיזי בסביבת הפיתוח (אין גישה ל-Android/iOS runtime בסביבה זו); ה-JS bundle כן נבדק בהצלחה עם Metro (`npx expo export --platform android`, 1686 מודולים, ללא שגיאות) וכל לוגיקת הליבה מכוסה בבדיקות יחידה.
