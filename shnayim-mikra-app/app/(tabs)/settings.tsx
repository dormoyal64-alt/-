import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { OptionPicker } from '@/components/OptionPicker';
import { SettingSectionTitle, SettingSwitchRow } from '@/components/SettingRow';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';
import { READING_DIVISION_SCHEMES } from '@/services/calendar/readingDivision';

export default function SettingsScreen() {
  const { settings, updateSettings } = useApp();
  const colors = useThemeColors(settings.theme);
  const router = useRouter();

  return (
    <ScreenContainer>
      <Text style={[styles.title, { color: colors.text }]}>הגדרות</Text>

      <SettingSectionTitle>מיקום</SettingSectionTitle>
      <OptionPicker
        value={settings.country}
        onChange={(country) => updateSettings({ country })}
        options={[
          { value: 'IL', label: 'ארץ ישראל' },
          { value: 'DIASPORA', label: 'חוץ לארץ' },
        ]}
      />

      <SettingSectionTitle>מנהג חלוקת שניים מקרא</SettingSectionTitle>
      <OptionPicker
        value={settings.divisionScheme}
        onChange={(divisionScheme) => updateSettings({ divisionScheme })}
        options={Object.values(READING_DIVISION_SCHEMES).map((s) => ({
          value: s.id,
          label: s.nameHe,
          description: `${s.descriptionHe} ${s.sourceNoteHe}`,
        }))}
      />

      <SettingSectionTitle>סגנון קריאה</SettingSectionTitle>
      <OptionPicker
        value={settings.readingMode}
        onChange={(readingMode) => updateSettings({ readingMode })}
        options={[
          { value: 'sequential', label: 'הצגת הכל ברצף' },
          { value: 'verse-by-verse', label: 'פסוק-פסוק' },
        ]}
      />

      <SettingSectionTitle>גודל גופן</SettingSectionTitle>
      <OptionPicker
        value={settings.fontSize}
        onChange={(fontSize) => updateSettings({ fontSize })}
        options={[
          { value: 'small', label: 'קטן' },
          { value: 'medium', label: 'בינוני' },
          { value: 'large', label: 'גדול' },
          { value: 'xlarge', label: 'גדול מאוד' },
        ]}
      />

      <SettingSectionTitle>תצוגה וקריאה</SettingSectionTitle>
      <SettingSwitchRow
        label="ניקוד"
        description="הצגת הטקסט עם ניקוד, כאשר קיים במקור"
        value={settings.nikud}
        onValueChange={(nikud) => updateSettings({ nikud })}
      />
      <SettingSwitchRow
        label="מצב כהה"
        value={settings.theme === 'dark'}
        onValueChange={(v) => updateSettings({ theme: v ? 'dark' : 'light' })}
      />
      <SettingSwitchRow
        label="מצב קריאה ללא פירושים"
        value={settings.hideCommentary}
        onValueChange={(hideCommentary) => updateSettings({ hideCommentary })}
      />
      <SettingSwitchRow
        label="הצג פירוש רק לאחר קריאת המקרא והתרגום"
        value={settings.revealCommentaryAfterReading}
        onValueChange={(revealCommentaryAfterReading) => updateSettings({ revealCommentaryAfterReading })}
      />

      <SettingSectionTitle>שבת</SettingSectionTitle>
      <SettingSwitchRow
        label="מצב שומר שבת"
        description="לא תישלח תזכורת בשבת, ואפשר להשלים את הקריאה מראש לפני כניסתה מבלי שהדבר ייחשב כיום שהוחמץ."
        value={settings.shabbatObservantMode}
        onValueChange={(shabbatObservantMode) => updateSettings({ shabbatObservantMode })}
      />

      <SettingSectionTitle>התראות</SettingSectionTitle>
      <PrimaryButton
        title={`תזכורת יומית: ${settings.notifications.enabled ? `${String(settings.notifications.hour).padStart(2, '0')}:${String(settings.notifications.minute).padStart(2, '0')}` : 'כבויה'}`}
        variant="secondary"
        onPress={() => router.push('/settings/notification-time')}
      />

      <SettingSectionTitle>מידע</SettingSectionTitle>
      <PrimaryButton title="אודות ומקורות" variant="ghost" onPress={() => router.push('/about')} />
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  title: { fontFamily: fonts.serifBold, fontSize: UI_FONT_SIZES.headline, textAlign: 'right', marginBottom: 16 },
});
