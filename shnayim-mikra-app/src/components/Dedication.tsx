import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts } from '@/theme/typography';

/**
 * Personal dedication, shown wherever the app "begins" for the user
 * (onboarding, and the top of the home screen). Content is fixed by the
 * app owner, not user-editable.
 */
export function Dedication() {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);
  return (
    <View style={styles.wrap}>
      <View style={[styles.rule, { backgroundColor: colors.accent }]} />
      <Text style={[styles.text, { color: colors.accent }]}>
        לעילוי נשמת אבי מורי אברהם בן שמחה מויאל ז״ל
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', marginBottom: 14 },
  rule: { width: 36, height: 2, borderRadius: 1, marginBottom: 8, opacity: 0.6 },
  text: {
    fontFamily: fonts.serifRegular,
    fontSize: 13,
    textAlign: 'center',
  },
});
