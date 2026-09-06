import React, { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ScreenContainer } from '@/components/ScreenContainer';
import { Dedication } from '@/components/Dedication';
import { OptionPicker } from '@/components/OptionPicker';
import { PrimaryButton } from '@/components/PrimaryButton';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';
import type { ReadingModeOption } from '@/types';

const HOUR_PRESETS = [6, 7, 8, 12, 18, 20, 21, 22];

export default function OnboardingScreen() {
  const { settings, updateSettings } = useApp();
  const colors = useThemeColors(settings.theme);
  const router = useRouter();

  const [step, setStep] = useState<0 | 1 | 2>(0);
  const [hour, setHour] = useState(20);
  const [readingMode, setReadingMode] = useState<ReadingModeOption>('sequential');

  const finish = async () => {
    await updateSettings({
      notifications: { ...settings.notifications, hour, minute: 0, enabled: true },
      readingMode,
      onboardingCompleted: true,
    });
    router.replace('/');
  };

  return (
    <ScreenContainer>
      {step === 0 && (
        <View style={styles.centerStep}>
          <Dedication />
          <Text style={[styles.welcome, { color: colors.primary }]}>ברוך הבא</Text>
          <Text style={[styles.tagline, { color: colors.text }]}>
            שניים מקרא ואחד תרגום, יום אחרי יום.
          </Text>
          <Text style={[styles.subtitle, { color: colors.textMuted }]}>
            פרשת השבוע, קצת בכל יום.
          </Text>
          <PrimaryButton title="המשך" size="large" onPress={() => setStep(1)} />
        </View>
      )}

      {step === 1 && (
        <View>
          <Text style={[styles.question, { color: colors.text }]}>מתי תרצה שנזכיר לך לקרוא?</Text>
          <OptionPicker
            value={String(hour)}
            onChange={(v) => setHour(Number(v))}
            options={HOUR_PRESETS.map((h) => ({ value: String(h), label: `${String(h).padStart(2, '0')}:00` }))}
          />
          <PrimaryButton title="המשך" size="large" onPress={() => setStep(2)} />
        </View>
      )}

      {step === 2 && (
        <View>
          <Text style={[styles.question, { color: colors.text }]}>איזה סגנון קריאה אתה מעדיף?</Text>
          <OptionPicker
            value={readingMode}
            onChange={setReadingMode}
            options={[
              { value: 'verse-by-verse', label: 'פסוק-פסוק' },
              { value: 'sequential', label: 'כל הקטע ברצף' },
            ]}
          />
          <PrimaryButton title="התחל" size="large" onPress={finish} />
        </View>
      )}
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  centerStep: { alignItems: 'center', justifyContent: 'center', flexGrow: 1, gap: 12 },
  welcome: { fontFamily: fonts.serifBold, fontSize: 36 },
  tagline: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.title, textAlign: 'center' },
  subtitle: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.body, marginBottom: 24 },
  question: { fontFamily: fonts.sansBold, fontSize: UI_FONT_SIZES.title, textAlign: 'right', marginBottom: 16 },
});
