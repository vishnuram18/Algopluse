export type StrategyType        = 'SHORT_TERM' | 'LONG_TERM';
export type CalendarEntryType   = 'HOLIDAY' | 'SPECIAL_TRADING';
export type ScanMode            = 'end-of-day' | 'intraday';

export interface CalendarEntry {
  date:  string;   // YYYY-MM-DD (IST)
  type:  CalendarEntryType;
  label: string;
}
export type VerdictStatus   = 'APPROVED' | 'WATCH' | 'DECLINED';
export type VerdictTone     = 'approved' | 'watch' | 'declined';
export type PositionStatus  = 'Tracking' | 'Near Target' | 'Target hit' | 'Drawdown';
export type NotifType       = 'target' | 'drawdown' | 'watch' | 'agent' | 'broker' | 'scout';
export type ScoutTab        = 'momentum' | 'value';

export interface Indicator {
  label: string;
  value: string;
  tone: 'accent' | 'sepia' | 'muted';
}

export interface Verdict {
  status: VerdictStatus;
  tone:   VerdictTone;
  body:   string;
}

export interface MacdResult {
  macdLine:   number;
  signalLine: number;
  histogram:  number;
}

export interface BollingerResult {
  upper:     number;
  middle:    number;
  lower:     number;
  bandwidth: number;
}

export interface WeightedScore {
  swing:           number;  // 0–100 (Graham Value Score for phone scan)
  intraday:        number;  // 0–100 (Graham Timing Score for phone scan)
  grahamNumber?:   number;  // Graham Number ₹ (phone scan only)
  marginOfSafety?: number;  // % below Graham Number (phone scan only)
}

export interface StockSignals {
  rsi:        number | null;
  sma200:     number | null;
  pe:         number | null;
  industryPe: number | null;
  yoyGrowth:  number | null;  // percentage, e.g. 15.2 = 15.2%
  ema20:      number | null;
  ema50:      number | null;
  macd:       MacdResult | null;
  bollinger:  BollingerResult | null;
  volumes:    number[];        // last 20 daily volumes
}

export interface ScoreBreakdown {
  rsiOversold:    boolean;  // RSI < 35
  aboveSma200:    boolean;  // price > 200-day SMA
  cheapPe:        boolean;  // P/E < industry average
  growthPositive: boolean;  // positive YoY profit growth
}

export interface ScoutCandidate {
  ticker:        string;
  name:          string;
  exchange:      string;
  price:         number;
  currency:      string;
  change:        number;
  sector:        string;
  indicator:     Indicator;
  verdict:       Verdict;
  score?:        number;
  signals?:      StockSignals;
  breakdown?:    ScoreBreakdown;
  expectedDays?: number;
  weightedScore?: WeightedScore;
  scanSource?:   'pc' | 'phone';
}

export interface Position {
  id:           string;
  ticker:       string;
  name:         string;
  entry:        number;
  current:      number;
  target:       number;
  stopLoss:     number;
  qty:          number;
  opened:       string;          // e.g. "May 17"
  pnl:          number;          // percent
  status:       PositionStatus;
  strategyType: StrategyType;
  expectedDays?: number;         // ATR-based sessions to target
}
