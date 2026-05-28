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

export interface PriceDetail { price: number; changePercent: number; }

/** Fetch prices + today's % change for multiple tickers concurrently. */
export async function getBatchPriceDetails(
  tickers: string[]
): Promise<Record<string, PriceDetail>> {
  const results = await Promise.allSettled(
    tickers.map(async (t) => {
      const data = await fetchChart(t, '1d', '1d');
      const meta = data?.chart?.result?.[0]?.meta ?? {};
      const price = (meta.regularMarketPrice ?? 0) as number;
      const prevClose = (meta.chartPreviousClose ?? meta.previousClose ?? 0) as number;
      // Prefer computing change from actual prices; fall back to API field
      const changePercent = prevClose > 0
        ? ((price - prevClose) / prevClose) * 100
        : (meta.regularMarketChangePercent ?? 0) as number;
      return { ticker: t, price, changePercent };
    })
  );
  const map: Record<string, PriceDetail> = {};
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value.price > 0)
      map[r.value.ticker] = { price: r.value.price, changePercent: r.value.changePercent };
  }
  return map;
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

export interface GrahamFundamentals {
  eps:          number;  // trailing EPS (₹)
  bookValue:    number;  // book value per share (₹)
  pb:           number;  // price-to-book ratio
  pe:           number;  // trailing P/E
  currentRatio: number;  // current assets / current liabilities
  debtToEquity: number;  // D/E as decimal (0.45 = 45%)
  revenue:      number;  // annual revenue (₹)
  dividendRate: number;  // annual dividend per share (0 if none)
  grahamNumber: number;  // √(22.5 × eps × bookValue)
  blended:      number;  // pe × pb (Graham's blended multiplier)
}

/** Fetch Graham value metrics from Yahoo Finance quoteSummary. */
export async function fetchGrahamFundamentals(ticker: string): Promise<GrahamFundamentals> {
  const zero: GrahamFundamentals = {
    eps: 0, bookValue: 0, pb: 0, pe: 0, currentRatio: 0,
    debtToEquity: 0, revenue: 0, dividendRate: 0, grahamNumber: 0, blended: 0,
  };
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}.NS` +
      `?modules=defaultKeyStatistics,financialData,summaryDetail`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return zero;
    const data   = await res.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return zero;

    const eps          = result.defaultKeyStatistics?.trailingEps?.raw    ?? 0;
    const bookValue    = result.defaultKeyStatistics?.bookValue?.raw       ?? 0;
    const pb           = result.defaultKeyStatistics?.priceToBook?.raw     ?? 0;
    const pe           = result.summaryDetail?.trailingPE?.raw             ?? 0;
    const currentRatio = result.financialData?.currentRatio?.raw           ?? 0;
    const debtToEquity = (result.financialData?.debtToEquity?.raw ?? 0) / 100;
    const revenue      = result.financialData?.totalRevenue?.raw           ?? 0;
    const dividendRate = result.summaryDetail?.dividendRate?.raw           ?? 0;
    const grahamNumber = eps > 0 && bookValue > 0 ? Math.sqrt(22.5 * eps * bookValue) : 0;
    const blended      = pe > 0 && pb > 0 ? pe * pb : 0;

    return { eps, bookValue, pb, pe, currentRatio, debtToEquity, revenue, dividendRate, grahamNumber, blended };
  } catch {
    return zero;
  }
}
