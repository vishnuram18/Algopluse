import React, { useState, useEffect } from 'react';
import {
  View, Text, Pressable, StyleSheet, SafeAreaView,
  ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { router } from 'expo-router';
import { Colors, Fonts, Radii, Space } from '../theme/tokens';
import {
  isSetup, createAccount, verifyPassword,
  isBiometricsAvailable, loginWithBiometrics, loadSession,
} from '../services/localAuthService';
import { importBackup } from '../services/localBackupService';
import { useAppStore } from '../store/useAppStore';

type Mode = 'checking' | 'create' | 'login';

export default function LoginScreen() {
  const setUserProfile = useAppStore(s => s.setUserProfile);

  const [mode,            setMode]            = useState<Mode>('checking');
  const [username,        setUsername]        = useState('');
  const [password,        setPassword]        = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword,    setShowPassword]    = useState(false);
  const [hasBiometrics,   setHasBiometrics]   = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState<string | null>(null);

  useEffect(() => {
    async function boot() {
      const setup      = await isSetup().catch(() => false);
      const biometrics = await isBiometricsAvailable().catch(() => false);
      setHasBiometrics(biometrics);

      if (!setup) {
        setMode('create');
        return;
      }

      setMode('login');
      if (biometrics) tryBiometrics();
    }
    boot();
  }, []);

  async function tryBiometrics() {
    try {
      const ok = await loginWithBiometrics();
      if (ok) enterApp();
      else    setShowPassword(true);
    } catch {
      setShowPassword(true);
    }
  }

  async function enterApp() {
    const profile = await loadSession().catch(() => null);
    setUserProfile(profile ?? { name: 'User', email: '', picture: '' });
    router.replace('/(tabs)');
  }

  async function handleCreate() {
    setError(null);
    const u = username.trim();
    const p = password;
    const c = confirmPassword;

    if (!u)          return setError('Username is required.');
    if (u.length < 2) return setError('Username must be at least 2 characters.');
    if (!p)          return setError('Password is required.');
    if (p.length < 4) return setError('Password must be at least 4 characters.');
    if (p !== c)     return setError('Passwords do not match.');

    setLoading(true);
    try {
      await createAccount(u, p);
      setUserProfile({ name: u, email: '', picture: '' });
      router.replace('/(tabs)');
    } catch {
      setError('Failed to create account. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasswordLogin() {
    setError(null);
    if (!password) return setError('Enter your password.');
    setLoading(true);
    try {
      const ok = await verifyPassword(password);
      if (!ok) {
        setError('Incorrect password.');
      } else {
        await enterApp();
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleImport() {
    setError(null);
    setLoading(true);
    try {
      const result = await importBackup();
      if (result.credentialsRestored) {
        // Backup had credentials — switch to login mode
        setMode('login');
        if (hasBiometrics) tryBiometrics();
      } else {
        // Data restored but no credentials in backup — show message, stay on create
        setError('Data restored. Create an account below to secure it.');
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'cancelled') setError('Import failed: ' + msg);
    } finally {
      setLoading(false);
    }
  }

  if (mode === 'checking') {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'android' ? 24 : 0}
      >
        <ScrollView
          contentContainerStyle={s.container}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

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
              'Telegram alerts · Local backup',
            ].map(f => (
              <View key={f} style={s.featurePill}>
                <View style={s.featureDot} />
                <Text style={s.featureText}>{f}</Text>
              </View>
            ))}
          </View>

          {/* Auth card */}
          <View style={s.card}>
            <Text style={s.cardTitle}>
              {mode === 'create' ? 'Create your account' : 'Welcome back'}
            </Text>
            <Text style={s.cardSub}>
              {mode === 'create'
                ? 'Set a username and password to secure your data on this device.'
                : 'Your data is stored securely on this device.'}
            </Text>

            {error && <Text style={s.errorText}>{error}</Text>}

            {/* ── Create Account mode ── */}
            {mode === 'create' && (
              <>
                <TextInput
                  style={s.input}
                  placeholder="Username"
                  placeholderTextColor={Colors.muted2}
                  value={username}
                  onChangeText={setUsername}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="next"
                />
                <TextInput
                  style={s.input}
                  placeholder="Password"
                  placeholderTextColor={Colors.muted2}
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  returnKeyType="next"
                />
                <TextInput
                  style={s.input}
                  placeholder="Confirm password"
                  placeholderTextColor={Colors.muted2}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  returnKeyType="done"
                  onSubmitEditing={handleCreate}
                />
                <Pressable
                  style={[s.primaryBtn, loading && s.btnDisabled]}
                  onPress={handleCreate}
                  disabled={loading}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={s.primaryBtnText}>Create Account</Text>}
                </Pressable>

                <View style={s.dividerRow}>
                  <View style={s.dividerLine} />
                  <Text style={s.dividerText}>or</Text>
                  <View style={s.dividerLine} />
                </View>

                <Pressable
                  style={[s.importBtn, loading && s.btnDisabled]}
                  onPress={handleImport}
                  disabled={loading}
                >
                  <Text style={s.importBtnText}>Restore from backup</Text>
                </Pressable>
              </>
            )}

            {/* ── Login mode ── */}
            {mode === 'login' && (
              <>
                {hasBiometrics && !showPassword && (
                  <Pressable
                    style={[s.primaryBtn, loading && s.btnDisabled]}
                    onPress={tryBiometrics}
                    disabled={loading}
                  >
                    {loading
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={s.primaryBtnText}>☞  Use Fingerprint</Text>}
                  </Pressable>
                )}

                {(showPassword || !hasBiometrics) && (
                  <>
                    <TextInput
                      style={s.input}
                      placeholder="Password"
                      placeholderTextColor={Colors.muted2}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry
                      autoFocus
                      returnKeyType="done"
                      onSubmitEditing={handlePasswordLogin}
                    />
                    <Pressable
                      style={[s.primaryBtn, loading && s.btnDisabled]}
                      onPress={handlePasswordLogin}
                      disabled={loading}
                    >
                      {loading
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={s.primaryBtnText}>Login</Text>}
                    </Pressable>
                  </>
                )}

                {hasBiometrics && !showPassword && (
                  <Pressable style={s.secondaryBtn} onPress={() => setShowPassword(true)}>
                    <Text style={s.secondaryBtnText}>Use password instead</Text>
                  </Pressable>
                )}

                {showPassword && hasBiometrics && (
                  <Pressable style={s.secondaryBtn} onPress={() => { setShowPassword(false); tryBiometrics(); }}>
                    <Text style={s.secondaryBtnText}>Try fingerprint again</Text>
                  </Pressable>
                )}
              </>
            )}
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:      { flex: 1, backgroundColor: Colors.canvas },
  center:    { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { paddingHorizontal: Space.xl, paddingVertical: 48, gap: 28 },

  brand:     { alignItems: 'center', gap: 10 },
  logoMark:  { width: 64, height: 64, borderRadius: 16, backgroundColor: Colors.accent,
               alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  logoChar:  { fontFamily: Fonts.serifSemiBold, fontSize: 32, color: '#fff' },
  wordmark:  { fontFamily: Fonts.serifMedium, fontSize: 28, color: Colors.ink, letterSpacing: -0.5 },
  tagline:   { fontFamily: Fonts.mono, fontSize: 12, color: Colors.muted, letterSpacing: 0.3 },

  features:    { gap: 8 },
  featurePill: { flexDirection: 'row', alignItems: 'center', gap: 10,
                 backgroundColor: Colors.raised, borderRadius: Radii.sm,
                 paddingHorizontal: 14, paddingVertical: 9 },
  featureDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  featureText: { fontFamily: Fonts.mono, fontSize: 11.5, color: Colors.ink },

  card:      { borderWidth: 1, borderColor: Colors.hair, borderRadius: Radii.card,
               padding: Space.lg, gap: 12 },
  cardTitle: { fontFamily: Fonts.serifMedium, fontSize: 18, color: Colors.ink },
  cardSub:   { fontSize: 13, color: Colors.muted, lineHeight: 19 },
  errorText: { fontSize: 12, color: Colors.danger, lineHeight: 17 },

  input: {
    borderWidth: 1, borderColor: Colors.hairStrong, borderRadius: Radii.sm,
    paddingHorizontal: 12, paddingVertical: 11,
    fontFamily: Fonts.mono, fontSize: 13, color: Colors.ink,
    backgroundColor: Colors.raised,
  },

  primaryBtn:      { backgroundColor: Colors.accent, borderRadius: Radii.md,
                     paddingVertical: 13, alignItems: 'center', marginTop: 4 },
  btnDisabled:     { opacity: 0.5 },
  primaryBtnText:  { fontFamily: Fonts.mono, fontSize: 13, color: '#fff', fontWeight: '600' },

  secondaryBtn:     { alignItems: 'center', paddingVertical: 8 },
  secondaryBtnText: { fontFamily: Fonts.mono, fontSize: 11, color: Colors.muted2,
                      textDecorationLine: 'underline' },

  dividerRow:  { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.hair },
  dividerText: { fontFamily: Fonts.mono, fontSize: 11, color: Colors.muted2 },

  importBtn:     { borderWidth: 1, borderColor: Colors.hairStrong, borderRadius: Radii.md,
                   paddingVertical: 12, alignItems: 'center', backgroundColor: Colors.raised },
  importBtnText: { fontFamily: Fonts.mono, fontSize: 13, color: Colors.ink },
});
