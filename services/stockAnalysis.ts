import { getVerdict } from './claudeAgent';
import { calcATR, OHLCBar } from './atrCalculator';
import { StockSignals, ScoreBreakdown, Verdict, VerdictStatus, VerdictTone } from '../types';

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

// ── Data fetchers ─────────────────────────────────────────────────────────────

interface YearlyBars { closes: number[]; bars: OHLCBar[] }

async function fetchYearlyBars(ticker: string): Promise<YearlyBars> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.NS?interval=1d&range=1y`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) return { closes: [], bars: [] };

  const data  = await res.json();
  const q     = data?.chart?.result?.[0]?.indicators?.quote?.[0];
  if (!q) return { closes: [], bars: [] };

  const rawHighs:  (number | null)[] = q.high  ?? [];
  const rawLows:   (number | null)[] = q.low   ?? [];
  const rawCloses: (number | null)[] = q.close ?? [];

  const bars: OHLCBar[] = rawHighs
    .map((h, i): OHLCBar => ({
      high:  h              ?? 0,
      low:   rawLows[i]    ?? 0,
      close: rawCloses[i]  ?? 0,
    }))
    .filter(b => b.high > 0 && b.low > 0 && b.close > 0);

  const closes = bars.map(b => b.close);
  return { closes, bars };
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
    pe:        result.summaryDetail?.trailingPE?.raw      ?? null,
    sector:    result.assetProfile?.sector                ?? null,
    yoyGrowth: result.financialData?.earningsGrowth?.raw  ?? null,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface AnalysisResult {
  ticker:       string;
  score:        number;        // 0–4
  signals:      StockSignals;
  breakdown:    ScoreBreakdown;
  verdict:      Verdict;
  expectedDays: number | null; // ATR-based sessions to default 12% target
}

export async function analyseStock(
  ticker:       string,
  name:         string,
  currentPrice: number,
  apiKey:       string,
  seedSector:   string,
): Promise<AnalysisResult> {
  const [{ closes, bars }, fundamentals] = await Promise.all([
    fetchYearlyBars(ticker),
    fetchFundamentals(ticker),
  ]);

  // ── Technical signals ──
  const rsi    = calculateRsi(closes);
  const sma200 = calculateSma(closes, 200);

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

  // ── Scoring (+1 per passing criterion) ──
  const rsiOversold    = rsi       !== null && rsi < 35;
  const aboveSma200    = sma200    !== null && currentPrice > sma200;
  const cheapPe        = pe        !== null && pe > 0 && pe < industryPe;
  const growthPositive = yoyGrowth !== null && yoyGrowth > 0;

  const score = [rsiOversold, aboveSma200, cheapPe, growthPositive].filter(Boolean).length;

  const signals: StockSignals = {
    rsi,
    sma200,
    pe:         pe        !== null ? Math.round(pe * 10) / 10           : null,
    industryPe,
    yoyGrowth:  yoyGrowth !== null ? Math.round(yoyGrowth * 1000) / 10  : null,
  };
  const breakdown: ScoreBreakdown = { rsiOversold, aboveSma200, cheapPe, growthPositive };

  // ── Gate: only call Claude for score ≥ 3 ──
  let verdict: Verdict;
  if (score >= 3 && apiKey && !apiKey.includes('xxxx')) {
    const liveIndicator = { label: 'RSI 14', value: rsi !== null ? rsi.toFixed(1) : 'n/a' };
    try {
      const cv = await getVerdict(ticker, name, currentPrice, liveIndicator, apiKey);
      verdict = { status: cv.status, tone: cv.tone, body: cv.body };
    } catch {
      verdict = fallbackVerdict(score);
    }
  } else {
    verdict = fallbackVerdict(score);
  }

  return { ticker, score, signals, breakdown, verdict, expectedDays };
}

function fallbackVerdict(score: number): Verdict {
  if (score >= 2) {
    const status: VerdictStatus = 'WATCH';
    const tone: VerdictTone     = 'watch';
    return {
      status, tone,
      body: `Score ${score}/4 — Borderline. ${score} of 4 criteria met; does not reach the 3-point threshold for a full Claude review.`,
    };
  }
  const status: VerdictStatus = 'DECLINED';
  const tone: VerdictTone     = 'declined';
  return {
    status, tone,
    body: `Score ${score}/4 — Below screening threshold. Only ${score} of 4 quantitative criteria passed.`,
  };
}
