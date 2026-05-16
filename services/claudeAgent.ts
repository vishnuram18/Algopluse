import { getCachedVerdict, saveVerdictCache } from './database';
import { VerdictStatus, VerdictTone, StrategyType } from '../types';

export interface ClaudeVerdict {
  status: VerdictStatus;
  tone: VerdictTone;
  body: string;
}

const TONE_MAP: Record<VerdictStatus, VerdictTone> = {
  APPROVED: 'approved',
  WATCH:    'watch',
  DECLINED: 'declined',
};

export async function getVerdict(
  ticker: string,
  name: string,
  price: number,
  indicator: { label: string; value: string },
  apiKey: string
): Promise<ClaudeVerdict> {
  // Return cached verdict if fresh (< 24 h)
  const cached = await getCachedVerdict(ticker);
  if (cached) {
    const status = cached.status as VerdictStatus;
    return { status, tone: TONE_MAP[status] ?? 'watch', body: cached.body };
  }

  const prompt = `You are a quantitative equity analyst for Indian markets. Analyse ${ticker} (${name}) on NSE.
Current price: ₹${price > 0 ? price.toFixed(2) : 'unavailable'}
Key indicator: ${indicator.label} = ${indicator.value}

Reply ONLY with a JSON object — no markdown, no explanation outside it:
{"status":"APPROVED|WATCH|DECLINED","body":"<2 sentences, institutional tone, no hedging>"}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':    'application/json',
      'x-api-key':       apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens: 256,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    throw new Error(`Claude API ${res.status}`);
  }

  const data = await res.json();
  const text: string = data.content?.[0]?.text ?? '{}';

  let verdict: ClaudeVerdict;
  try {
    const parsed = JSON.parse(text);
    const status = parsed.status as VerdictStatus;
    verdict = { status, tone: TONE_MAP[status] ?? 'watch', body: parsed.body };
  } catch {
    verdict = { status: 'WATCH', tone: 'watch', body: 'Analysis unavailable — check API key.' };
  }

  await saveVerdictCache(ticker, verdict.status, verdict.body);
  return verdict;
}

// ── Smart sell-target calculation ────────────────────────────────────────────

export interface SmartTarget {
  target: number;
  rationale: string;
}

/**
 * Asks Claude to calculate an optimal exit price given entry, recent closes,
 * and strategy horizon. Falls back to fixed percentages if the API is unavailable.
 */
export async function getSmartTarget(
  ticker: string,
  name: string,
  entry: number,
  recentCloses: number[],
  strategyType: StrategyType,
  apiKey: string
): Promise<SmartTarget> {
  const horizon   = strategyType === 'SHORT_TERM' ? '14–28 days' : '3–6 months';
  const closesStr = recentCloses.slice(-14).map(c => c.toFixed(2)).join(', ');
  const minTarget = strategyType === 'SHORT_TERM'
    ? (entry * 1.06).toFixed(2)   // at least 6% for short-term
    : (entry * 1.12).toFixed(2);  // at least 12% for long-term

  const prompt = `You are a quantitative equity analyst for Indian markets.
${ticker} (${name}) — entry price: ₹${entry.toFixed(2)}, horizon: ${horizon}
Recent daily closes (oldest → newest): [${closesStr || 'unavailable'}]

Calculate the optimal exit (sell) target price. Requirements:
- Must be above ₹${minTarget} (minimum acceptable gain)
- Base on resistance levels visible in the close history
- Aim for minimum 1.5:1 reward-to-risk ratio (stop loss = entry × 0.93)
- Be realistic for the stated horizon

Reply ONLY with compact JSON — no markdown:
{"target":<number>,"rationale":"<one sentence, max 12 words>"}`;

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
        max_tokens: 128,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) throw new Error(`Claude ${res.status}`);

    const data   = await res.json();
    const text   = data.content?.[0]?.text ?? '{}';
    const parsed = JSON.parse(text);

    if (parsed.target > entry) {
      return { target: Math.round(parsed.target * 100) / 100, rationale: parsed.rationale };
    }
  } catch { /* fall through to default */ }

  // Default fallback
  const pct = strategyType === 'SHORT_TERM' ? 1.12 : 1.20;
  return {
    target:    Math.round(entry * pct * 100) / 100,
    rationale: strategyType === 'SHORT_TERM' ? '+12% momentum target' : '+20% long-term target',
  };
}
