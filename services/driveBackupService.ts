/**
 * Google Drive appDataFolder backup/restore.
 * Auth is fully delegated to authService — this file only does Drive I/O.
 * appDataFolder is scoped to the signed-in Google account automatically,
 * so each user's backup is completely isolated.
 */

import { getAccessToken } from './authService';
import {
  getAllPositions,
  getCandidatesCache,
  savePosition,
  saveCandidatesCache,
  upsertTradingCalendarEntry,
  getUpcomingTradingCalendar,
} from './database';
import { CalendarEntry } from '../types';

const BACKUP_FILENAME = 'sync_backup.json';

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
  const json = await res.json() as { files: { id: string }[] };
  return json.files[0]?.id ?? null;
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

  const url    = existingFileId
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
  backedUpAt:      string;
  positions:       unknown[];
  calendarEntries: CalendarEntry[];
  candidatesCache: string | null;
}

async function buildPayload(): Promise<BackupPayload> {
  const [positions, calendar, candidatesRaw] = await Promise.all([
    getAllPositions(),
    getUpcomingTradingCalendar('2000-01-01', 1000),
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

export async function backupToDrive(): Promise<void> {
  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('Not signed in to Google.');

  const [payload, existingId] = await Promise.all([
    buildPayload(),
    findBackupFileId(accessToken),
  ]);

  await uploadFile(accessToken, JSON.stringify(payload, null, 2), existingId);
}

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

  const payload = await res.json() as BackupPayload;

  for (const pos of payload.positions as Parameters<typeof savePosition>[0][]) {
    await savePosition(pos).catch(() => {});
  }
  for (const entry of payload.calendarEntries) {
    await upsertTradingCalendarEntry(entry).catch(() => {});
  }
  if (payload.candidatesCache) {
    await saveCandidatesCache(payload.candidatesCache).catch(() => {});
  }

  const count = payload.positions.length;
  return {
    restored: count,
    message:  `Restored ${count} position${count !== 1 ? 's' : ''} from backup dated ${new Date(payload.backedUpAt).toLocaleDateString('en-IN')}.`,
  };
}
