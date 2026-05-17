const BOT_TOKEN = process.env.EXPO_PUBLIC_TELEGRAM_BOT_TOKEN ?? '';
const CHAT_ID   = process.env.EXPO_PUBLIC_TELEGRAM_CHAT_ID   ?? '';

export type SignalType = 'BUY_CHEAP' | 'BUY_BREAKOUT';

function formatMessage(
  ticker:    string,
  signal:    SignalType,
  rsi:       number,
  ratio:     number,
  price:     number,
  note:      string,
): string {
  const emoji  = signal === 'BUY_CHEAP' ? '🟢' : '🚀';
  const label  = signal === 'BUY_CHEAP'
    ? 'BUY CHEAP — Oversold Recovery'
    : 'BUY BREAKOUT — Momentum Start';

  return (
    `${emoji} *AlgoPulse Day-Trade Signal*\n` +
    `*${ticker}* · NSE\n\n` +
    `📌 *${label}*\n` +
    `💰 Price: ₹${price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}\n` +
    `📊 RSI (15m): ${rsi.toFixed(1)}\n` +
    `📈 Volume vs avg: ${ratio.toFixed(1)}x\n\n` +
    `🤖 _Claude: ${note}_\n\n` +
    `⚡ Execute on Groww · Manual confirmation required`
  );
}

export async function sendDayTradeAlert(
  ticker: string,
  signal: SignalType,
  rsi:    number,
  ratio:  number,
  price:  number,
  note:   string,
): Promise<void> {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.warn('[Telegram] BOT_TOKEN or CHAT_ID missing — alert not sent.');
    return;
  }

  const body = JSON.stringify({
    chat_id:    CHAT_ID,
    text:       formatMessage(ticker, signal, rsi, ratio, price, note),
    parse_mode: 'Markdown',
  });

  const res = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
  );

  if (!res.ok) {
    const err = await res.text().catch(() => res.status.toString());
    throw new Error(`Telegram API error: ${err}`);
  }
}
