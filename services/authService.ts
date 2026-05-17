/**
 * Google OAuth2 — single source of truth for tokens and user profile.
 *
 * Required .env keys:
 *   EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID   (package: com.algopulse.mobile)
 *   EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS       (bundle:  com.algopulse.mobile)
 *
 * GCP Console checklist:
 *   1. Enable Google Drive API + Google People API (or userinfo endpoint)
 *   2. OAuth consent screen → scopes: openid, profile, email, drive.appdata
 *   3. Create Android client (SHA-1 fingerprint) + iOS client (bundle ID)
 */

import * as AuthSession from 'expo-auth-session';
import * as SecureStore  from 'expo-secure-store';
import * as WebBrowser   from 'expo-web-browser';
import { Platform }      from 'react-native';
import { UserProfile }   from '../store/useAppStore';

WebBrowser.maybeCompleteAuthSession();

// ── Config ────────────────────────────────────────────────────────────────────

const CLIENT_ID =
  Platform.OS === 'android'
    ? (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ?? '')
    : (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS     ?? '');

const SCOPES = [
  'openid',
  'profile',
  'email',
  'https://www.googleapis.com/auth/drive.appdata',
];

const TOKENS_KEY  = 'algopulse_google_tokens';
const PROFILE_KEY = 'algopulse_google_profile';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TokenSet {
  accessToken:  string;
  refreshToken: string | null;
  expiresAt:    number;   // epoch ms
}

// ── Secure storage helpers ────────────────────────────────────────────────────

async function loadTokens(): Promise<TokenSet | null> {
  try {
    const raw = await SecureStore.getItemAsync(TOKENS_KEY);
    return raw ? (JSON.parse(raw) as TokenSet) : null;
  } catch { return null; }
}

async function persistTokens(t: TokenSet): Promise<void> {
  await SecureStore.setItemAsync(TOKENS_KEY, JSON.stringify(t));
}

async function persistProfile(p: UserProfile): Promise<void> {
  await SecureStore.setItemAsync(PROFILE_KEY, JSON.stringify(p));
}

// ── Token refresh ─────────────────────────────────────────────────────────────

async function doRefresh(refreshToken: string): Promise<TokenSet | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method:  'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id:     CLIENT_ID,
        refresh_token: refreshToken,
        grant_type:    'refresh_token',
      }).toString(),
    });
    if (!res.ok) return null;
    const json = await res.json() as { access_token: string; refresh_token?: string; expires_in?: number };
    const tokens: TokenSet = {
      accessToken:  json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt:    Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    await persistTokens(tokens);
    return tokens;
  } catch { return null; }
}

// ── Public: token access ──────────────────────────────────────────────────────

/** Returns a valid access token, transparently refreshing if within 60 s of expiry. */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken;
  if (tokens.refreshToken) {
    const refreshed = await doRefresh(tokens.refreshToken);
    return refreshed?.accessToken ?? null;
  }
  return null;
}

// ── Google userinfo fetch ─────────────────────────────────────────────────────

async function fetchGoogleProfile(accessToken: string): Promise<UserProfile> {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error('Failed to fetch Google profile');
  const json = await res.json() as { name: string; email: string; picture: string };
  return { name: json.name, email: json.email, picture: json.picture };
}

// ── Public: sign in ───────────────────────────────────────────────────────────

export async function signInWithGoogle(): Promise<UserProfile> {
  if (!CLIENT_ID) {
    throw new Error(
      'Google OAuth Client ID not configured.\n\n' +
      'Add EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID (or _IOS) to your .env file.\n' +
      'Create credentials at console.cloud.google.com → APIs & Services → Credentials.'
    );
  }

  const discovery   = await AuthSession.fetchDiscoveryAsync('https://accounts.google.com');
  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'algopulsemobile' });

  const request = new AuthSession.AuthRequest({
    clientId:     CLIENT_ID,
    scopes:       SCOPES,
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE:      true,
    extraParams:  { access_type: 'offline', prompt: 'consent' },
  });

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success') throw new Error('Sign-in cancelled or failed.');

  const tokenRes = await AuthSession.exchangeCodeAsync(
    {
      clientId:    CLIENT_ID,
      redirectUri,
      code:        result.params.code,
      extraParams: { code_verifier: request.codeVerifier! },
    },
    discovery
  );

  const tokens: TokenSet = {
    accessToken:  tokenRes.accessToken,
    refreshToken: tokenRes.refreshToken ?? null,
    expiresAt:    Date.now() + (tokenRes.expiresIn ?? 3600) * 1000,
  };
  await persistTokens(tokens);

  const profile = await fetchGoogleProfile(tokens.accessToken);
  await persistProfile(profile);

  return profile;
}

// ── Public: session restore (call on app boot) ────────────────────────────────

/**
 * Restores a previously signed-in session.
 * Returns the user profile if a valid (or refreshable) token exists, null otherwise.
 */
export async function loadPersistedSession(): Promise<UserProfile | null> {
  const accessToken = await getAccessToken();
  if (!accessToken) return null;

  // Try to return cached profile first (fast path — avoids a network call on every boot)
  try {
    const raw = await SecureStore.getItemAsync(PROFILE_KEY);
    if (raw) return JSON.parse(raw) as UserProfile;
  } catch { /* fall through */ }

  // Profile not cached — re-fetch (e.g. after reinstall that kept tokens)
  try {
    const profile = await fetchGoogleProfile(accessToken);
    await persistProfile(profile);
    return profile;
  } catch { return null; }
}

// ── Public: sign out ──────────────────────────────────────────────────────────

export async function signOut(): Promise<void> {
  await Promise.allSettled([
    SecureStore.deleteItemAsync(TOKENS_KEY),
    SecureStore.deleteItemAsync(PROFILE_KEY),
  ]);
}

// ── Public: quick auth check ──────────────────────────────────────────────────

export async function isAuthenticated(): Promise<boolean> {
  const token = await getAccessToken();
  return token !== null;
}
