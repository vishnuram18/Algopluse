import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts, Radii, Space } from '../theme/tokens';
import { ScoutCandidate, ScoreBreakdown, WeightedScore } from '../types';

interface Props {
  data:    ScoutCandidate;
  onPress: (ticker: string) => void;
}

const VERDICT_COLORS = {
  approved: { text: Colors.accentInk, bg: Colors.accentSoft, border: Colors.accent },
  watch:    { text: Colors.sepia,     bg: Colors.sepiaSoft,  border: Colors.sepia   },
  declined: { text: Colors.muted,     bg: Colors.raised,     border: Colors.hairStrong },
};

const SCORE_PIPS: { key: keyof ScoreBreakdown; label: string }[] = [
  { key: 'rsiOversold',    label: 'RSI<35' },
  { key: 'aboveSma200',    label: 'SMA200' },
  { key: 'cheapPe',        label: 'P/E'    },
  { key: 'growthPositive', label: 'Growth' },
];

const fmt = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function scoreColor(best: number): string {
  if (best >= 70) return Colors.accent;
  if (best >= 45) return Colors.sepia;
  return Colors.hairStrong;
}
function scoreTextColor(best: number): string {
  if (best >= 70) return Colors.accentInk;
  if (best >= 45) return Colors.sepia;
  return Colors.muted;
}
function scoreBg(best: number): string {
  if (best >= 70) return Colors.accentSoft;
  if (best >= 45) return Colors.sepiaSoft;
  return Colors.raised;
}

function macdArrow(ws: WeightedScore, histogram: number | undefined): string {
  if (histogram === undefined) return '';
  if (histogram > 0 && ws.swing >= 55) return '↑';
  if (histogram > 0)                   return '→';
  return '↓';
}

function StockCard({ data, onPress }: Props) {
  const up         = data.change >= 0;
  const verdict    = VERDICT_COLORS[data.verdict.tone];
  const indToneKey = data.indicator.tone === 'accent' ? 'approved'
                   : data.indicator.tone === 'sepia'  ? 'watch' : 'declined';
  const indTone    = VERDICT_COLORS[indToneKey];

  const ws   = data.weightedScore;
  const best = ws ? Math.max(ws.swing, ws.intraday) : 0;

  // EMA alignment for colored dots
  const sig    = data.signals;
  const ema20  = sig?.ema20  ?? null;
  const ema50  = sig?.ema50  ?? null;
  const sma200 = sig?.sma200 ?? null;
  const emaStack = ema20 !== null && ema50 !== null && sma200 !== null;
  const ema20Color  = ema20 && ema50 && ema20 > ema50    ? Colors.accent : Colors.hairStrong;
  const ema50Color  = ema50 && sma200 && ema50 > sma200  ? Colors.accent : Colors.hairStrong;
  const sma200Color = sma200 && data.price && data.price > sma200 ? Colors.accentInk : Colors.hairStrong;

  const macdHist  = sig?.macd?.histogram;
  const arrow     = ws ? macdArrow(ws, macdHist) : '';
  const arrowColor = arrow === '↑' ? Colors.accentInk
                   : arrow === '→' ? Colors.sepia
                   : Colors.danger;

  return (
    <Pressable
      onPress={() => onPress(data.ticker)}
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
    >
      {/* Head row */}
      <View style={s.headRow}>
        <View style={s.headLeft}>
          <View style={s.tickerRow}>
            <Text style={s.ticker}>{data.ticker}</Text>
            <Text style={s.exch}>{data.exchange}</Text>
          </View>
          <Text style={s.name} numberOfLines={1}>{data.name}</Text>
        </View>
        <View style={[s.badge, { backgroundColor: indTone.bg, borderColor: indTone.border }]}>
          <Text style={[s.badgeLabel, { color: indTone.text }]}>{data.indicator.label}</Text>
          <Text style={[s.badgeValue, { color: indTone.text }]}>{data.indicator.value}</Text>
        </View>
      </View>

      {/* Price row */}
      <View style={s.priceRow}>
        <Text style={s.price}>
          <Text style={s.priceCur}>{data.currency}</Text>
          {data.price > 0 ? fmt(data.price) : '—'}
        </Text>
        <View style={[s.changePill, { backgroundColor: up ? Colors.accentSoft : 'rgba(185,64,48,0.08)' }]}>
          <Text style={[s.changeText, { color: up ? Colors.accentInk : Colors.danger }]}>
            {up ? '▲' : '▼'} {Math.abs(data.change).toFixed(2)}%
          </Text>
        </View>
      </View>

      <View style={s.divider} />

      {/* Score section — weighted bar (new) or legacy pip row (old cache) */}
      {ws ? (
        <View style={s.scoreSection}>
          {/* Progress bar */}
          <View style={s.scoreBarRow}>
            <View style={s.scoreBarTrack}>
              <View style={[s.scoreBarFill, {
                width:           `${best}%` as any,
                backgroundColor: scoreColor(best),
              }]} />
            </View>
            <View style={[s.scoreChip, {
              backgroundColor: scoreBg(best),
              borderColor:     scoreColor(best),
            }]}>
              <Text style={[s.scoreChipText, { color: scoreTextColor(best) }]}>
                {best}/100
              </Text>
            </View>
          </View>

          {/* Signal pills row */}
          <View style={s.signalRow}>
            <Text style={[s.scoreDetail]}>
              V:{ws.swing} · E:{ws.intraday}
            </Text>
            {arrow !== '' && (
              <View style={s.signalPill}>
                <Text style={[s.signalPillText, { color: arrowColor }]}>
                  MACD {arrow}
                </Text>
              </View>
            )}
            {emaStack && (
              <View style={[s.signalPill, s.emaPill]}>
                <View style={[s.emaDot, { backgroundColor: ema20Color }]} />
                <View style={[s.emaDot, { backgroundColor: ema50Color }]} />
                <View style={[s.emaDot, { backgroundColor: sma200Color }]} />
                <Text style={s.signalPillText}>EMA</Text>
              </View>
            )}
            {data.scanSource && (
              <View style={[s.sourceChip, data.scanSource === 'pc' && s.sourceChipPc]}>
                <Text style={[s.sourceChipText, data.scanSource === 'pc' && s.sourceChipPcText]}>
                  {data.scanSource === 'pc' ? 'PC' : 'PHONE'}
                </Text>
              </View>
            )}
          </View>
        </View>
      ) : data.breakdown ? (
        <View style={s.scoreRow}>
          {SCORE_PIPS.map(({ key, label }) => {
            const pass = data.breakdown![key];
            return (
              <View key={key} style={s.scorePip}>
                <View style={[s.pipDot, pass && s.pipDotPass]} />
                <Text style={[s.pipLabel, pass && s.pipLabelPass]}>{label}</Text>
              </View>
            );
          })}
          <View style={[
            s.scoreChip,
            data.score! >= 3 ? s.scoreChipApproved
            : data.score! >= 2 ? s.scoreChipWatch
            : s.scoreChipDeclined,
          ]}>
            <Text style={[
              s.scoreChipText,
              data.score! >= 3 ? { color: Colors.accentInk }
              : data.score! >= 2 ? { color: Colors.sepia }
              : { color: Colors.muted },
            ]}>
              {data.score}/4
            </Text>
          </View>
        </View>
      ) : data.indicator.label === 'Scanning' ? (
        <View style={s.scoreBarRow}>
          <View style={s.scoreBarTrack} />
          <View style={[s.scoreChip, s.scoreChipDeclined]}>
            <Text style={[s.scoreChipText, { color: Colors.muted }]}>—/100</Text>
          </View>
        </View>
      ) : null}

      {/* Verdict block */}
      <View style={[s.verdictBlock, { borderLeftColor: verdict.border }]}>
        <View style={s.verdictHead}>
          <View style={s.agentDot} />
          <Text style={s.verdictLabel}>CLAUDE FINANCE AGENT VERDICT</Text>
          <View style={[s.verdictPill, { backgroundColor: verdict.bg, borderColor: verdict.border }]}>
            <Text style={[s.verdictPillText, { color: verdict.text }]}>{data.verdict.status}</Text>
          </View>
        </View>
        <Text style={s.verdictBody} numberOfLines={3}>{data.verdict.body}</Text>
      </View>

      {/* Foot */}
      <View style={s.foot}>
        <Text style={s.footLabel}>TAP TO HANDSHAKE</Text>
        <View style={s.footRight}>
          {data.expectedDays != null && (
            <View style={s.exitBadge}>
              <Text style={s.exitBadgeText}>Est. exit {data.expectedDays}d</Text>
            </View>
          )}
          <Text style={s.footArrow}>→</Text>
        </View>
      </View>
    </Pressable>
  );
}

function propsAreEqual(prev: Props, next: Props): boolean {
  const a = prev.data;
  const b = next.data;
  return (
    prev.onPress               === next.onPress             &&
    a.price                    === b.price                  &&
    a.change                   === b.change                 &&
    a.score                    === b.score                  &&
    a.expectedDays             === b.expectedDays           &&
    a.indicator.value          === b.indicator.value        &&
    a.indicator.tone           === b.indicator.tone         &&
    a.verdict.status           === b.verdict.status         &&
    a.verdict.body             === b.verdict.body           &&
    a.weightedScore?.swing     === b.weightedScore?.swing   &&
    a.weightedScore?.intraday  === b.weightedScore?.intraday &&
    a.scanSource               === b.scanSource
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.raised,
    borderRadius:    Radii.card,
    borderWidth:     1,
    borderColor:     Colors.hair,
    padding:         Space.base,
    marginBottom:    Space.sm,
  },
  cardPressed: { opacity: 0.85 },

  headRow:  { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: Space.sm },
  headLeft: { flex: 1, marginRight: Space.sm },
  tickerRow:{ flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  ticker:   { fontFamily: Fonts.monoMedium, fontSize: 15, color: Colors.ink },
  exch:     { fontFamily: Fonts.mono, fontSize: 11, color: Colors.muted2, marginTop: 1 },
  name:     { fontFamily: Fonts.serif, fontSize: 12, color: Colors.muted, marginTop: 2 },

  badge: {
    borderWidth:       1,
    borderRadius:      Radii.sm,
    paddingHorizontal: Space.sm,
    paddingVertical:   Space.xs,
    alignItems:        'center',
  },
  badgeLabel: { fontFamily: Fonts.mono, fontSize: 9,  letterSpacing: 0.5 },
  badgeValue: { fontFamily: Fonts.monoMedium, fontSize: 13, marginTop: 1 },

  priceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: Space.sm },
  price:    { fontFamily: Fonts.serifSemiBold, fontSize: 22, color: Colors.ink },
  priceCur: { fontFamily: Fonts.serif, fontSize: 14, color: Colors.muted },

  changePill: { borderRadius: Radii.xl, paddingHorizontal: Space.sm, paddingVertical: 3 },
  changeText: { fontFamily: Fonts.monoMedium, fontSize: 12 },

  divider: { height: 1, backgroundColor: Colors.hair, marginBottom: Space.sm },

  // ── Weighted score display ──────────────────────────────────────────────────
  scoreSection: { marginBottom: Space.sm, gap: 6 },

  scoreBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreBarTrack: {
    flex: 1, height: 5, borderRadius: 3,
    backgroundColor: Colors.hair, overflow: 'hidden',
  },
  scoreBarFill: { height: '100%', borderRadius: 3 },

  scoreChip: {
    borderWidth:       1,
    borderRadius:      Radii.xs,
    paddingHorizontal: 6,
    paddingVertical:   2,
  },
  scoreChipText: { fontFamily: Fonts.monoMedium, fontSize: 10 },

  signalRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  scoreDetail: { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted2, flex: 1 },

  signalPill: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    borderWidth: 1, borderColor: Colors.hair,
    borderRadius: Radii.xs,
    paddingHorizontal: 5, paddingVertical: 2,
    backgroundColor: Colors.canvas,
  },
  emaPill: { gap: 2 },
  signalPillText: { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted },
  emaDot: { width: 6, height: 6, borderRadius: 3 },

  sourceChip: {
    paddingHorizontal: 5, paddingVertical: 2,
    borderRadius: Radii.xs,
    borderWidth: 1, borderColor: Colors.hairStrong,
    backgroundColor: Colors.sepiaSoft,
  },
  sourceChipPc: { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  sourceChipText: { fontFamily: Fonts.mono, fontSize: 8.5, color: Colors.sepia },
  sourceChipPcText: { color: Colors.accentInk },

  // ── Legacy pip row (for old cached candidates) ──────────────────────────────
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginBottom: Space.sm },
  scorePip: { flexDirection: 'row', alignItems: 'center', gap: 4, flex: 1 },
  pipDot:       { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.hairStrong },
  pipDotPass:   { backgroundColor: Colors.accent },
  pipLabel:     { fontFamily: Fonts.mono, fontSize: 9, color: Colors.muted2 },
  pipLabelPass: { color: Colors.accentInk },

  scoreChipApproved: { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  scoreChipWatch:    { backgroundColor: Colors.sepiaSoft,  borderColor: Colors.sepia  },
  scoreChipDeclined: { backgroundColor: Colors.raised,     borderColor: Colors.hairStrong },

  // ── Verdict ─────────────────────────────────────────────────────────────────
  verdictBlock: {
    borderLeftWidth: 2,
    paddingLeft:     Space.sm,
    marginBottom:    Space.sm,
  },
  verdictHead:    { flexDirection: 'row', alignItems: 'center', gap: Space.xs, marginBottom: 4 },
  agentDot:       { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.accent },
  verdictLabel:   { fontFamily: Fonts.mono, fontSize: 8, color: Colors.muted2, letterSpacing: 0.6, flex: 1 },
  verdictPill:    { borderWidth: 1, borderRadius: Radii.xs, paddingHorizontal: 6, paddingVertical: 2 },
  verdictPillText:{ fontFamily: Fonts.monoMedium, fontSize: 10 },
  verdictBody:    { fontFamily: Fonts.serif, fontSize: 13, color: Colors.inkSoft, lineHeight: 19 },

  // ── Footer ──────────────────────────────────────────────────────────────────
  foot:          { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: Space.xs },
  footLabel:     { fontFamily: Fonts.mono, fontSize: 9, color: Colors.muted2, letterSpacing: 0.6 },
  footRight:     { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  exitBadge:     { backgroundColor: Colors.sepiaSoft, borderRadius: Radii.xs, paddingHorizontal: 6, paddingVertical: 2 },
  exitBadgeText: { fontFamily: Fonts.mono, fontSize: 9, color: Colors.sepia },
  footArrow:     { fontFamily: Fonts.serifSemiBold, fontSize: 16, color: Colors.muted },
});

export default React.memo(StockCard, propsAreEqual);
