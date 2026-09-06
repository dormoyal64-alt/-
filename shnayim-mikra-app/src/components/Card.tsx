import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: colors.surface, borderColor: colors.border, shadowColor: colors.cardShadow },
        style,
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 18,
    marginBottom: 16,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 8,
    elevation: 1,
  },
});
