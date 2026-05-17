const YF_HEADERS = { 'User-Agent': 'Mozilla/5.0' };

export interface OHLCBar {
  high:  number;
  low:   number;
  close: number;
}

export async function fetchOHLCBars(
  ticker: string,
  days = 20,
): Promise<OHLCBar[]> {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/` +
    `${encodeURIComponent(ticker)}.NS?interval=1d&range=${days}d`;
  try {
    const res  = await fetch(url, { headers: YF_HEADERS });
    if (!res.ok) return [];
    const data = await res.json();
    const q    = data?.chart?.result?.[0]?.indicators?.quote?.[0];
    if (!q) return [];

    const highs:  (number | null)[] = q.high  ?? [];
    const lows:   (number | null)[] = q.low   ?? [];
    const closes: (number | null)[] = q.close ?? [];

    return highs
      .map((h, i): OHLCBar => ({
        high:  h           ?? 0,
        low:   lows[i]     ?? 0,
        close: closes[i]   ?? 0,
      }))
      .filter(b => b.high > 0 && b.low > 0 && b.close > 0);
  } catch { return []; }
}

/** Wilder's smoothed ATR over `period` bars. Returns null if insufficient data. */
export function calcATR(bars: OHLCBar[], period = 14): number | null {
  if (bars.length < period + 1) return null;

  const trs = bars.slice(1).map((bar, i) =>
    Math.max(
      bar.high - bar.low,
      Math.abs(bar.high - bars[i].close),
      Math.abs(bar.low  - bars[i].close),
    )
  );

  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return Math.round(atr * 100) / 100;
}

/**
 * Estimates how many trading sessions it will take to move from
 * currentPrice to targetPrice, based on 14-day ATR.
 * Returns null if data is unavailable or ATR is zero.
 */
export async function calculateExpectedDays(
  ticker:       string,
  currentPrice: number,
  targetPrice:  number,
): Promise<number | null> {
  if (targetPrice <= currentPrice || currentPrice <= 0) return null;

  const bars = await fetchOHLCBars(ticker, 20);
  const atr  = calcATR(bars);
  if (!atr || atr <= 0) return null;

  return Math.max(1, Math.ceil((targetPrice - currentPrice) / atr));
}
