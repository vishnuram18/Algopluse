import { nseClient, VolumeShocker } from './nseDataClient';
import { getSentimentCheck }        from './claudeAnalysisService';
import { sendDayTradeAlert, SignalType } from './telegramService';
import { setLastSyncAt } from './database';
import { marketCalendar } from './marketCalendarService';

const CLAUDE_KEY     = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';
const SCAN_INTERVAL  = 5 * 60 * 1000;   // 5 minutes
const COOLDOWN_MS    = 30 * 60 * 1000;  // don't re-alert same ticker within 30 min

// (market-open check delegated to marketCalendar.isMarketOpen() which reads
//  the trading_calendar DB table for holiday/special-trading overrides)

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DayTradeSignal {
  ticker:     string;
  signal:     SignalType;
  rsi:        number;
  ratio:      number;
  price:      number;
  note:       string;
  confidence: number;
  scannedAt:  number;  // epoch ms
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetch15mCloses(ticker: string): Promise<number[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(ticker)}.NS?interval=15m&range=5d`;

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return [];

  const data = await res.json();
  const raw: (number | null)[] =
    data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  return raw.filter((c): c is number => c !== null);
}

async function fetchCurrentPrice(ticker: string): Promise<number> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(ticker)}.NS?interval=1d&range=1d`;

  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return 0;
  const data = await res.json();
  return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;
}

// Wilder's smoothed RSI — identical algorithm to stockAnalysis.ts.
function calculateRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains   = changes.map(c => Math.max(c, 0));
  const losses  = changes.map(c => Math.max(-c, 0));

  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10;
}

function classifySignal(
  shocker: VolumeShocker,
  rsi: number,
): SignalType | null {
  const { ratio } = shocker;

  if (rsi < 35 && ratio >= 3) return 'BUY_CHEAP';
  if (rsi >= 45 && rsi <= 55 && ratio >= 5) return 'BUY_BREAKOUT';
  return null;
}

// ── Scanner ───────────────────────────────────────────────────────────────────

class LiveDayTradeScanner {
  private intervalId:    ReturnType<typeof setInterval> | null = null;
  private scanning       = false;
  private lastAlertedAt  = new Map<string, number>();  // ticker → epoch ms

  private isCoolingDown(ticker: string): boolean {
    const last = this.lastAlertedAt.get(ticker) ?? 0;
    return Date.now() - last < COOLDOWN_MS;
  }

  /**
   * One full scan cycle. Network calls for RSI run concurrently across
   * all candidate tickers so the cycle stays fast.
   * All I/O is async — the JS thread is never blocked.
   */
  async scanForDayTrades(): Promise<DayTradeSignal[]> {
    if (!await marketCalendar.isMarketOpen()) return [];
    if (this.scanning) return [];     // prevent overlapping scans
    this.scanning = true;

    const approved: DayTradeSignal[] = [];

    try {
      // 1. Fetch volume shockers from NSE (rate-limited internally by nseClient)
      const shockers = await nseClient.getVolumeShockers();

      // 2. Pre-filter: ratio ≥ 3x and not in cooldown
      const candidates = shockers.filter(
        s => s.ratio >= 3 && !this.isCoolingDown(s.symbol)
      );

      // 3. Fetch 15m RSI + current price for all candidates concurrently
      const enriched = await Promise.allSettled(
        candidates.map(async shocker => {
          const [closes, price] = await Promise.all([
            fetch15mCloses(shocker.symbol),
            fetchCurrentPrice(shocker.symbol),
          ]);
          const rsi = calculateRsi(closes);
          return { shocker, rsi, price };
        })
      );

      // 4. Apply trigger logic, then run Claude sentiment check
      const sentimentTasks = enriched
        .filter(r => r.status === 'fulfilled')
        .map(r => (r as PromiseFulfilledResult<typeof enriched[0] extends PromiseFulfilledResult<infer T> ? T : never>).value)
        .filter(({ rsi }) => rsi !== null)
        .flatMap(({ shocker, rsi, price }) => {
          const signal = classifySignal(shocker, rsi!);
          if (!signal) return [];
          return [{ shocker, rsi: rsi!, price, signal }];
        })
        .map(async ({ shocker, rsi, price, signal }) => {
          const sentiment = await getSentimentCheck(
            shocker.symbol, signal, rsi, shocker.ratio, price, CLAUDE_KEY
          );
          return { shocker, rsi, price, signal, sentiment };
        });

      const sentimentResults = await Promise.allSettled(sentimentTasks);

      // 5. Dispatch approved signals to Telegram
      for (const result of sentimentResults) {
        if (result.status !== 'fulfilled') continue;
        const { shocker, rsi, price, signal, sentiment } = result.value;

        if (!sentiment.approved) continue;

        const entry: DayTradeSignal = {
          ticker:     shocker.symbol,
          signal,
          rsi,
          ratio:      shocker.ratio,
          price,
          note:       sentiment.note,
          confidence: sentiment.confidence,
          scannedAt:  Date.now(),
        };

        this.lastAlertedAt.set(shocker.symbol, Date.now());
        approved.push(entry);

        // Fire-and-forget — don't let a Telegram failure break the scan loop
        sendDayTradeAlert(
          entry.ticker, entry.signal, entry.rsi,
          entry.ratio,  entry.price,  entry.note
        ).catch(err =>
          console.warn(`[Telegram] Failed to send alert for ${entry.ticker}:`, err)
        );
      }
    } catch (err) {
      console.warn('[LiveDayTradeScanner] Scan error:', err);
    } finally {
      setLastSyncAt(Date.now()).catch(() => {});
      this.scanning = false;
    }

    return approved;
  }

  /**
   * Starts the 5-minute recurring scan. Safe to call multiple times —
   * a running scanner is not restarted.
   *
   * Note: On iOS, expo-background-fetch caps background execution to
   * ~15 minutes minimum. The foreground interval (this method) runs at
   * exactly 5 minutes while the app is in the foreground.
   */
  start(onSignals?: (signals: DayTradeSignal[]) => void): void {
    if (this.intervalId) return;

    // Run immediately on start, then every 5 minutes
    this.scanForDayTrades().then(sigs => onSignals?.(sigs));

    this.intervalId = setInterval(() => {
      this.scanForDayTrades().then(sigs => {
        if (sigs.length > 0) onSignals?.(sigs);
      });
    }, SCAN_INTERVAL);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  get isRunning(): boolean {
    return this.intervalId !== null;
  }

  /** Clears the cooldown map so all tickers are eligible again. */
  resetCooldowns(): void {
    this.lastAlertedAt.clear();
  }
}

export const liveDayTradeScanner = new LiveDayTradeScanner();
