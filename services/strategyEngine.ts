import { nseClient } from './nseDataClient';
import { getSentimentCheck } from './claudeAnalysisService';
import { sendDayTradeAlert } from './telegramService';
import { useAppStore } from '../store/useAppStore';
import { NIFTY_500, PHONE_SCAN_UNIVERSE } from '../data/nifty500';

const CLAUDE_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';

// ── Types ─────────────────────────────────────────────────────────────────────

export type TriggerType = 'RSI_OVERSOLD_VOLUME' | 'ABOVE_SMA200';

export interface StrategySignal {
  ticker:      string;
  name:        string;
  strategy:    'SHORT_TERM' | 'LONG_TERM';
  trigger:     TriggerType;
  price:       number;
  rsi?:        number;
  sma200?:     number;
  volumeRatio?: number;
  isTracking:  boolean;   // true = already in the user's portfolio
}

// ── Shared fetch helpers ──────────────────────────────────────────────────────

const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

async function fetchCloses(
  ticker: string,
  interval: '15m' | '1d',
  range: string,
): Promise<number[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(ticker)}.NS?interval=${interval}&range=${range}`;
  try {
    const res  = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) return [];
    const data = await res.json();
    const raw: (number | null)[] =
      data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return raw.filter((c): c is number => c !== null);
  } catch { return []; }
}

async function fetchPrice(ticker: string): Promise<number> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(ticker)}.NS?interval=1d&range=1d`;
  try {
    const res  = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) return 0;
    const data = await res.json();
    return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;
  } catch { return 0; }
}

// Wilder's smoothed RSI
function calcRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const ch = closes.slice(1).map((c, i) => c - closes[i]);
  let ag = ch.slice(0, period).reduce((a, c) => a + Math.max(c, 0), 0) / period;
  let al = ch.slice(0, period).reduce((a, c) => a + Math.max(-c, 0), 0) / period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag * (period - 1) + Math.max(ch[i], 0)) / period;
    al = (al * (period - 1) + Math.max(-ch[i], 0)) / period;
  }
  if (al === 0) return 100;
  return Math.round((100 - 100 / (1 + ag / al)) * 10) / 10;
}

function calcSma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

// ── isTracking helper (reads Zustand store outside React) ─────────────────────

function trackedTickers(): Set<string> {
  return new Set(useAppStore.getState().positions.map(p => p.ticker));
}

// ── Short-term strategy ───────────────────────────────────────────────────────
// Source: NSE volume shockers → 15-min RSI filter
// Signal: RSI < 35 AND volume ≥ 3× average   →  BUY_CHEAP
//         RSI 45–55 AND volume ≥ 5× average   →  BUY_BREAKOUT (mapped to RSI_OVERSOLD_VOLUME)

export async function runShortTerm(): Promise<StrategySignal[]> {
  const tracking = trackedTickers();
  const shockers = await nseClient.getVolumeShockers();
  const candidates = shockers.filter(s => s.ratio >= 3);

  // Resolve stock name from Nifty 500 seed list
  const nameMap = Object.fromEntries(NIFTY_500.map(c => [c.ticker, c.name]));

  const results = await Promise.allSettled(
    candidates.map(async s => {
      const [closes, price] = await Promise.all([
        fetchCloses(s.symbol, '15m', '5d'),
        fetchPrice(s.symbol),
      ]);
      const rsi = calcRsi(closes);
      return { s, rsi, price };
    })
  );

  const signals: StrategySignal[] = [];

  for (const r of results) {
    if (r.status !== 'fulfilled' || r.value.rsi === null) continue;
    const { s, rsi, price } = r.value;

    const qualifies =
      (rsi < 35 && s.ratio >= 3) ||
      (rsi >= 45 && rsi <= 55 && s.ratio >= 5);

    if (!qualifies) continue;

    signals.push({
      ticker:      s.symbol,
      name:        nameMap[s.symbol] ?? s.symbol,
      strategy:    'SHORT_TERM',
      trigger:     'RSI_OVERSOLD_VOLUME',
      price,
      rsi,
      volumeRatio: s.ratio,
      isTracking:  tracking.has(s.symbol),
    });
  }

  return signals;
}

// ── Long-term strategy ────────────────────────────────────────────────────────
// Source: PHONE_SCAN_UNIVERSE (top 100 Nifty) → daily close vs 200-day SMA
// Signal: currentPrice > SMA200   →  ABOVE_SMA200

export async function runLongTerm(): Promise<StrategySignal[]> {
  const tracking = trackedTickers();
  const signals:  StrategySignal[] = [];

  // Process sequentially to avoid hammering Yahoo Finance
  for (const candidate of PHONE_SCAN_UNIVERSE) {
    try {
      const [closes, price] = await Promise.all([
        fetchCloses(candidate.ticker, '1d', '1y'),
        fetchPrice(candidate.ticker),
      ]);

      const sma200 = calcSma(closes, 200);
      if (sma200 === null || price <= 0) continue;

      if (price > sma200) {
        signals.push({
          ticker:    candidate.ticker,
          name:      candidate.name,
          strategy:  'LONG_TERM',
          trigger:   'ABOVE_SMA200',
          price,
          sma200:    Math.round(sma200 * 100) / 100,
          isTracking: tracking.has(candidate.ticker),
        });
      }
    } catch { continue; }
  }

  return signals;
}

// ── Full pipeline: detect → Claude → Telegram ────────────────────────────────

export async function runAndDispatch(): Promise<StrategySignal[]> {
  const [shortSignals, longSignals] = await Promise.all([
    runShortTerm(),
    runLongTerm(),
  ]);

  const all = [...shortSignals, ...longSignals];
  const approved: StrategySignal[] = [];

  await Promise.allSettled(
    all.map(async signal => {
      const rsi   = signal.rsi   ?? 50;
      const ratio = signal.volumeRatio ?? 1;

      const sentiment = await getSentimentCheck(
        signal.ticker,
        signal.strategy === 'SHORT_TERM' ? 'BUY_CHEAP' : 'BUY_BREAKOUT',
        rsi,
        ratio,
        signal.price,
        CLAUDE_KEY,
      );

      if (!sentiment.approved) return;

      approved.push(signal);

      await sendDayTradeAlert(
        signal.ticker,
        signal.strategy === 'SHORT_TERM' ? 'BUY_CHEAP' : 'BUY_BREAKOUT',
        rsi,
        ratio,
        signal.price,
        sentiment.note,
      ).catch(() => {});
    })
  );

  return approved;
}
