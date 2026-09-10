// פרטי חיבור ל-Firebase — נקודת העריכה היחידה שצריך למלא לפני שימוש.
// איך משיגים את הערכים: ראו README.md בתיקיית app/ (חלק "הקמת Firebase").
// כל שדה שמתחיל ב-REPLACE_ הוא Placeholder — עד שלא יוחלף, האפליקציה תציג מסך שגיאה במקום להתחבר.

export const firebaseConfig = {
  apiKey: 'REPLACE_FIREBASE_API_KEY',
  authDomain: 'REPLACE_FIREBASE_AUTH_DOMAIN',
  projectId: 'REPLACE_FIREBASE_PROJECT_ID',
  storageBucket: 'REPLACE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'REPLACE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'REPLACE_FIREBASE_APP_ID',
};

export const isFirebaseConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === 'string' && !value.startsWith('REPLACE_'),
);
