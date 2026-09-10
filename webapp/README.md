# JobCRM — מערכת ניהול עבודות, לקוחות וקבלני ביצוע

מערכת Web App מלאה (לא דמו!) לניהול עסק שירותי שטח — עבודות, לקוחות, קבלני ביצוע,
עמלות והתחשבנות. עובדת מהמחשב ומהטלפון כ-PWA, מותאמת RTL בעברית מלאה.

**להוראות התקנה והעלאה לאוויר צעד-אחר-צעד (בלי ניסיון קודם) → ראו [`README_DEPLOY.md`](./README_DEPLOY.md)**

## טכנולוגיות

| שכבה | טכנולוגיה |
|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript |
| עיצוב | Tailwind CSS, RTL, Mobile First |
| Database + Auth | Supabase (Postgres + Row Level Security) |
| גרפים | Recharts |
| כתובות | Nominatim (OpenStreetMap) — חינמי |
| Hosting | Vercel (Free tier) |
| PWA | manifest.json + Service Worker — ניתן להוספה למסך הבית |

## מבנה הפרויקט

```
webapp/
  supabase/
    schema.sql     כל מבנה מסד הנתונים, RLS, טריגרים ופונקציות (הרצה חד-פעמית)
    seed.sql       נתוני דוגמה (תחומים, ערים, קבלנים, עבודות) — אופציונלי
  src/
    app/
      login/              מסך התחברות
      (app)/               כל המסכים המחוברים (Sidebar/BottomNav משותפים)
        dashboard/          Dashboard ראשי
        jobs/               רשימת עבודות, עבודה חדשה, פרטי עבודה
        contractors/        ניהול קבלנים
        settings/           תחומים/סוגי עבודה, ערים, אמצעי תשלום, סטטוסים
        settlements/        התחשבנות מול קבלנים
        analytics/          גרפים וניתוח ביצועים
        leaderboard/        דירוג קבלנים
        daily-summary/      סיכום יומי + תובנות אוטומטיות
        notifications/      מרכז התראות
      api/geocode/          Proxy ל-Nominatim (חיפוש כתובות)
    components/             רכיבי UI, טפסים, ניווט
    lib/                    לוגיקה עסקית: כסף, WhatsApp, תאריכים, CSV, API calls
  public/
    manifest.json, sw.js, icons/   קבצי PWA
```

## הרצה מקומית (למפתחים)

```bash
cd webapp
npm install
cp .env.example .env.local   # ומילוי פרטי Supabase האמיתיים
npm run dev
```

האתר ירוץ בכתובת `http://localhost:3000`.

## עקרונות מפתח בקוד

- **כסף**: כל סכום כספי נשמר כמספר שלם באגורות (`agorot`, `bigint`) ולא כ-float, כדי
  למנוע טעויות עיגול. חישובי העמלה מתבצעים בשרת (Postgres function `close_job`),
  לא בדפדפן.
- **היסטוריה**: לכל עבודה נשמר `commission_pct` (אחוז הקבלן) בזמן היצירה. שינוי אחוז
  קבוע לקבלן בעתיד לא משנה עבודות ישנות.
- **מחיקה רכה**: תחומים, סוגי עבודה, ערים וקבלנים לא נמחקים — מסומנים כ"לא פעיל"
  (ארכיון) כדי לשמר היסטוריה עסקית.
- **אבטחה**: Row Level Security מופעל על כל הטבלאות. גישה מלאה רק למשתמש מחובר
  (`authenticated`), אין גישה כלל למשתמש אנונימי.
