import { OHLCBar, calcATR } from './atrCalculator';
import { fetchGrahamFundamentals, GrahamFundamentals } from './marketData';
import { getCachedVerdict, saveVerdictCache } from './database';
import {
  WeightedScore, StockSignals, ScoreBreakdown, Verdict,
  VerdictStatus, VerdictTone, MacdResult,
} from '../types';
import { AnalysisResult } from './stockAnalysis';

// ── Fetch 1 year of OHLCV bars ────────────────────────────────────────────────

interface ExtendedBar extends OHLCBar { volume: number }
interface YearlyBars { closes: number[]; bars: OHLCBar[]; volumes: number[] }

async function fetchBars(ticker: string): Promise<YearlyBars> {
  const empty = { closes: [], bars: [], volumes: [] };
  try {
    const url =
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}.NS` +
      `?interval=1d&range=1y`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return empty;
    const data = await res.json();
    const q    = data?.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!q) return empty;
    const allBars: ExtendedBar[] = (q.high ?? [])
      .map((h: number | null, i: number): ExtendedBar => ({
        high:   h              ?? 0,
        low:    q.low?.[i]    ?? 0,
        close:  q.close?.[i]  ?? 0,
        volume: q.volume?.[i] ?? 0,
      }))
      .filter((b: ExtendedBar) => b.high > 0 && b.low > 0 && b.close > 0);
    return {
      bars:    allBars.map(({ high, low, close }) => ({ high, low, close })),
      closes:  allBars.map(b => b.close),
      volumes: allBars.map(b => b.volume),
    };
  } catch {
    return empty;
  }
}

// ── Technical indicator helpers ───────────────────────────────────────────────

function calcRsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;
  const changes = closes.slice(1).map((c, i) => c - closes[i]);
  const gains   = changes.map(c => Math.max(c, 0));
  const losses  = changes.map(c => Math.max(-c, 0));
  let avgGain   = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss   = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10;
}

function calcSma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  return closes.slice(-period).reduce((a, b) => a + b, 0) / period;
}

function calcEma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const k  = 2 / (period + 1);
  let ema  = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return Math.round(ema * 100) / 100;
}

function calcMacd(closes: number[]): MacdResult | null {
  const fast = 12, slow = 26, signal = 9;
  if (closes.length < slow + signal) return null;
  const kF = 2 / (fast + 1), kS = 2 / (slow + 1), kSig = 2 / (signal + 1);
  let emaF = closes.slice(0, fast).reduce((a, b) => a + b, 0) / fast;
  let emaS = closes.slice(0, slow).reduce((a, b) => a + b, 0) / slow;
  for (let i = fast; i < slow; i++) emaF = closes[i] * kF + emaF * (1 - kF);
  const macdVals: number[] = [];
  for (let i = slow; i < closes.length; i++) {
    emaF = closes[i] * kF + emaF * (1 - kF);
    emaS = closes[i] * kS + emaS * (1 - kS);
    macdVals.push(emaF - emaS);
  }
  if (macdVals.length < signal) return null;
  let sigEma = macdVals.slice(0, signal).reduce((a, b) => a + b, 0) / signal;
  for (let i = signal; i < macdVals.length; i++) sigEma = macdVals[i] * kSig + sigEma * (1 - kSig);
  const last = macdVals[macdVals.length - 1];
  return {
    macdLine:   Math.round(last * 100) / 100,
    signalLine: Math.round(sigEma * 100) / 100,
    histogram:  Math.round((last - sigEma) * 100) / 100,
  };
}

function findNearestSupport(bars: OHLCBar[], price: number): number | null {
  const slice = bars.slice(-60);
  const n     = slice.length;
  const pivotLows: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    if (slice[i].low < slice[i - 1].low && slice[i].low < slice[i + 1].low)
      pivotLows.push(slice[i].low);
  }
  const sorted = [...pivotLows].sort((a, b) => a - b);
  const groups: number[][] = [];
  for (const p of sorted) {
    const grp = groups.find(g => {
      const avg = g.reduce((a, b) => a + b, 0) / g.length;
      return Math.abs(p - avg) / avg <= 0.015;
    });
    if (grp) grp.push(p);
    else groups.push([p]);
  }
  const levels = groups
    .filter(g => g.length >= 3)
    .map(g => g.reduce((a, b) => a + b, 0) / g.length)
    .filter(l => l < price);
  if (levels.length === 0) return null;
  return levels.reduce((prev, curr) =>
    Math.abs(curr - price) < Math.abs(prev - price) ? curr : prev
  );
}

// ── Swing Score (0–100) ───────────────────────────────────────────────────────
// Technical multi-day swing-trade setup: uptrend + healthy RSI + expanding volume.
// Uses only chart data so it works even when the fundamentals API fails.

function swingScore(
  closes:  number[],
  volumes: number[],
  price:   number,
  rsi:     number | null,
  macd:    MacdResult | null,
  ema20:   number | null,
  ema50:   number | null,
  sma200:  number | null,
): number {
  let score = 0;

  // EMA trend stack (max 35) — swing trades need a confirmed uptrend
  if (price > 0) {
    const aboveEma20  = ema20  !== null && price  > ema20;
    const ema20AboveEma50  = ema20  !== null && ema50  !== null && ema20  > ema50;
    const ema50AboveSma200 = ema50  !== null && sma200 !== null && ema50  > sma200;
    if (aboveEma20 && ema20AboveEma50 && ema50AboveSma200) score += 35; // full bull stack
    else if (aboveEma20 && ema20AboveEma50)                score += 22;
    else if (ema50 !== null && price > ema50)              score += 12;
    else if (sma200 !== null && price > sma200)            score += 5;
  }

  // RSI zone (max 25) — swing wants 45–65: trending up, not overbought
  if (rsi !== null) {
    if (rsi >= 45 && rsi <= 65)      score += 25;
    else if (rsi >= 35 && rsi < 45)  score += 14; // recovering
    else if (rsi > 65 && rsi <= 75)  score += 8;  // strong but watch
  }

  // MACD momentum (max 25) — bullish crossover confirms swing direction
  if (macd !== null) {
    if (macd.histogram > 0 && macd.macdLine > 0) score += 25;
    else if (macd.histogram > 0)                  score += 12;
  }

  // 5-day volume vs 20-day average (max 15) — expanding volume = conviction
  if (volumes.length >= 21) {
    const avg5  = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
    const avg20 = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    if (avg20 > 0) {
      const ratio = avg5 / avg20;
      if (ratio > 1.4)      score += 15;
      else if (ratio > 1.0) score += 8;
    }
  }

  return Math.min(score, 100);
}

// ── Graham Timing Score (0–100) ───────────────────────────────────────────────
// Technical entry quality — buy undervalued stocks when price is depressed.

function grahamTimingScore(
  rsi:     number | null,
  macd:    MacdResult | null,
  volumes: number[],
  bars:    OHLCBar[],
  price:   number,
  ema50:   number | null,
  sma200:  number | null,
  closes:  number[],
): number {
  let score = 0;

  // RSI (max 35) — Graham buys when stock is unloved and depressed
  if (rsi !== null) {
    if (rsi < 30)      score += 35;
    else if (rsi < 40) score += 25;
    else if (rsi < 50) score += 15;
    else if (rsi < 60) score += 5;
  }

  // MACD momentum (max 25) — early sign of turning tide
  if (macd !== null) {
    if (macd.histogram > 0 && macd.macdLine > 0) score += 25;
    else if (macd.histogram > 0)                  score += 12;
  }

  // Support proximity (max 25) — buying near proven support = better entry
  const support = findNearestSupport(bars, price);
  if (support !== null && price > 0) {
    const pct = ((price - support) / price) * 100;
    if (pct >= 0 && pct <= 1.5)  score += 25;
    else if (pct > 0 && pct <= 3)  score += 15;
    else if (pct > 0 && pct <= 5)  score += 8;
  }

  // Volume (max 15) — rising volume confirms accumulation
  if (volumes.length >= 21) {
    const recent = volumes[volumes.length - 1];
    const avg20  = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    if (avg20 > 0) {
      const ratio = recent / avg20;
      if (ratio > 1.5)      score += 15;
      else if (ratio > 0.7) score += 8;
    }
  }

  const raw = Math.min(score, 100);

  // Trend alignment multiplier — Graham value in a downtrend is a value trap for swing trades.
  // Penalise proportionally so poor price action can't be masked by cheap fundamentals.
  let trendMult = 1.0;
  if (price > 0) {
    const belowSma200 = sma200 !== null && price < sma200;
    const belowEma50  = ema50  !== null && price < ema50;
    if (belowSma200)       trendMult = 0.45; // sustained downtrend
    else if (belowEma50)   trendMult = 0.70; // short-term weakness
  }

  // 1-month momentum bonus/penalty
  let momentumAdj = 0;
  if (closes.length >= 21) {
    const ret = (closes[closes.length - 1] - closes[closes.length - 21]) / closes[closes.length - 21];
    if (ret > 0.05)       momentumAdj =  8;  // strong positive momentum
    else if (ret > 0)     momentumAdj =  3;
    else if (ret < -0.05) momentumAdj = -10; // falling momentum
    else                  momentumAdj = -4;
  }

  return Math.max(0, Math.min(100, Math.round(raw * trendMult + momentumAdj)));
}

// ── Claude Graham Verdict ─────────────────────────────────────────────────────

const TONE_MAP: Record<VerdictStatus, VerdictTone> = {
  APPROVED: 'approved', WATCH: 'watch', DECLINED: 'declined',
};

async function getGrahamVerdict(
  ticker:      string,
  name:        string,
  price:       number,
  gf:          GrahamFundamentals,
  rsi:         number | null,
  macd:        MacdResult | null,
  grahamScore: number,
  timingScore: number,
  apiKey:      string,
): Promise<Verdict> {
  const cached = await getCachedVerdict(ticker);
  if (cached) {
    const status = cached.status as VerdictStatus;
    return { status, tone: TONE_MAP[status] ?? 'watch', body: cached.body };
  }

  const mos = gf.grahamNumber > 0
    ? `${(((gf.grahamNumber - price) / gf.grahamNumber) * 100).toFixed(1)}%`
    : 'N/A';

  const prompt =
    `You are a Benjamin Graham-style value investor analysing NSE stocks.\n\n` +
    `${ticker} (${name}) — ₹${price.toFixed(2)}\n` +
    `Graham Number: ₹${gf.grahamNumber > 0 ? gf.grahamNumber.toFixed(2) : 'N/A'} | Margin of Safety: ${mos}\n\n` +
    `Graham Metrics:\n` +
    `P/E ${gf.pe > 0 ? gf.pe.toFixed(1) : 'N/A'}× · P/B ${gf.pb > 0 ? gf.pb.toFixed(2) : 'N/A'}× · ` +
    `Blended ${gf.blended > 0 ? gf.blended.toFixed(1) : 'N/A'} (limit 22.5)\n` +
    `Current Ratio ${gf.currentRatio > 0 ? gf.currentRatio.toFixed(2) : 'N/A'} · ` +
    `D/E ${gf.debtToEquity > 0 ? gf.debtToEquity.toFixed(2) : '0'}× · EPS ₹${gf.eps.toFixed(2)}\n` +
    `Dividend: ${gf.dividendRate > 0 ? `₹${gf.dividendRate.toFixed(2)}/yr` : 'None'}\n\n` +
    `Technical Entry:\n` +
    `RSI ${rsi !== null ? rsi.toFixed(1) : 'N/A'} · MACD hist ${macd?.histogram.toFixed(2) ?? 'N/A'}\n` +
    `Value Score ${grahamScore}/100 · Timing Score ${timingScore}/100\n\n` +
    `Rate this as Graham would. Reply ONLY with JSON:\n` +
    `{"status":"APPROVED|WATCH|DECLINED","body":"<2 sentences: margin of safety and key risk, institutional tone>"}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 256,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`Claude ${res.status}`);
    const data   = await res.json();
    const text: string = data.content?.[0]?.text ?? '{}';
    const parsed = JSON.parse(text);
    const status = parsed.status as VerdictStatus;
    const verdict: Verdict = { status, tone: TONE_MAP[status] ?? 'watch', body: parsed.body };
    await saveVerdictCache(ticker, verdict.status, verdict.body);
    return verdict;
  } catch {
    return fallbackVerdict(grahamScore, timingScore);
  }
}

function fallbackVerdict(swingScore: number, timingScore: number): Verdict {
  const combined = swingScore * 0.5 + timingScore * 0.5;
  if (combined >= 60) return {
    status: 'APPROVED', tone: 'approved',
    body: `Swing ${swingScore}/100 · Entry ${timingScore}/100 — Strong uptrend with good entry timing.`,
  };
  if (combined >= 35) return {
    status: 'WATCH', tone: 'watch',
    body: `Swing ${swingScore}/100 · Entry ${timingScore}/100 — Setup developing; await confirmation.`,
  };
  return {
    status: 'DECLINED', tone: 'declined',
    body: `Swing ${swingScore}/100 · Entry ${timingScore}/100 — No clear swing setup at this time.`,
  };
}

// ── Main exported function ────────────────────────────────────────────────────

export async function analyseGrahamStock(
  ticker:       string,
  name:         string,
  currentPrice: number,
  apiKey:       string,
  _sector:      string,
): Promise<AnalysisResult> {
  const [{ closes, bars, volumes }, gf] = await Promise.all([
    fetchBars(ticker),
    fetchGrahamFundamentals(ticker),
  ]);

  const rsi    = calcRsi(closes);
  const sma200 = calcSma(closes, 200);
  const ema20  = calcEma(closes, 20);
  const ema50  = calcEma(closes, 50);
  const macd   = calcMacd(closes);
  const atr    = calcATR(bars);

  const gScore = swingScore(closes, volumes, currentPrice, rsi, macd, ema20, ema50, sma200);
  const tScore = grahamTimingScore(rsi, macd, volumes, bars, currentPrice, ema50, sma200, closes);

  const marginOfSafety = gf.grahamNumber > 0
    ? ((gf.grahamNumber - currentPrice) / gf.grahamNumber) * 100
    : 0;

  const weightedScore: WeightedScore = {
    swing:          gScore,
    intraday:       tScore,
    grahamNumber:   gf.grahamNumber > 0 ? Math.round(gf.grahamNumber * 100) / 100 : undefined,
    marginOfSafety: gf.grahamNumber > 0 ? Math.round(marginOfSafety * 10) / 10 : undefined,
  };

  const signals: StockSignals = {
    rsi,
    sma200,
    pe:         gf.pe > 0 ? Math.round(gf.pe * 10) / 10 : null,
    industryPe: null,
    yoyGrowth:  null,
    ema20,
    ema50,
    macd,
    bollinger:  null,
    volumes:    volumes.slice(-20),
  };

  const breakdown: ScoreBreakdown = {
    rsiOversold:    rsi !== null && rsi < 35,
    aboveSma200:    sma200 !== null && currentPrice > sma200,
    cheapPe:        gf.pe > 0 && gf.blended <= 22.5,
    growthPositive: gf.eps > 0,
  };

  const expectedDays = atr && atr > 0
    ? Math.max(1, Math.ceil((currentPrice * 0.12) / atr))
    : null;

  const passesGate = gScore >= 50 && tScore >= 25;
  const verdict    = (passesGate && apiKey && !apiKey.includes('xxxx'))
    ? await getGrahamVerdict(ticker, name, currentPrice, gf, rsi, macd, gScore, tScore, apiKey)
    : fallbackVerdict(gScore, tScore);

  const score = [
    breakdown.rsiOversold,
    breakdown.aboveSma200,
    breakdown.cheapPe,
    breakdown.growthPositive,
  ].filter(Boolean).length;

  return { ticker, score, signals, breakdown, verdict, expectedDays, weightedScore };
}
