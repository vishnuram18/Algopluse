/**
 * Google Drive appDataFolder backup service.
 *
 * Setup checklist (one-time, in Google Cloud Console):
 *  1. Enable "Google Drive API" for your project.
 *  2. OAuth consent screen → add scope: .../auth/drive.appdata
 *  3. Create OAuth 2.0 Client IDs:
 *       Android → package: com.algopulse.mobile  (needs SHA-1 debug fingerprint)
 *       iOS     → bundle:  com.algopulse.mobile
 *  4. Add to .env:
 *       EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID=<android-client-id>.apps.googleusercontent.com
 *       EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS=<ios-client-id>.apps.googleusercontent.com
 *
 * The appDataFolder is invisible in the user's Drive UI — no clutter.
 */

import * as AuthSession  from 'expo-auth-session';
import * as SecureStore  from 'expo-secure-store';
import * as WebBrowser   from 'expo-web-browser';
import { Platform }      from 'react-native';
import {
  getAllPositions,
  getCandidatesCache,
  savePosition,
  saveCandidatesCache,
  upsertTradingCalendarEntry,
  getUpcomingTradingCalendar,
} from './database';
import { CalendarEntry } from '../types';

WebBrowser.maybeCompleteAuthSession();

// ── Config ────────────────────────────────────────────────────────────────────

const CLIENT_ID =
  Platform.OS === 'android'
    ? (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID ?? '')
    : (process.env.EXPO_PUBLIC_GOOGLE_CLIENT_ID_IOS     ?? '');

const SCOPES          = ['https://www.googleapis.com/auth/drive.appdata'];
const BACKUP_FILENAME = 'sync_backup.json';
const SECURE_KEY      = 'algopulse_google_tokens';

// ── Token management ──────────────────────────────────────────────────────────

interface TokenSet {
  accessToken:  string;
  refreshToken: string | null;
  expiresAt:    number;   // epoch ms
}

async function loadTokens(): Promise<TokenSet | null> {
  try {
    const raw = await SecureStore.getItemAsync(SECURE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function saveTokens(tokens: TokenSet): Promise<void> {
  await SecureStore.setItemAsync(SECURE_KEY, JSON.stringify(tokens));
}

async function refreshAccessToken(refreshToken: string): Promise<TokenSet | null> {
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
    const json = await res.json();
    const tokens: TokenSet = {
      accessToken:  json.access_token,
      refreshToken: json.refresh_token ?? refreshToken,
      expiresAt:    Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    await saveTokens(tokens);
    return tokens;
  } catch { return null; }
}

// Returns a valid access token, silently refreshing if needed.
async function getAccessToken(): Promise<string | null> {
  let tokens = await loadTokens();
  if (!tokens) return null;

  if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken;

  if (tokens.refreshToken) {
    const refreshed = await refreshAccessToken(tokens.refreshToken);
    return refreshed?.accessToken ?? null;
  }
  return null;
}

// ── OAuth sign-in ─────────────────────────────────────────────────────────────

export async function signInWithGoogle(): Promise<boolean> {
  if (!CLIENT_ID) {
    throw new Error(
      'Google OAuth client ID not set.\n' +
      'Add EXPO_PUBLIC_GOOGLE_CLIENT_ID_ANDROID / _IOS to your .env file.'
    );
  }

  const discovery = await AuthSession.fetchDiscoveryAsync(
    'https://accounts.google.com'
  );

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'algopulsemobile' });

  const request = new AuthSession.AuthRequest({
    clientId:            CLIENT_ID,
    scopes:              SCOPES,
    redirectUri,
    responseType:        AuthSession.ResponseType.Code,
    usePKCE:             true,
    extraParams:         { access_type: 'offline', prompt: 'consent' },
  });

  const result = await request.promptAsync(discovery);
  if (result.type !== 'success') return false;

  // Exchange code for tokens
  const tokenRes = await AuthSession.exchangeCodeAsync(
    {
      clientId:    CLIENT_ID,
      redirectUri,
      code:        result.params.code,
      extraParams: { code_verifier: request.codeVerifier! },
    },
    discovery
  );

  await saveTokens({
    accessToken:  tokenRes.accessToken,
    refreshToken: tokenRes.refreshToken ?? null,
    expiresAt:    Date.now() + (tokenRes.expiresIn ?? 3600) * 1000,
  });

  return true;
}

export async function signOut(): Promise<void> {
  await SecureStore.deleteItemAsync(SECURE_KEY);
}

export async function isSignedIn(): Promise<boolean> {
  const tokens = await loadTokens();
  return tokens !== null;
}

// ── Drive helpers ─────────────────────────────────────────────────────────────

async function driveRequest(
  path: string,
  options: RequestInit,
  accessToken: string,
): Promise<Response> {
  return fetch(`https://www.googleapis.com${path}`, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string> ?? {}),
      Authorization: `Bearer ${accessToken}`,
    },
  });
}

async function findBackupFileId(accessToken: string): Promise<string | null> {
  const res = await driveRequest(
    `/drive/v3/files?spaces=appDataFolder&q=name='${BACKUP_FILENAME}'&fields=files(id)`,
    { method: 'GET' },
    accessToken,
  );
  if (!res.ok) return null;
  const json = await res.json();
  return (json.files as { id: string }[])[0]?.id ?? null;
}

async function uploadFile(
  accessToken: string,
  content: string,
  existingFileId?: string | null,
): Promise<void> {
  const metadata = JSON.stringify({
    name:    BACKUP_FILENAME,
    parents: existingFileId ? undefined : ['appDataFolder'],
  });

  const boundary = '---algopulse_boundary';
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    metadata,
    `--${boundary}`,
    'Content-Type: application/json',
    '',
    content,
    `--${boundary}--`,
  ].join('\r\n');

  const url = existingFileId
    ? `/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
    : `/upload/drive/v3/files?uploadType=multipart`;

  const method = existingFileId ? 'PATCH' : 'POST';

  const res = await driveRequest(url, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  }, accessToken);

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Drive upload failed (${res.status}): ${err}`);
  }
}

// ── Backup payload ────────────────────────────────────────────────────────────

interface BackupPayload {
  version:         number;
  backedUpAt:      string;  // ISO timestamp
  positions:       unknown[];
  calendarEntries: CalendarEntry[];
  candidatesCache: string | null;  // raw JSON string as stored in DB
}

async function buildPayload(): Promise<BackupPayload> {
  const [positions, calendar, candidatesRaw] = await Promise.all([
    getAllPositions(),
    getUpcomingTradingCalendar('2000-01-01', 1000),  // all entries
    getCandidatesCache(),
  ]);

  return {
    version:         1,
    backedUpAt:      new Date().toISOString(),
    positions,
    calendarEntries: calendar,
    candidatesCache: candidatesRaw?.json ?? null,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Upload current portfolio + calendar + scout cache to Drive. */
export async function backupToDrive(): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Not signed in to Google.');

  const [payload, existingId] = await Promise.all([
    buildPayload(),
    findBackupFileId(accessToken),
  ]);

  await uploadFile(accessToken, JSON.stringify(payload, null, 2), existingId);
}

/** Pull latest backup from Drive and restore into local SQLite. */
export async function restoreFromDrive(): Promise<{ restored: number; message: string }> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Not signed in to Google.');

  const fileId = await findBackupFileId(accessToken);
  if (!fileId) throw new Error('No backup found in Drive.');

  const res = await driveRequest(
    `/drive/v3/files/${fileId}?alt=media`,
    { method: 'GET' },
    accessToken,
  );
  if (!res.ok) throw new Error(`Drive download failed (${res.status}).`);

  const payload: BackupPayload = await res.json();

  // Restore positions
  for (const pos of payload.positions as Parameters<typeof savePosition>[0][]) {
    await savePosition(pos).catch(() => {});
  }

  // Restore calendar overrides
  for (const entry of payload.calendarEntries) {
    await upsertTradingCalendarEntry(entry).catch(() => {});
  }

  // Restore scout cache
  if (payload.candidatesCache) {
    await saveCandidatesCache(payload.candidatesCache).catch(() => {});
  }

  return {
    restored: (payload.positions as unknown[]).length,
    message:  `Restored ${(payload.positions as unknown[]).length} positions from backup dated ${new Date(payload.backedUpAt).toLocaleDateString('en-IN')}.`,
  };
}
