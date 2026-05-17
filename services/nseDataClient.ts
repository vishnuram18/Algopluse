const NSE_BASE = 'https://www.nseindia.com';
const DELAY_MS = 2000;

const BASE_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection':      'keep-alive',
  'X-Requested-With':'XMLHttpRequest',
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MostActiveStock {
  symbol:       string;
  series:       string;
  openPrice:    number;
  highPrice:    number;
  lowPrice:     number;
  ltp:          number;   // last traded price
  previousPrice:number;
  netPrice:     number;   // % change
  tradedQuantity: number;
  turnoverInLakhs: number;
}

export interface VolumeShocker {
  symbol:    string;
  series:    string;
  prevVol:   number;
  curVol:    number;
  ratio:     number;  // curVol / prevVol
  pChange:   number;  // % price change
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extracts cookie key=value pairs from a raw Set-Cookie header string.
 * Splits on commas that precede a new cookie name (e.g. "name=") while
 * safely ignoring commas inside Expires date values like "Thu, 01 Jan 2026".
 */
function parseCookies(raw: string): string {
  if (!raw) return '';
  return raw
    .split(/,(?=\s*[A-Za-z0-9_\-]+=)/)
    .map(segment => segment.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

// ── Client ────────────────────────────────────────────────────────────────────

export class NseDataClient {
  private cookies      = '';
  private lastFetchAt  = 0;

  /** Enforces a minimum DELAY_MS gap between outgoing requests. */
  private async throttle(): Promise<void> {
    const wait = DELAY_MS - (Date.now() - this.lastFetchAt);
    if (wait > 0) await sleep(wait);
    this.lastFetchAt = Date.now();
  }

  /**
   * Hits the NSE homepage to obtain a valid session cookie set.
   * Called automatically before the first data request, and again
   * whenever a 401/403 response indicates the session has expired.
   */
  async establishSession(): Promise<void> {
    await this.throttle();
    const res = await fetch(NSE_BASE + '/', {
      headers: { ...BASE_HEADERS, Accept: 'text/html,application/xhtml+xml,*/*' },
    });
    const raw = res.headers.get('set-cookie') ?? '';
    this.cookies = parseCookies(raw);
  }

  private async get(path: string): Promise<unknown> {
    if (!this.cookies) await this.establishSession();

    await this.throttle();
    const res = await fetch(NSE_BASE + path, {
      headers: {
        ...BASE_HEADERS,
        Cookie:  this.cookies,
        Referer: NSE_BASE + '/',
      },
    });

    // Session expired — refresh once and retry
    if (res.status === 401 || res.status === 403) {
      this.cookies = '';
      await this.establishSession();
      await this.throttle();
      const retry = await fetch(NSE_BASE + path, {
        headers: {
          ...BASE_HEADERS,
          Cookie:  this.cookies,
          Referer: NSE_BASE + '/',
        },
      });
      if (!retry.ok) throw new Error(`NSE ${retry.status} for ${path}`);
      return retry.json();
    }

    if (!res.ok) throw new Error(`NSE ${res.status} for ${path}`);
    return res.json();
  }

  /** Returns the top most-actively-traded NSE securities by volume. */
  async getMostActive(): Promise<MostActiveStock[]> {
    const data = await this.get(
      '/api/live-analysis-most-active-securities?index=volume'
    ) as { data?: MostActiveStock[] };
    return data?.data ?? [];
  }

  /** Returns stocks whose intraday volume has spiked significantly vs. prior average. */
  async getVolumeShockers(): Promise<VolumeShocker[]> {
    const data = await this.get(
      '/api/live-analysis-volume-shockers'
    ) as { data?: VolumeShocker[] };
    return data?.data ?? [];
  }

  /** Force-clears the stored session so the next call re-establishes it. */
  resetSession(): void {
    this.cookies     = '';
    this.lastFetchAt = 0;
  }
}

export const nseClient = new NseDataClient();
