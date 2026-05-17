import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { loadPersistedSession } from '../services/authService';
import { useAppStore } from '../store/useAppStore';

export default function Index() {
  const [checked, setChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const setUserProfile = useAppStore(s => s.setUserProfile);

  useEffect(() => {
    loadPersistedSession()
      .then(profile => {
        if (profile) {
          setUserProfile(profile);
          setAuthed(true);
        }
      })
      .catch(() => {})
      .finally(() => setChecked(true));
  }, []);

  if (!checked) return <View style={{ flex: 1 }} />;
  return <Redirect href={authed ? '/(tabs)' : '/login'} />;
}
