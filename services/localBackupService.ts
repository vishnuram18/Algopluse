import * as FileSystem from 'expo-file-system';
import * as Sharing    from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import {
  getAllPositions,
  savePosition,
  getAllCalendarEntries,
  upsertTradingCalendarEntry,
  getCandidatesCache,
  saveCandidatesCache,
} from './database';

const BACKUP_VERSION = 1;
const FILE_NAME      = `algopulse-backup-${new Date().toISOString().slice(0, 10)}.json`;

interface BackupPayload {
  version:          number;
  appName:          string;
  exportedAt:       string;
  positions:        unknown[];
  calendarEntries:  unknown[];
  candidatesCache:  string | null;
}

// ── Export ────────────────────────────────────────────────────────────────────

export async function exportBackup(): Promise<void> {
  const [positions, calendarEntries, cache] = await Promise.all([
    getAllPositions(),
    getAllCalendarEntries(),
    getCandidatesCache(),
  ]);

  const payload: BackupPayload = {
    version:         BACKUP_VERSION,
    appName:         'AlgoPulse',
    exportedAt:      new Date().toISOString(),
    positions,
    calendarEntries,
    candidatesCache: cache?.json ?? null,
  };

  const path = FileSystem.documentDirectory + FILE_NAME;
  await FileSystem.writeAsStringAsync(path, JSON.stringify(payload, null, 2), {
    encoding: FileSystem.EncodingType.UTF8,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) throw new Error('Sharing is not available on this device.');

  await Sharing.shareAsync(path, {
    mimeType:    'application/json',
    dialogTitle: 'Save AlgoPulse backup',
    UTI:         'public.json',
  });
}

// ── Import ────────────────────────────────────────────────────────────────────

export interface RestoreResult {
  positions: number;
  calendar:  number;
  message:   string;
}

export async function importBackup(): Promise<RestoreResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type:     'application/json',
    copyToCacheDirectory: true,
  });

  if (result.canceled) throw new Error('cancelled');

  const asset = result.assets[0];
  const raw   = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });

  let payload: BackupPayload;
  try {
    payload = JSON.parse(raw) as BackupPayload;
  } catch {
    throw new Error('Invalid backup file — could not parse JSON.');
  }

  if (payload.appName !== 'AlgoPulse' || payload.version !== BACKUP_VERSION) {
    throw new Error('This file is not a valid AlgoPulse backup.');
  }

  // Restore positions (INSERT OR REPLACE — keeps existing if same id)
  let posCount = 0;
  for (const pos of (payload.positions ?? []) as Parameters<typeof savePosition>[0][]) {
    await savePosition(pos).catch(() => {});
    posCount++;
  }

  // Restore calendar overrides
  let calCount = 0;
  for (const entry of (payload.calendarEntries ?? []) as Parameters<typeof upsertTradingCalendarEntry>[0][]) {
    await upsertTradingCalendarEntry(entry).catch(() => {});
    calCount++;
  }

  // Restore candidates cache
  if (payload.candidatesCache) {
    await saveCandidatesCache(payload.candidatesCache).catch(() => {});
  }

  return {
    positions: posCount,
    calendar:  calCount,
    message:   `Restored ${posCount} position${posCount !== 1 ? 's' : ''} and ${calCount} calendar override${calCount !== 1 ? 's' : ''}.`,
  };
}
