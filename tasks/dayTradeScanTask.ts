import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager     from 'expo-task-manager';
import * as Notifications   from 'expo-notifications';
import { initDatabase, getLastSyncAt } from '../services/database';
import { nseClient }        from '../services/nseDataClient';
import { runShortTerm }     from '../services/strategyEngine';

const TASK_NAME = 'ALGOPULSE_DAY_TRADE_SCAN';

// ── IST checkpoint windows ────────────────────────────────────────────────────
// expo-background-fetch wakes the app at OS-determined intervals — it cannot
// fire at exact clock times. Instead, each wake-up checks whether we are
// within ±15 min of a desired checkpoint AND whether the foreground scanner
// has gone silent (last_sync_at is stale). If both are true, the phone runs
// its own scan independently.
//
// IST = UTC + 5h 30m = UTC + 330 min
//
// Checkpoints (IST minutes from midnight):
//   09:15 → 555    12:30 → 750    15:30 → 930

const IST_OFFSET_MIN  = 330;
const CHECKPOINTS_IST = [555, 750, 930]; // minutes from midnight IST
const WINDOW_MIN      = 15;              // ±15 minutes
const STALE_MS        = 35 * 60 * 1000; // foreground scanner considered offline after 35 min

function currentISTMinutes(): number {
  const now = new Date();
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MIN) % (24 * 60);
}

function isNearCheckpoint(): boolean {
  const ist = currentISTMinutes();
  return CHECKPOINTS_IST.some(cp => Math.abs(ist - cp) <= WINDOW_MIN);
}

// ── Fail-safe scan ────────────────────────────────────────────────────────────

async function runFailSafe(): Promise<boolean> {
  const signals = await runShortTerm();
  if (signals.length === 0) return false;

  for (const sig of signals) {
    const label = sig.trigger === 'RSI_OVERSOLD_VOLUME'
      ? `RSI ${sig.rsi?.toFixed(1)} · Vol ${sig.volumeRatio?.toFixed(1)}x`
      : `Above SMA200 · ₹${sig.price.toFixed(2)}`;

    await Notifications.scheduleNotificationAsync({
      content: {
        title: `📡 Fail-Safe: ${sig.ticker} Buy Setup`,
        body:  `${sig.strategy === 'SHORT_TERM' ? 'Short-term' : 'Long-term'} signal · ${label}`,
        sound: 'default',
        data:  { ticker: sig.ticker, signal: sig.trigger },
      },
      trigger: null,
    }).catch(() => {});
  }

  return true;
}

// ── Task definition ───────────────────────────────────────────────────────────

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    await initDatabase();

    // Only act near the three IST checkpoints
    if (!isNearCheckpoint()) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Check if the foreground scanner is still alive
    const lastSync = await getLastSyncAt();
    const isStale  = Date.now() - lastSync > STALE_MS;

    if (!isStale) {
      // Foreground scanner is running — nothing to do
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }

    // Foreground is off — phone takes over
    await nseClient.establishSession();
    const foundSignals = await runFailSafe();

    return foundSignals
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ── Registration helpers ──────────────────────────────────────────────────────

export async function registerDayTradeScanTask(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  const unavailable =
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied;

  if (unavailable) {
    console.warn('[BackgroundFetch] Not available on this device.');
    return;
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (isRegistered) return;

  await BackgroundFetch.registerTaskAsync(TASK_NAME, {
    minimumInterval: 15 * 60,  // 15 min — iOS may further throttle this
    stopOnTerminate: false,
    startOnBoot:     true,
  });
}

export async function unregisterDayTradeScanTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (isRegistered) await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
}
