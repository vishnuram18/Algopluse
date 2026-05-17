import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager     from 'expo-task-manager';
import { liveDayTradeScanner } from '../services/liveDayTradeScanner';

// iOS throttles background fetch to a system-determined interval (≥ 15 min).
// Android honours the minimumInterval more closely.
const TASK_NAME = 'ALGOPULSE_DAY_TRADE_SCAN';

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    const signals = await liveDayTradeScanner.scanForDayTrades();
    return signals.length > 0
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

/** Call once from app startup (after permissions are granted). */
export async function registerDayTradeScanTask(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  const unavailable =
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied;

  if (unavailable) {
    console.warn('[BackgroundFetch] Not available on this device/OS config.');
    return;
  }

  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (isRegistered) return;

  await BackgroundFetch.registerTaskAsync(TASK_NAME, {
    minimumInterval: 5 * 60,   // 5 minutes (iOS may override to ≥ 15 min)
    stopOnTerminate: false,    // keep running after app is killed (Android)
    startOnBoot:     true,     // resume after device reboot (Android)
  });
}

export async function unregisterDayTradeScanTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (isRegistered) await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
}
