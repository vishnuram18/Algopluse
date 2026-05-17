export type StrategyType    = 'SHORT_TERM' | 'LONG_TERM';
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
  tone: VerdictTone;
  body: string;
}

export interface StockSignals {
  rsi:        number | null;
  sma200:     number | null;
  pe:         number | null;
  industryPe: number | null;
  yoyGrowth:  number | null;  // percentage, e.g. 15.2 = 15.2% growth
}

export interface ScoreBreakdown {
  rsiOversold:    boolean;  // RSI < 35
  aboveSma200:    boolean;  // price > 200-day SMA
  cheapPe:        boolean;  // P/E < industry average
  growthPositive: boolean;  // positive YoY profit growth
}

export interface ScoutCandidate {
  ticker:       string;
  name:         string;
  exchange:     string;
  price:        number;
  currency:     string;
  change:       number;
  sector:       string;
  indicator:    Indicator;
  verdict:      Verdict;
  score?:       number;
  signals?:     StockSignals;
  breakdown?:   ScoreBreakdown;
  expectedDays?: number;   // ATR-based estimate to reach default target
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
