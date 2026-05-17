import React, { useState } from 'react';
import {
  View, Text, Pressable, StyleSheet, SafeAreaView,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { Colors, Fonts, Radii, Space } from '../theme/tokens';
import { signInWithGoogle } from '../services/authService';
import { useAppStore } from '../store/useAppStore';

export default function LoginScreen() {
  const setUserProfile = useAppStore(s => s.setUserProfile);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const handleSignIn = async () => {
    setError(null);
    setLoading(true);
    try {
      const profile = await signInWithGoogle();
      setUserProfile(profile);
      router.replace('/(tabs)');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.container}>

        {/* Branding */}
        <View style={s.brand}>
          <View style={s.logoMark}>
            <Text style={s.logoChar}>A</Text>
          </View>
          <Text style={s.wordmark}>AlgoPulse</Text>
          <Text style={s.tagline}>Your personal NSE intelligence agent</Text>
        </View>

        {/* Feature pills */}
        <View style={s.features}>
          {[
            'RSI + SMA200 strategy engine',
            'Claude AI verdict on every stock',
            'Telegram alerts · Drive backup',
          ].map(f => (
            <View key={f} style={s.featurePill}>
              <View style={s.featureDot} />
              <Text style={s.featureText}>{f}</Text>
            </View>
          ))}
        </View>

        {/* Sign-in card */}
        <View style={s.card}>
          <Text style={s.cardTitle}>Sign in to continue</Text>
          <Text style={s.cardSub}>
            Your portfolio and Drive backup are tied to your Google account.
            Each account gets its own private space — no data is shared.
          </Text>

          {error && <Text style={s.errorText}>{error}</Text>}

          <Pressable
            style={[s.googleBtn, loading && s.googleBtnDisabled]}
            onPress={handleSignIn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={Colors.ink} />
            ) : (
              <>
                {/* Google "G" mark — plain coloured text fallback */}
                <Text style={s.googleG}>G</Text>
                <Text style={s.googleBtnText}>Sign in with Google</Text>
              </>
            )}
          </Pressable>

          <Pressable style={s.skipBtn} onPress={() => router.replace('/(tabs)')}>
            <Text style={s.skipText}>Skip for now · no Drive backup</Text>
          </Pressable>

          <Text style={s.disclaimer}>
            AlgoPulse only requests access to its own hidden app folder on Drive.
            It cannot read or modify any other files in your Google Drive.
          </Text>
        </View>

      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.canvas },
  container: { flex: 1, paddingHorizontal: Space.xl, justifyContent: 'center', gap: 32 },

  // Branding
  brand:     { alignItems: 'center', gap: 10 },
  logoMark:  { width: 64, height: 64, borderRadius: 16, backgroundColor: Colors.accent,
               alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  logoChar:  { fontFamily: Fonts.serifSemiBold, fontSize: 32, color: '#fff' },
  wordmark:  { fontFamily: Fonts.serifMedium, fontSize: 28, color: Colors.ink, letterSpacing: -0.5 },
  tagline:   { fontFamily: Fonts.mono, fontSize: 12, color: Colors.muted, letterSpacing: 0.3 },

  // Feature list
  features:    { gap: 8 },
  featurePill: { flexDirection: 'row', alignItems: 'center', gap: 10,
                 backgroundColor: Colors.raised, borderRadius: Radii.sm,
                 paddingHorizontal: 14, paddingVertical: 9 },
  featureDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  featureText: { fontFamily: Fonts.mono, fontSize: 11.5, color: Colors.ink },

  // Card
  card:      { borderWidth: 1, borderColor: Colors.hair, borderRadius: Radii.card,
               padding: Space.lg, gap: 12 },
  cardTitle: { fontFamily: Fonts.serifMedium, fontSize: 18, color: Colors.ink },
  cardSub:   { fontSize: 13, color: Colors.muted, lineHeight: 19 },
  errorText: { fontSize: 12, color: Colors.danger, lineHeight: 17 },

  // Google button
  googleBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                       gap: 10, backgroundColor: Colors.raised, borderWidth: 1,
                       borderColor: Colors.hairStrong, borderRadius: Radii.md,
                       paddingVertical: 13, marginTop: 4 },
  googleBtnDisabled: { opacity: 0.5 },
  googleG:           { fontFamily: Fonts.serifSemiBold, fontSize: 18,
                       color: '#4285F4' },           // Google blue
  googleBtnText:     { fontFamily: Fonts.mono, fontSize: 13, color: Colors.ink },

  skipBtn:    { alignItems: 'center', paddingVertical: 6 },
  skipText:   { fontFamily: Fonts.mono, fontSize: 11, color: Colors.muted2,
                textDecorationLine: 'underline' },
  disclaimer: { fontSize: 10.5, color: Colors.muted2, lineHeight: 15, textAlign: 'center' },
});
