import * as BackgroundFetch from 'expo-background-fetch';
import * as TaskManager     from 'expo-task-manager';
import { initDatabase, getAllPositions, updatePositionPrice } from '../services/database';
import { getBatchPrices }   from '../services/marketData';
import { marketCalendar }   from '../services/marketCalendarService';
import {
  fireTargetNotification,
  fireStopLossNotification,
} from '../services/notifications';
import { PositionStatus } from '../types';

const TASK_NAME      = 'ALGOPULSE_POSITION_MONITOR';
const IST_OFFSET_MIN = 330;
const MARKET_OPEN    = 555;  // 09:15 IST (minutes from midnight)
const MARKET_CLOSE   = 930;  // 15:30 IST

function currentISTMinutes(): number {
  const now = new Date();
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + IST_OFFSET_MIN) % (24 * 60);
}

function isMarketHours(): boolean {
  const ist = currentISTMinutes();
  return ist >= MARKET_OPEN && ist <= MARKET_CLOSE;
}

function deriveStatus(pnl: number, current: number, target: number): PositionStatus {
  if (current >= target)        return 'Target hit';
  if (current >= target * 0.95) return 'Near Target';
  if (pnl < -3)                 return 'Drawdown';
  return 'Tracking';
}

TaskManager.defineTask(TASK_NAME, async () => {
  try {
    if (!isMarketHours()) return BackgroundFetch.BackgroundFetchResult.NoData;
    if (!await marketCalendar.isMarketOpen()) return BackgroundFetch.BackgroundFetchResult.NoData;

    await initDatabase();
    const positions = await getAllPositions();
    if (positions.length === 0) return BackgroundFetch.BackgroundFetchResult.NoData;

    const tickers  = positions.map(p => p.ticker);
    const priceMap = await getBatchPrices(tickers);

    let fired = false;

    for (const pos of positions) {
      const price = priceMap[pos.ticker];
      if (!price || price <= 0) continue;

      const pnl    = Math.round(((price - pos.entry) / pos.entry) * 10000) / 100;
      const status = deriveStatus(pnl, price, pos.target);

      await updatePositionPrice(pos.ticker, price, pnl, status).catch(() => {});

      if (status === 'Target hit' && pos.status !== 'Target hit') {
        await fireTargetNotification(pos.ticker, pos.name, price).catch(() => {});
        fired = true;
      }
      if (status === 'Drawdown' && pos.status !== 'Drawdown') {
        await fireStopLossNotification(pos.ticker, pos.name, price).catch(() => {});
        fired = true;
      }
    }

    return fired
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export async function registerPositionMonitorTask(): Promise<void> {
  const status = await BackgroundFetch.getStatusAsync();
  const unavailable =
    status === BackgroundFetch.BackgroundFetchStatus.Restricted ||
    status === BackgroundFetch.BackgroundFetchStatus.Denied;
  if (unavailable) return;

  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (isRegistered) return;

  await BackgroundFetch.registerTaskAsync(TASK_NAME, {
    minimumInterval: 15 * 60,
    stopOnTerminate: false,
    startOnBoot:     true,
  });
}

export async function unregisterPositionMonitorTask(): Promise<void> {
  const isRegistered = await TaskManager.isTaskRegisteredAsync(TASK_NAME);
  if (isRegistered) await BackgroundFetch.unregisterTaskAsync(TASK_NAME);
}
