// Yahoo Finance unofficial API — no key required, NSE tickers use .NS suffix.
const BASE = 'https://query1.finance.yahoo.com/v8/finance/chart';
const HEADERS = { 'User-Agent': 'Mozilla/5.0' };

async function fetchChart(ticker: string, interval: string, range: string) {
  const url = `${BASE}/${encodeURIComponent(ticker)}.NS?interval=${interval}&range=${range}`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Yahoo Finance ${res.status} for ${ticker}`);
  return res.json();
}

/** Returns the latest traded price for an NSE ticker. */
export async function getCurrentPrice(ticker: string): Promise<number> {
  const data = await fetchChart(ticker, '1d', '1d');
  return data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? 0;
}

/** Returns up to `days` daily closing prices, oldest first, for RSI calculation. */
export async function getDailyCloses(ticker: string, days = 15): Promise<number[]> {
  const data = await fetchChart(ticker, '1d', `${days}d`);
  const closes: (number | null)[] =
    data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
  return closes.filter((c): c is number => c !== null);
}

/** Fetch prices for multiple tickers concurrently. Returns a map of ticker → price. */
export async function getBatchPrices(
  tickers: string[]
): Promise<Record<string, number>> {
  const results = await Promise.allSettled(
    tickers.map(async (t) => ({ ticker: t, price: await getCurrentPrice(t) }))
  );
  const map: Record<string, number> = {};
  for (const r of results) {
    if (r.status === 'fulfilled') map[r.value.ticker] = r.value.price;
  }
  return map;
}
