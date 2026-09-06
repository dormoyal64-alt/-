import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';
import { fonts, UI_FONT_SIZES } from '@/theme/typography';

interface Props {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  loading?: boolean;
  size?: 'large' | 'medium';
}

export function PrimaryButton({
  title,
  onPress,
  variant = 'primary',
  disabled,
  loading,
  size = 'medium',
}: Props) {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);

  const bg =
    variant === 'primary' ? colors.primary : variant === 'secondary' ? colors.surfaceAlt : 'transparent';
  const fg = variant === 'primary' ? colors.primaryText : colors.primary;
  const borderColor = variant === 'ghost' ? colors.border : 'transparent';

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.base,
        size === 'large' && styles.large,
        { backgroundColor: bg, borderColor, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.text, size === 'large' && styles.textLarge, { color: fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  large: {
    paddingVertical: 20,
    borderRadius: 20,
  },
  text: {
    fontFamily: fonts.sansBold,
    fontSize: UI_FONT_SIZES.body,
  },
  textLarge: {
    fontSize: UI_FONT_SIZES.title,
  },
});
