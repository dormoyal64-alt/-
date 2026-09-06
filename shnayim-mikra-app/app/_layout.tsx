import React, { useCallback, useEffect, useState } from 'react';
import { I18nManager } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts, FrankRuhlLibre_500Medium, FrankRuhlLibre_700Bold } from '@expo-google-fonts/frank-ruhl-libre';
import { Heebo_400Regular, Heebo_500Medium, Heebo_700Bold } from '@expo-google-fonts/heebo';
import * as Notifications from 'expo-notifications';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { AppProvider } from '@/hooks/AppProvider';

if (!I18nManager.isRTL) {
  I18nManager.allowRTL(true);
  I18nManager.forceRTL(true);
}

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    FrankRuhlLibre_500Medium,
    FrankRuhlLibre_700Bold,
    Heebo_400Regular,
    Heebo_500Medium,
    Heebo_700Bold,
  });
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (fontsLoaded) {
      setReady(true);
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded]);

  const handleResponse = useCallback(
    (response: Notifications.NotificationResponse) => {
      const data = response.notification.request.content.data as { screen?: string; date?: string };
      if (data?.screen === 'reading' && data.date) {
        router.push({ pathname: '/reading', params: { date: data.date } });
      }
    },
    [router]
  );

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener(handleResponse);
    return () => sub.remove();
  }, [handleResponse]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <AppProvider>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="onboarding" />
          <Stack.Screen name="reading" options={{ presentation: 'fullScreenModal' }} />
          <Stack.Screen name="about" />
          <Stack.Screen name="settings/notification-time" />
        </Stack>
      </AppProvider>
    </GestureHandlerRootView>
  );
}
