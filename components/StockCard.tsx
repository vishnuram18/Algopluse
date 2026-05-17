import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts, Radii, Space } from '../theme/tokens';
import { ScoutCandidate, ScoreBreakdown } from '../types';

interface Props {
  data: ScoutCandidate;
  onPress: () => void;
}

const VERDICT_COLORS = {
  approved: { text: Colors.accentInk, bg: Colors.accentSoft, border: Colors.accent },
  watch:    { text: Colors.sepia,     bg: Colors.sepiaSoft,  border: Colors.sepia   },
  declined: { text: Colors.muted,     bg: Colors.raised,     border: Colors.hairStrong },
};

export default function StockCard({ data, onPress }: Props) {
  const up      = data.change >= 0;
  const verdict = VERDICT_COLORS[data.verdict.tone];
  const indToneKey = data.indicator.tone === 'accent' ? 'approved' : data.indicator.tone === 'sepia' ? 'watch' : 'declined';
  const indTone = VERDICT_COLORS[indToneKey];
  const fmt     = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <Pressable
      onPress={onPress}
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

      {/* Score row — visible once analyseStock has run */}
      {data.breakdown && (
        <View style={s.scoreRow}>
          {(
            [
              { key: 'rsiOversold',    label: 'RSI<35'  },
              { key: 'aboveSma200',    label: 'SMA200'  },
              { key: 'cheapPe',        label: 'P/E'     },
              { key: 'growthPositive', label: 'Growth'  },
            ] as { key: keyof ScoreBreakdown; label: string }[]
          ).map(({ key, label }) => {
            const pass = data.breakdown![key];
            return (
              <View key={key} style={s.scorePip}>
                <View style={[s.pipDot, pass && s.pipDotPass]} />
                <Text style={[s.pipLabel, pass && s.pipLabelPass]}>{label}</Text>
              </View>
            );
          })}
          <View style={[s.scoreChip,
            data.score! >= 3 ? s.scoreChipApproved
            : data.score! >= 2 ? s.scoreChipWatch
            : s.scoreChipDeclined]}>
            <Text style={[s.scoreChipText,
              data.score! >= 3 ? { color: Colors.accentInk }
              : data.score! >= 2 ? { color: Colors.sepia }
              : { color: Colors.muted }]}>
              {data.score}/4
            </Text>
          </View>
        </View>
      )}

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

const s = StyleSheet.create({
  card: {
    backgroundColor: Colors.canvas,
    borderRadius: Radii.card,
    borderWidth: 1,
    borderColor: Colors.hair,
    padding: Space.base,
    marginBottom: Space.md,
  },
  cardPressed: {
    borderColor: Colors.inkSoft,
    transform: [{ scale: 0.992 }],
  },
  headRow:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  headLeft:  { flex: 1, marginRight: Space.sm },
  tickerRow: { flexDirection: 'row', alignItems: 'baseline', gap: Space.sm },
  ticker:    { fontFamily: Fonts.serifMedium, fontSize: 20, color: Colors.ink, letterSpacing: -0.2 },
  exch:      { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted, letterSpacing: 1 },
  name:      { fontSize: 12, color: Colors.muted, marginTop: 2 },
  badge:     { alignItems: 'flex-end', padding: 5, borderRadius: 4, borderWidth: 1 },
  badgeLabel:{ fontSize: 8.5, letterSpacing: 1, textTransform: 'uppercase', fontWeight: '500' },
  badgeValue:{ fontFamily: Fonts.mono, fontSize: 11, marginTop: 1 },

  priceRow:   { flexDirection: 'row', alignItems: 'center', gap: Space.sm, marginTop: Space.sm },
  price:      { fontFamily: Fonts.mono, fontSize: 14, color: Colors.ink },
  priceCur:   { color: Colors.muted, fontSize: 12 },
  changePill: { flexDirection: 'row', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99 },
  changeText: { fontFamily: Fonts.mono, fontSize: 11 },

  divider:     { height: 1, backgroundColor: Colors.hair, marginVertical: Space.sm, borderStyle: 'dashed' },

  scoreRow:          { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: Space.sm },
  scorePip:          { alignItems: 'center', gap: 3 },
  pipDot:            { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.hair, borderWidth: 1, borderColor: Colors.hairStrong },
  pipDotPass:        { backgroundColor: Colors.accent, borderColor: Colors.accent },
  pipLabel:          { fontFamily: Fonts.mono, fontSize: 8, color: Colors.muted2, letterSpacing: 0.3 },
  pipLabelPass:      { color: Colors.accentInk },
  scoreChip:         { marginLeft: 'auto' as any, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  scoreChipApproved: { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  scoreChipWatch:    { backgroundColor: Colors.sepiaSoft,  borderColor: Colors.sepia },
  scoreChipDeclined: { backgroundColor: Colors.raised,     borderColor: Colors.hairStrong },
  scoreChipText:     { fontFamily: Fonts.monoMedium, fontSize: 10, fontWeight: '600' },

  verdictBlock: {
    backgroundColor: Colors.raised,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: Colors.hair,
    borderLeftWidth: 2,
    padding: Space.md,
    marginBottom: Space.sm,
  },
  verdictHead:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  agentDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.ink },
  verdictLabel:    { flex: 1, fontSize: 9, color: Colors.muted, letterSpacing: 1.2, textTransform: 'uppercase', fontWeight: '500' },
  verdictPill:     { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1 },
  verdictPillText: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5 },
  verdictBody:     { fontFamily: Fonts.serif, fontSize: 12.5, color: Colors.inkSoft, lineHeight: 19 },

  foot:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: Space.xs },
  footLabel:    { fontSize: 10, color: Colors.muted, letterSpacing: 1.2, textTransform: 'uppercase' },
  footRight:    { flexDirection: 'row', alignItems: 'center', gap: Space.sm },
  footArrow:    { fontSize: 14, color: Colors.muted },
  exitBadge:    { backgroundColor: Colors.raised, borderWidth: 1, borderColor: Colors.hairStrong,
                  borderRadius: Radii.xs, paddingHorizontal: 6, paddingVertical: 2 },
  exitBadgeText:{ fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted },
});
