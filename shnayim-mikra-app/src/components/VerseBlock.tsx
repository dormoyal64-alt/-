import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ShnayimMikraVerse } from '@/types';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts } from '@/theme/typography';
import { VERSE_FONT_SIZES } from '@/theme/typography';

export function VerseBlock({ verse }: { verse: ShnayimMikraVerse }) {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);
  const size = VERSE_FONT_SIZES[settings.fontSize];

  return (
    <View style={styles.wrap}>
      <Text style={[styles.refLabel, { color: colors.accent }]}>{verse.refLabel}</Text>

      <Tag label="מקרא — פעם ראשונה" colors={colors} />
      <Text style={[styles.verseText, { color: colors.text, fontSize: size }]}>{verse.mikra}</Text>

      <Tag label="מקרא — פעם שנייה" colors={colors} />
      <Text style={[styles.verseText, { color: colors.text, fontSize: size }]}>{verse.mikra}</Text>

      <Tag label="תרגום אונקלוס" colors={colors} />
      <Text style={[styles.targumText, { color: colors.text, fontSize: size - 1 }]}>{verse.targum}</Text>
    </View>
  );
}

function Tag({ label, colors }: { label: string; colors: ReturnType<typeof useThemeColors> }) {
  return (
    <Text style={[styles.tag, { color: colors.textMuted, borderColor: colors.border }]}>{label}</Text>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 22 },
  refLabel: { fontFamily: fonts.sansBold, fontSize: 13, textAlign: 'right', marginBottom: 6 },
  tag: {
    fontFamily: fonts.sansMedium,
    fontSize: 12,
    textAlign: 'right',
    marginTop: 10,
    marginBottom: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignSelf: 'flex-end',
  },
  verseText: { fontFamily: fonts.serifRegular, textAlign: 'right', lineHeight: 34, writingDirection: 'rtl' },
  targumText: { fontFamily: fonts.serifRegular, textAlign: 'right', lineHeight: 32, writingDirection: 'rtl' },
});
