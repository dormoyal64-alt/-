import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';

interface Option<T extends string> {
  value: T;
  label: string;
  description?: string;
}

export function OptionPicker<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);

  return (
    <View style={styles.wrap}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={[
              styles.option,
              {
                backgroundColor: selected ? colors.primary : colors.surfaceAlt,
                borderColor: selected ? colors.primary : colors.border,
              },
            ]}
          >
            <Text style={[styles.optionLabel, { color: selected ? colors.primaryText : colors.text }]}>
              {opt.label}
            </Text>
            {opt.description ? (
              <Text
                style={[
                  styles.optionDesc,
                  { color: selected ? colors.primaryText : colors.textMuted },
                ]}
              >
                {opt.description}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginBottom: 16 },
  option: { borderRadius: 14, borderWidth: 1, padding: 12 },
  optionLabel: { fontFamily: fonts.sansMedium, fontSize: UI_FONT_SIZES.body, textAlign: 'right' },
  optionDesc: { fontFamily: fonts.sansRegular, fontSize: UI_FONT_SIZES.caption, textAlign: 'right', marginTop: 4 },
});
