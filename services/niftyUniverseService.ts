import { NiftyStock, NIFTY_500, PHONE_SCAN_UNIVERSE } from '../data/nifty500';
import { saveNiftyUniverse, getNiftyUniverseFromDb } from './database';

const NSE_500_URL     = 'https://www.niftyindices.com/IndexConstituents/ind_nifty500list.csv';
const NSE_100_URL     = 'https://www.niftyindices.com/IndexConstituents/ind_nifty100list.csv';
const CACHE_TTL_MS    = 7 * 24 * 60 * 60 * 1000;  // 7 days
const FETCH_TIMEOUT   = 10_000;                     // 10 s per request

const NSE_SECTOR_MAP: Record<string, string> = {
  'IT':                              'Technology',
  'BANKS':                           'Financial Services',
  'FINANCIAL SERVICES':              'Financial Services',
  'INSURANCE':                       'Financial Services',
  'AUTOMOBILES':                     'Consumer Cyclical',
  'AUTO COMPONENTS':                 'Consumer Cyclical',
  'FMCG':                            'Consumer Defensive',
  'CONSUMER DURABLES':               'Consumer Cyclical',
  'RETAILING':                       'Consumer Cyclical',
  'TEXTILES':                        'Consumer Cyclical',
  'PHARMA':                          'Healthcare',
  'HEALTHCARE':                      'Healthcare',
  'HOSPITALS & DIAGNOSTIC CENTRES':  'Healthcare',
  'OIL & GAS':                       'Energy',
  'REFINERIES':                      'Energy',
  'METALS':                          'Basic Materials',
  'MINING':                          'Basic Materials',
  'CHEMICALS':                       'Basic Materials',
  'FERTILISERS & PESTICIDES':        'Basic Materials',
  'CAPITAL GOODS':                   'Industrials',
  'CONSTRUCTION':                    'Industrials',
  'TRANSPORT INFRASTRUCTURE':        'Industrials',
  'SERVICES':                        'Industrials',
  'CEMENT':                          'Industrials',
  'TELECOM':                         'Communication Services',
  'MEDIA & ENTERTAINMENT':           'Communication Services',
  'POWER':                           'Utilities',
  'REALTY':                          'Real Estate',
};

function mapSector(industry: string): string {
  return NSE_SECTOR_MAP[industry.trim().toUpperCase()] ?? 'Industrials';
}

function parseCsv(text: string): NiftyStock[] {
  const clean = text.replace(/^﻿/, '').trim();  // strip UTF-8 BOM
  const lines = clean.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header      = lines[0].split(',').map(h => h.trim().toLowerCase());
  const nameIdx     = header.findIndex(h => h.includes('company name'));
  const industryIdx = header.findIndex(h => h === 'industry');
  const symbolIdx   = header.findIndex(h => h === 'symbol');

  if (symbolIdx === -1) return [];

  const results: NiftyStock[] = [];
  for (const line of lines.slice(1)) {
    const cols     = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const ticker   = cols[symbolIdx] ?? '';
    const name     = (nameIdx !== -1 ? cols[nameIdx] : '') || ticker;
    const industry = industryIdx !== -1 ? (cols[industryIdx] ?? '') : '';
    if (ticker.length === 0) continue;
    results.push({ ticker, name, sector: mapSector(industry) });
  }
  return results;
}

async function fetchCsv(url: string): Promise<NiftyStock[] | null> {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const res = await fetch(url, {
      signal:  controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/91.0.4472.120 Mobile Safari/537.36',
        'Accept':     'text/csv,text/plain,*/*',
        'Referer':    'https://www.niftyindices.com/',
      },
    });
    if (!res.ok) return null;
    const stocks = parseCsv(await res.text());
    return stocks.length > 10 ? stocks : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type UniverseSource = 'live' | 'cached' | 'fallback';

export async function getNiftyUniverse(): Promise<{
  full500: NiftyStock[];
  top100:  NiftyStock[];
  source:  UniverseSource;
}> {
  // 1. Return from DB if cache is fresh (< 7 days)
  const { stocks: dbStocks, top100Stocks, cachedAt } = await getNiftyUniverseFromDb();
  if (dbStocks.length > 100 && cachedAt !== null && Date.now() - cachedAt < CACHE_TTL_MS) {
    const top100 = top100Stocks.length > 0 ? top100Stocks : dbStocks.slice(0, 100);
    return { full500: dbStocks, top100, source: 'cached' };
  }

  // 2. Fetch fresh from NSE (both CSVs concurrently)
  const [res500, res100] = await Promise.allSettled([
    fetchCsv(NSE_500_URL),
    fetchCsv(NSE_100_URL),
  ]);

  const fresh500 = res500.status === 'fulfilled' ? res500.value : null;
  const fresh100 = res100.status === 'fulfilled' ? res100.value : null;

  if (fresh500 && fresh500.length > 100) {
    const top100Tickers = new Set((fresh100 ?? []).map(s => s.ticker));
    await saveNiftyUniverse(fresh500, top100Tickers).catch(() => {});
    const top100 = fresh100 && fresh100.length > 0 ? fresh100 : fresh500.slice(0, 100);
    return { full500: fresh500, top100, source: 'live' };
  }

  // 3. Fall back to stale DB data or static file
  if (dbStocks.length > 0) {
    const top100 = top100Stocks.length > 0 ? top100Stocks : dbStocks.slice(0, 100);
    return { full500: dbStocks, top100, source: 'fallback' };
  }
  return { full500: NIFTY_500, top100: PHONE_SCAN_UNIVERSE, source: 'fallback' };
}
