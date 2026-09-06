import React from 'react';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useApp } from '@/hooks/AppProvider';
import { useThemeColors } from '@/hooks/useThemeColors';

function TabIcon({ symbol }: { symbol: string }) {
  return <Text style={{ fontSize: 20 }}>{symbol}</Text>;
}

export default function TabsLayout() {
  const { settings } = useApp();
  const colors = useThemeColors(settings.theme);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'בית', tabBarIcon: () => <TabIcon symbol="🏠" /> }}
      />
      <Tabs.Screen
        name="progress"
        options={{ title: 'ההתקדמות שלי', tabBarIcon: () => <TabIcon symbol="📈" /> }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ title: 'לוח שנה', tabBarIcon: () => <TabIcon symbol="📅" /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'הגדרות', tabBarIcon: () => <TabIcon symbol="⚙️" /> }}
      />
    </Tabs>
  );
}
