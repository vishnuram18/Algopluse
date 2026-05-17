import { useState, useEffect, useCallback, useRef } from 'react';

// Lightweight ping: fetch a 1-day chart for NIFTY index — tiny response, always available.
const HEALTH_URL =
  'https://query1.finance.yahoo.com/v8/finance/chart/%5ENSEI?interval=1d&range=1d';

const POLL_INTERVAL_MS = 30_000;  // 30 s — respectful to an external API
const TIMEOUT_MS       = 8_000;   // 8 s timeout

async function pingYahoo(): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(HEALTH_URL, {
      signal:  controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface ConnectionPulse {
  isUp:        boolean | null;  // null = first check not yet done
  lastChecked: number | null;   // epoch ms of last completed check
  check:       () => void;      // trigger a manual check
}

export function useConnectionPulse(): ConnectionPulse {
  const [isUp,        setIsUp]        = useState<boolean | null>(null);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const checkingRef = useRef(false);

  const check = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const up = await pingYahoo();
      setIsUp(up);
      setLastChecked(Date.now());
    } finally {
      checkingRef.current = false;
    }
  }, []);

  // Stable wrapper so callers can pass it to Pressable without re-rendering
  const checkStable = useCallback(() => { check(); }, [check]);

  useEffect(() => {
    check();                                            // immediate on mount
    const id = setInterval(check, POLL_INTERVAL_MS);   // then every 30 s
    return () => clearInterval(id);
  }, [check]);

  return { isUp, lastChecked, check: checkStable };
}
