import { Redirect } from 'expo-router';
import { View } from 'react-native';
import { useAppStore } from '../store/useAppStore';

export default function Index() {
  const sessionReady = useAppStore(s => s.sessionReady);
  const userProfile  = useAppStore(s => s.userProfile);

  // _layout.tsx sets sessionReady=true only after initDatabase() + auth check.
  // Show blank while waiting so no tab screen tries to hit the DB early.
  if (!sessionReady) return <View style={{ flex: 1 }} />;

  return <Redirect href={userProfile ? '/(tabs)' : '/login'} />;
}
