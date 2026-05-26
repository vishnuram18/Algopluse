import * as SecureStore from 'expo-secure-store';
import * as LocalAuthentication from 'expo-local-authentication';
import * as Crypto from 'expo-crypto';
import { UserProfile } from '../store/useAppStore';

const KEY_USERNAME = 'algopulse_username';
const KEY_HASH     = 'algopulse_password_hash';
const KEY_SALT     = 'algopulse_salt';
const KEY_SESSION  = 'algopulse_session_active';

async function sha256(message: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, message);
}

async function generateSalt(): Promise<string> {
  const bytes = await Crypto.getRandomBytesAsync(16);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function isSetup(): Promise<boolean> {
  const [u, h, s] = await Promise.all([
    SecureStore.getItemAsync(KEY_USERNAME),
    SecureStore.getItemAsync(KEY_HASH),
    SecureStore.getItemAsync(KEY_SALT),
  ]);
  return !!(u && h && s);
}

export async function createAccount(username: string, password: string): Promise<void> {
  const salt = await generateSalt();
  const hash = await sha256(password + salt);
  await Promise.all([
    SecureStore.setItemAsync(KEY_USERNAME, username),
    SecureStore.setItemAsync(KEY_HASH, hash),
    SecureStore.setItemAsync(KEY_SALT, salt),
    SecureStore.setItemAsync(KEY_SESSION, 'true'),
  ]);
}

export async function verifyPassword(password: string): Promise<boolean> {
  const [hash, salt] = await Promise.all([
    SecureStore.getItemAsync(KEY_HASH),
    SecureStore.getItemAsync(KEY_SALT),
  ]);
  if (!hash || !salt) return false;
  const computed = await sha256(password + salt);
  if (computed !== hash) return false;
  await SecureStore.setItemAsync(KEY_SESSION, 'true');
  return true;
}

export async function isBiometricsAvailable(): Promise<boolean> {
  const [hasHardware, isEnrolled] = await Promise.all([
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
  ]);
  return hasHardware && isEnrolled;
}

export async function loginWithBiometrics(): Promise<boolean> {
  const available = await isBiometricsAvailable();
  if (!available) return false;
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage:         'Authenticate to access AlgoPulse',
    disableDeviceFallback: true,
  });
  if (!result.success) return false;
  await SecureStore.setItemAsync(KEY_SESSION, 'true');
  return true;
}

export async function loadSession(): Promise<UserProfile | null> {
  const [session, username] = await Promise.all([
    SecureStore.getItemAsync(KEY_SESSION),
    SecureStore.getItemAsync(KEY_USERNAME),
  ]);
  if (session !== 'true' || !username) return null;
  return { name: username, email: '', picture: '' };
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_SESSION).catch(() => {});
}

export async function getStoredCredentials(): Promise<{ username: string; passwordHash: string; salt: string } | null> {
  const [username, passwordHash, salt] = await Promise.all([
    SecureStore.getItemAsync(KEY_USERNAME),
    SecureStore.getItemAsync(KEY_HASH),
    SecureStore.getItemAsync(KEY_SALT),
  ]);
  if (!username || !passwordHash || !salt) return null;
  return { username, passwordHash, salt };
}

export async function restoreCredentials(creds: { username: string; passwordHash: string; salt: string }): Promise<void> {
  await Promise.all([
    SecureStore.setItemAsync(KEY_USERNAME, creds.username),
    SecureStore.setItemAsync(KEY_HASH, creds.passwordHash),
    SecureStore.setItemAsync(KEY_SALT, creds.salt),
  ]);
  await SecureStore.deleteItemAsync(KEY_SESSION).catch(() => {});
}
