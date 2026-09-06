import React from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';

export function SettingSwitchRow({
  label,
  description,
  value,
  onValueChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);
  return (
    <View style={styles.row}>
      <Switch value={value} onValueChange={onValueChange} trackColor={{ true: colors.primary }} />
      <View style={styles.textWrap}>
        <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
        {description ? <Text style={[styles.desc, { color: colors.textMuted }]}>{description}</Text> : null}
      </View>
    </View>
  );
}

export function SettingSectionTitle({ children }: { children: React.ReactNode }) {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);
  return <Text style={[styles.sectionTitle, { color: colors.primary }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row-reverse', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  textWrap: { flex: 1 },
  label: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.body, textAlign: 'right' },
  desc: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.caption, textAlign: 'right', marginTop: 2 },
  sectionTitle: {
    fontFamily: fonts.sansBold,
    fontSize: UI_FONT_SIZES.body,
    textAlign: 'right',
    marginTop: 20,
    marginBottom: 8,
  },
});
