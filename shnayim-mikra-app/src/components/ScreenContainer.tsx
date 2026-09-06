import React from 'react';
import { ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';

interface Props {
  children: React.ReactNode;
  scroll?: boolean;
  style?: ViewStyle;
  contentContainerStyle?: ViewStyle;
}

export function ScreenContainer({ children, scroll = true, style, contentContainerStyle }: Props) {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);
  const Container = scroll ? ScrollView : View;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.background }]} edges={['top', 'bottom']}>
      <Container
        style={scroll ? undefined : [styles.flex, style]}
        contentContainerStyle={
          scroll ? [styles.content, contentContainerStyle] : undefined
        }
      >
        {children}
      </Container>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  content: { padding: 20, paddingBottom: 40, flexGrow: 1 },
});
