import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Card } from '@/components/Card';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';

export default function AboutScreen() {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);
  const router = useRouter();

  return (
    <ScreenContainer>
      <Pressable onPress={() => router.back()}>
        <Text style={[styles.back, { color: colors.primary }]}>‹ חזרה</Text>
      </Pressable>
      <Text style={[styles.title, { color: colors.text }]}>שניים מקרא – כל יום</Text>
      <Text style={[styles.slogan, { color: colors.textMuted }]}>פרשת השבוע, קצת בכל יום.</Text>

      <Card>
        <Text style={[styles.h2, { color: colors.primary }]}>מקורות הטקסט</Text>
        <Text style={[styles.p, { color: colors.text }]}>
          נוסח המקרא ותרגום אונקלוס מגיעים מ־Sefaria (ספריא), ספרייה דיגיטלית פתוחה למקורות יהודיים.
          כל טקסט מוצג יחד עם שם המקור והרישיון שלו, כפי שמדווח על ידי ה-API.
        </Text>
        <Text style={[styles.p, { color: colors.text }]}>
          חשוב: בעת בניית האפליקציה לא היה ניתן לגשת בפועל ל-sefaria.org מסביבת הפיתוח כדי לאמת את
          תנאי הרישיון המדויקים בזמן אמת. לפני פרסום ציבורי של האפליקציה יש לבדוק מול sefaria.org/terms
          שהשימוש תואם לרישיון של כל גרסת טקסט בפועל.
        </Text>
      </Card>

      <Card>
        <Text style={[styles.h2, { color: colors.primary }]}>לוח שנה ופרשת השבוע</Text>
        <Text style={[styles.p, { color: colors.text }]}>
          תאריך עברי, פרשת השבוע, חגים ושבתות מיוחדות מחושבים באמצעות הספרייה הפתוחה @hebcal/core
          ו-@hebcal/leyning (המפעילות גם את hebcal.com), כדי שהחישוב יהיה עקבי ומדויק ולא ינחש.
        </Text>
      </Card>

      <Card>
        <Text style={[styles.h2, { color: colors.primary }]}>חלוקת שניים מקרא ופירושים</Text>
        <Text style={[styles.p, { color: colors.text }]}>
          חלוקת הפרשה לשבע העליות מבוססת על מקור נתונים תורני קבוע (לא מומצאת). באיזה יום בשבוע קוראים
          כל עלייה הוא עניין של מנהג — האפליקציה מציגה שני מנהגים נפוצים לבחירה, ואינה פוסקת הלכה.
        </Text>
        <Text style={[styles.p, { color: colors.text }]}>
          פירושים המסומנים "הסבר קצר" הם טקסט מקורי שנכתב עבור האפליקציה הזו בלבד — לא ציטוט מפרשן
          מוגן בזכויות יוצרים. הכיסוי מתרחב בהדרגה מפרשה לפרשה.
        </Text>
      </Card>

      <Card>
        <Text style={[styles.h2, { color: colors.primary }]}>פרטיות</Text>
        <Text style={[styles.p, { color: colors.text }]}>
          כל הנתונים — הגדרות, התקדמות ורצף ימים — נשמרים מקומית במכשיר בלבד. אין צורך בחשבון או
          התחברות בגרסה הזו.
        </Text>
      </Card>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  back: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.body, marginBottom: 8, textAlign: 'right' },
  title: { fontFamily: fonts.serifBold, fontSize: UI_FONT_SIZES.headline, textAlign: 'right' },
  slogan: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.body, textAlign: 'right', marginBottom: 16 },
  h2: { fontFamily: fonts.sansBold, fontSize: UI_FONT_SIZES.title, textAlign: 'right', marginBottom: 8 },
  p: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.body, textAlign: 'right', lineHeight: 22, marginBottom: 8 },
});
