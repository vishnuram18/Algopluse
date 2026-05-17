import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  SourceSerif4_400Regular,
  SourceSerif4_500Medium,
  SourceSerif4_600SemiBold,
} from '@expo-google-fonts/source-serif-4';
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_500Medium,
} from '@expo-google-fonts/jetbrains-mono';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { initDatabase } from '../services/database';
import { useAppStore } from '../store/useAppStore';
import { requestPermissions } from '../services/notifications';
import { liveDayTradeScanner } from '../services/liveDayTradeScanner';
import { registerDayTradeScanTask } from '../tasks/dayTradeScanTask';
import 'react-native-reanimated';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    SourceSerif4_400Regular,
    SourceSerif4_500Medium,
    SourceSerif4_600SemiBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });

  const loadPositions = useAppStore(s => s.loadPositions);

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  useEffect(() => {
    if (!fontsLoaded) return;

    initDatabase()
      .then(loadPositions)
      .catch(() => {})
      .finally(() => {
        SplashScreen.hideAsync();
        // Kick off scanner and notifications after DB is ready — fire and forget
        requestPermissions()
          .then(granted => {
            if (!granted) return;
            registerDayTradeScanTask().catch(() => {});
            liveDayTradeScanner.start();
          })
          .catch(() => {});
      });
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" backgroundColor="#FBF9F6" translucent={false} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
      </Stack>
    </GestureHandlerRootView>
  );
}
