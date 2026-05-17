import {
  getTradingCalendarEntry,
  upsertTradingCalendarEntry,
  deleteTradingCalendarEntry,
  getUpcomingTradingCalendar,
} from './database';
import { CalendarEntry, CalendarEntryType } from '../types';

// ── IST helpers ───────────────────────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowIST(): Date {
  return new Date(Date.now() + IST_OFFSET_MS);
}

function todayIST(): string {
  return nowIST().toISOString().split('T')[0];   // YYYY-MM-DD
}

// Market window: 09:15 – 15:30 IST
const OPEN_H  = 9;  const OPEN_M  = 15;
const CLOSE_H = 15; const CLOSE_M = 30;

function isWithinMarketHours(): boolean {
  const ist = nowIST();
  const h   = ist.getUTCHours();
  const m   = ist.getUTCMinutes();
  const now = h * 60 + m;
  return now >= OPEN_H * 60 + OPEN_M && now < CLOSE_H * 60 + CLOSE_M;
}

function isWeekday(): boolean {
  const day = nowIST().getUTCDay();   // 0 = Sun, 6 = Sat
  return day >= 1 && day <= 5;
}

// ── Service ───────────────────────────────────────────────────────────────────

class MarketCalendarService {
  /**
   * Full market-open check:
   * 1. Must be within 09:15–15:30 IST.
   * 2. If today is marked HOLIDAY  → closed (even on a weekday).
   * 3. If today is SPECIAL_TRADING → open  (even on a weekend).
   * 4. Otherwise: open only on Mon–Fri.
   */
  async isMarketOpen(): Promise<boolean> {
    if (!isWithinMarketHours()) return false;

    try {
      const entry = await getTradingCalendarEntry(todayIST());
      if (entry?.type === 'HOLIDAY')          return false;
      if (entry?.type === 'SPECIAL_TRADING')  return true;
    } catch {
      // DB not ready (e.g. early background wake) — fall through to weekday check
    }

    return isWeekday();
  }

  /** True only during market hours, regardless of holiday/special status. */
  isWithinMarketHours(): boolean {
    return isWithinMarketHours();
  }

  todayIST(): string {
    return todayIST();
  }

  // ── Calendar CRUD ───────────────────────────────────────────────────────────

  async markHoliday(date: string, label: string): Promise<void> {
    await upsertTradingCalendarEntry({ date, type: 'HOLIDAY', label });
  }

  async markSpecialTradingDay(date: string, label: string): Promise<void> {
    await upsertTradingCalendarEntry({ date, type: 'SPECIAL_TRADING', label });
  }

  async clearOverride(date: string): Promise<void> {
    await deleteTradingCalendarEntry(date);
  }

  async getTodayEntry(): Promise<CalendarEntry | null> {
    return getTradingCalendarEntry(todayIST());
  }

  /** Returns entries from today onwards, ordered by date asc. */
  async getUpcoming(limit = 10): Promise<CalendarEntry[]> {
    return getUpcomingTradingCalendar(todayIST(), limit);
  }
}

export const marketCalendar = new MarketCalendarService();
