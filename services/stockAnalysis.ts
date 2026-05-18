import { getVerdict } from './claudeAgent';
import { calcATR, OHLCBar } from './atrCalculator';
import {
  StockSignals, ScoreBreakdown, Verdict, VerdictStatus, VerdictTone,
  MacdResult, BollingerResult, WeightedScore,
} from '../types';

// ── Industry trailing P/E benchmarks for NSE sectors ─────────────────────────
const INDUSTRY_PE: Record<string, number> = {
  'Technology':             28,
  'Financial Services':     18,
  'Consumer Cyclical':      35,
  'Consumer Defensive':     45,
  'Healthcare':             32,
  'Energy':                 12,
  'Basic Materials':        14,
  'Industrials':            25,
  'Communication Services': 30,
  'Utilities':              20,
  'Real Estate':            28,
};
const DEFAULT_INDUSTRY_PE = 25;

// ── Technical helpers ─────────────────────────────────────────────────────────

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

function calculateSma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return Math.round((slice.reduce((a, b) => a + b, 0) / period) * 100) / 100;
}

function calculateEma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k   = 2 / (period + 1);
  let ema   = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) {
    ema = closes[i] * k + ema * (1 - k);
  }
  return Math.round(ema * 100) / 100;
}

function calculateMacd(
  closes: number[],
  fast = 12, slow = 26, signal = 9,
): MacdResult | null {
  if (closes.length < slow + signal) return null;

  const kFast   = 2 / (fast + 1);
  const kSlow   = 2 / (slow + 1);
  const kSignal = 2 / (signal + 1);

  let emaFast = closes.slice(0, fast).reduce((a, b) => a + b, 0) / fast;
  let emaSlow = closes.slice(0, slow).reduce((a, b) => a + b, 0) / slow;

  // Advance fast EMA to index slow-1
  for (let i = fast; i < slow; i++) {
    emaFast = closes[i] * kFast + emaFast * (1 - kFast);
  }

  // Build MACD line values starting at index slow
  const macdValues: number[] = [];
  for (let i = slow; i < closes.length; i++) {
    emaFast = closes[i] * kFast + emaFast * (1 - kFast);
    emaSlow = closes[i] * kSlow + emaSlow * (1 - kSlow);
    macdValues.push(emaFast - emaSlow);
  }

  if (macdValues.length < signal) return null;

  // Signal = EMA-9 of MACD values
  let signalEma = macdValues.slice(0, signal).reduce((a, b) => a + b, 0) / signal;
  for (let i = signal; i < macdValues.length; i++) {
    signalEma = macdValues[i] * kSignal + signalEma * (1 - kSignal);
  }

  const lastMacd = macdValues[macdValues.length - 1];
  return {
    macdLine:   Math.round(lastMacd * 100) / 100,
    signalLine: Math.round(signalEma * 100) / 100,
    histogram:  Math.round((lastMacd - signalEma) * 100) / 100,
  };
}

function calculateBollinger(closes: number[], period = 20): BollingerResult | null {
  if (closes.length < period) return null;
  const slice    = closes.slice(-period);
  const middle   = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const std      = Math.sqrt(variance);
  const upper    = middle + 2 * std;
  const lower    = middle - 2 * std;
  return {
    upper:     Math.round(upper * 100) / 100,
    middle:    Math.round(middle * 100) / 100,
    lower:     Math.round(lower * 100) / 100,
    bandwidth: Math.round(middle > 0 ? ((upper - lower) / middle) * 10000 : 0) / 100,
  };
}

// ── Data fetchers ─────────────────────────────────────────────────────────────

interface ExtendedBar extends OHLCBar { volume: number }
interface YearlyBars { closes: number[]; bars: OHLCBar[]; volumes: number[] }

async function fetchYearlyBars(ticker: string): Promise<YearlyBars> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.NS?interval=1d&range=1y`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return { closes: [], bars: [], volumes: [] };

  const data = await res.json();
  const q    = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  if (!q) return { closes: [], bars: [], volumes: [] };

  const rawHighs:   (number | null)[] = q.high   ?? [];
  const rawLows:    (number | null)[] = q.low    ?? [];
  const rawCloses:  (number | null)[] = q.close  ?? [];
  const rawVolumes: (number | null)[] = q.volume ?? [];

  const allBars: ExtendedBar[] = rawHighs
    .map((h, i): ExtendedBar => ({
      high:   h              ?? 0,
      low:    rawLows[i]    ?? 0,
      close:  rawCloses[i]  ?? 0,
      volume: rawVolumes[i] ?? 0,
    }))
    .filter(b => b.high > 0 && b.low > 0 && b.close > 0);

  return {
    bars:    allBars.map(({ high, low, close }) => ({ high, low, close })),
    closes:  allBars.map(b => b.close),
    volumes: allBars.map(b => b.volume),
  };
}

interface Fundamentals {
  pe:        number | null;
  sector:    string | null;
  yoyGrowth: number | null;
}

async function fetchFundamentals(ticker: string): Promise<Fundamentals> {
  const url =
    `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}.NS` +
    `?modules=summaryDetail,financialData,assetProfile`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return { pe: null, sector: null, yoyGrowth: null };

  const data   = await res.json();
  const result = data?.quoteSummary?.result?.[0];
  if (!result) return { pe: null, sector: null, yoyGrowth: null };

  return {
    pe:        result.summaryDetail?.trailingPE?.raw     ?? null,
    sector:    result.assetProfile?.sector               ?? null,
    yoyGrowth: result.financialData?.earningsGrowth?.raw ?? null,
  };
}

// ── Weighted scoring (0–100) ──────────────────────────────────────────────────

function computeSwingScore(
  rsi:        number | null,
  macd:       MacdResult | null,
  ema20:      number | null,
  ema50:      number | null,
  sma200:     number | null,
  volumes:    number[],
  pe:         number | null,
  industryPe: number,
  yoyGrowthPct: number | null,  // percentage (e.g. 15.2 = 15.2%)
): number {
  let score = 0;

  // RSI zone (max 15)
  if (rsi !== null) {
    if (rsi < 35)      score += 15;
    else if (rsi < 45) score += 8;
    else if (rsi < 55) score += 4;
  }

  // MACD crossover (max 15): histogram>0 AND macdLine>0 = strong bullish
  if (macd !== null) {
    if (macd.histogram > 0 && macd.macdLine > 0) score += 15;
    else if (macd.histogram > 0)                  score += 8;
  }

  // EMA stack (max 15)
  if (ema20 !== null && ema50 !== null && sma200 !== null) {
    if (ema20 > ema50 && ema50 > sma200) score += 15;
    else if (ema20 > ema50)              score += 8;
  }

  // Volume surge vs 20-day average (max 15)
  if (volumes.length >= 21) {
    const recent = volumes[volumes.length - 1];
    const avg20  = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    if (avg20 > 0) {
      const ratio = recent / avg20;
      if (ratio > 3)        score += 15;
      else if (ratio > 1.5) score += 8;
    }
  }

  // P/E vs industry (max 15)
  if (pe !== null && pe > 0) {
    if (pe < industryPe * 0.8) score += 15;
    else if (pe < industryPe)  score += 8;
  }

  // YoY growth (max 10)
  if (yoyGrowthPct !== null) {
    if (yoyGrowthPct > 20)     score += 10;
    else if (yoyGrowthPct > 0) score += 5;
  }

  // Support proximity is Phase 4 — not scored yet (max 15 reserved)

  return Math.min(score, 100);
}

function computeIntradayScore(
  rsi:     number | null,
  volumes: number[],
  macd:    MacdResult | null,
): number {
  let score = 0;

  // RSI extreme (max 25)
  if (rsi !== null) {
    if (rsi < 30)      score += 25;
    else if (rsi < 40) score += 15;
  }

  // Volume ratio vs 20-day average (max 30)
  if (volumes.length >= 21) {
    const recent = volumes[volumes.length - 1];
    const avg20  = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    if (avg20 > 0) {
      const ratio = recent / avg20;
      if (ratio > 5)        score += 30;
      else if (ratio > 3)   score += 15;
      else if (ratio > 1.5) score += 8;
    }
  }

  // MACD momentum (max 25)
  if (macd !== null) {
    if (macd.histogram > 0 && macd.macdLine > 0) score += 25;
    else if (macd.histogram > 0)                  score += 15;
  }

  // Breakout detection is Phase 4 — not scored yet (max 20 reserved)

  return Math.min(score, 80);  // 80 max until Phase 4 adds breakout points
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AnalysisResult {
  ticker:        string;
  score:         number;        // legacy 0–4 boolean count
  signals:       StockSignals;
  breakdown:     ScoreBreakdown;
  verdict:       Verdict;
  expectedDays:  number | null;
  weightedScore: WeightedScore;
}

export async function analyseStock(
  ticker:       string,
  name:         string,
  currentPrice: number,
  apiKey:       string,
  seedSector:   string,
): Promise<AnalysisResult> {
  const [{ closes, bars, volumes }, fundamentals] = await Promise.all([
    fetchYearlyBars(ticker),
    fetchFundamentals(ticker),
  ]);

  // ── Technical signals ──
  const rsi       = calculateRsi(closes);
  const sma200    = calculateSma(closes, 200);
  const ema20     = calculateEma(closes, 20);
  const ema50     = calculateEma(closes, 50);
  const macd      = calculateMacd(closes);
  const bollinger = calculateBollinger(closes);

  // ── ATR-based time-to-target (12% default for SHORT_TERM) ──
  const atr          = calcATR(bars);
  const targetGap    = currentPrice * 0.12;
  const expectedDays = atr && atr > 0
    ? Math.max(1, Math.ceil(targetGap / atr))
    : null;

  // ── Fundamental signals ──
  const { pe, sector, yoyGrowth } = fundamentals;
  const resolvedSector = sector ?? seedSector;
  const industryPe     = INDUSTRY_PE[resolvedSector] ?? DEFAULT_INDUSTRY_PE;

  // ── Legacy 4-point boolean scoring ──
  const rsiOversold    = rsi       !== null && rsi < 35;
  const aboveSma200    = sma200    !== null && currentPrice > sma200;
  const cheapPe        = pe        !== null && pe > 0 && pe < industryPe;
  const growthPositive = yoyGrowth !== null && yoyGrowth > 0;
  const score = [rsiOversold, aboveSma200, cheapPe, growthPositive].filter(Boolean).length;

  // ── Weighted 0-100 scores ──
  const yoyGrowthPct = yoyGrowth !== null ? yoyGrowth * 100 : null;
  const weightedScore: WeightedScore = {
    swing:    computeSwingScore(rsi, macd, ema20, ema50, sma200, volumes, pe, industryPe, yoyGrowthPct),
    intraday: computeIntradayScore(rsi, volumes, macd),
  };

  const signals: StockSignals = {
    rsi,
    sma200,
    pe:         pe        !== null ? Math.round(pe * 10) / 10          : null,
    industryPe,
    yoyGrowth:  yoyGrowth !== null ? Math.round(yoyGrowth * 1000) / 10 : null,
    ema20,
    ema50,
    macd,
    bollinger,
    volumes: volumes.slice(-20),
  };
  const breakdown: ScoreBreakdown = { rsiOversold, aboveSma200, cheapPe, growthPositive };

  // ── Gate: call Claude for weightedScore.swing >= 55 OR intraday >= 60 ──
  let verdict: Verdict;
  const passesGate = weightedScore.swing >= 55 || weightedScore.intraday >= 60;
  if (passesGate && apiKey && !apiKey.includes('xxxx')) {
    const liveIndicator = { label: 'RSI 14', value: rsi !== null ? rsi.toFixed(1) : 'n/a' };
    try {
      const cv = await getVerdict(ticker, name, currentPrice, liveIndicator, apiKey);
      verdict  = { status: cv.status, tone: cv.tone, body: cv.body };
    } catch {
      verdict  = fallbackVerdict(weightedScore);
    }
  } else {
    verdict = fallbackVerdict(weightedScore);
  }

  return { ticker, score, signals, breakdown, verdict, expectedDays, weightedScore };
}

function fallbackVerdict(ws: WeightedScore): Verdict {
  const best = Math.max(ws.swing, ws.intraday);
  if (best >= 45) {
    const status: VerdictStatus = 'WATCH';
    const tone: VerdictTone     = 'watch';
    return {
      status, tone,
      body: `Swing ${ws.swing}/100 · Intraday ${ws.intraday}/100 — Borderline. Does not reach the 55/60 threshold for a Claude review.`,
    };
  }
  const status: VerdictStatus = 'DECLINED';
  const tone: VerdictTone     = 'declined';
  return {
    status, tone,
    body: `Swing ${ws.swing}/100 · Intraday ${ws.intraday}/100 — Below screening threshold.`,
  };
}
