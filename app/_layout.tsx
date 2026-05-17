import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Stack, router } from 'expo-router';
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
import { useEffect, useState } from 'react';
import { initDatabase } from '../services/database';
import { useAppStore } from '../store/useAppStore';
import { requestPermissions } from '../services/notifications';
import { liveDayTradeScanner } from '../services/liveDayTradeScanner';
import { registerDayTradeScanTask } from '../tasks/dayTradeScanTask';
import { loadPersistedSession } from '../services/authService';
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

  const loadPositions  = useAppStore(s => s.loadPositions);
  const setUserProfile = useAppStore(s => s.setUserProfile);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (fontError) throw fontError;
  }, [fontError]);

  useEffect(() => {
    if (!fontsLoaded) return;

    initDatabase()
      .then(loadPositions)
      .then(requestPermissions)
      .then(async (granted) => {
        if (granted) {
          registerDayTradeScanTask().catch(() => {});
          liveDayTradeScanner.start();
        }
        const profile = await loadPersistedSession().catch(() => null);
        if (profile) setUserProfile(profile);
        return profile;
      })
      .catch(() => null)
      .then((profile) => {
        SplashScreen.hideAsync();
        setReady(true);
        // Navigate after the Stack has mounted (next tick)
        setTimeout(() => {
          if (!profile) router.replace('/login');
        }, 0);
      });
  }, [fontsLoaded]);

  if (!fontsLoaded || !ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="dark" backgroundColor="#FBF9F6" translucent={false} />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="login" />
      </Stack>
    </GestureHandlerRootView>
  );
}
