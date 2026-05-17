import { SignalType } from './telegramService';

// NOTE: Claude has no live web access, so this cannot actually fetch
// Moneycontrol headlines at runtime. The sentiment check uses Claude's
// training knowledge of the company's fundamentals and sector context
// combined with the intraday technical signals.
// For live news sentiment, integrate a news API (e.g. Newsdata.io).

const CLAUDE_API = 'https://api.anthropic.com/v1/messages';

export interface SentimentResult {
  approved:   boolean;
  confidence: number;   // 0.0 – 1.0
  note:       string;   // one-sentence rationale surfaced to the user
}

const SIGNAL_LABEL: Record<SignalType, string> = {
  BUY_CHEAP:     'BUY CHEAP — Oversold Recovery (RSI < 35, volume > 3x average)',
  BUY_BREAKOUT:  'BUY BREAKOUT — Momentum Start (RSI 45–55, volume > 5x average)',
};

export async function getSentimentCheck(
  ticker:    string,
  signal:    SignalType,
  rsi:       number,
  ratio:     number,
  price:     number,
  apiKey:    string,
): Promise<SentimentResult> {
  const prompt =
    `You are a senior equity analyst specialising in NSE Indian intraday trading.\n\n` +
    `${ticker} has triggered an intraday signal: ${SIGNAL_LABEL[signal]}\n\n` +
    `Live data:\n` +
    `- Price: ₹${price.toFixed(2)}\n` +
    `- RSI (15-min candles): ${rsi.toFixed(1)}\n` +
    `- Volume vs 5-day average: ${ratio.toFixed(1)}x\n\n` +
    `Using your knowledge of ${ticker}'s fundamentals, sector conditions, ` +
    `and typical intraday behaviour, decide whether this technical signal ` +
    `warrants a day-trade entry. A signal should be REJECTED if the stock ` +
    `has known structural headwinds, is in a sector under regulatory pressure, ` +
    `or if the RSI/volume combination is statistically unreliable for this ticker.\n\n` +
    `Reply ONLY with compact JSON — no markdown, no explanation outside it:\n` +
    `{"approved":true,"confidence":0.82,"note":"<one sentence, max 15 words>"}`;

  try {
    const res = await fetch(CLAUDE_API, {
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

    return {
      approved:   Boolean(parsed.approved),
      confidence: typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
      note: typeof parsed.note === 'string' ? parsed.note : 'No note returned.',
    };
  } catch {
    // On API failure, pass the signal through with a low-confidence flag
    // rather than silently blocking potentially valid trades.
    return { approved: true, confidence: 0.3, note: 'Sentiment check unavailable — manual review advised.' };
  }
}
