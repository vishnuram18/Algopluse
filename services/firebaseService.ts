import { ScoutCandidate } from '../types';

const DB = process.env.EXPO_PUBLIC_FIREBASE_DB_URL ?? '';

export interface FirebaseScanResult {
  json:     string;  // JSON-stringified ScoutCandidate[]
  cachedAt: number;  // Unix ms
  source:   'cloud' | 'phone';
}

export async function getFirebaseScan(): Promise<FirebaseScanResult | null> {
  if (!DB) return null;
  try {
    const res = await fetch(`${DB}/scans/latest.json`, {
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.json || !data?.cachedAt) return null;
    return data as FirebaseScanResult;
  } catch {
    return null;
  }
}

export async function saveFirebaseScan(candidates: ScoutCandidate[]): Promise<void> {
  if (!DB) return;
  try {
    await fetch(`${DB}/scans/latest.json`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        json:     JSON.stringify(candidates),
        cachedAt: Date.now(),
        source:   'phone',
      }),
    });
  } catch { /* silent — local cache is source of truth */ }
}
