import React from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts, Radii, Space } from '../theme/tokens';
import { ScoutCandidate, ScoreBreakdown } from '../types';

interface Props {
  data:    ScoutCandidate;
  onPress: (ticker: string) => void;  // stable ticker-keyed callback
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

// Stable formatter — defined outside the component so it is never recreated
const fmt = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function StockCard({ data, onPress }: Props) {
  const up         = data.change >= 0;
  const verdict    = VERDICT_COLORS[data.verdict.tone];
  const indToneKey = data.indicator.tone === 'accent' ? 'approved'
                   : data.indicator.tone === 'sepia'  ? 'watch' : 'declined';
  const indTone    = VERDICT_COLORS[indToneKey];

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

      {/* Score row — visible once analyseStock has run */}
      {data.breakdown && (
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

// Only re-render a card when its visible data actually changes.
// ticker/name/exchange/currency/sector are immutable — not compared.
function propsAreEqual(prev: Props, next: Props): boolean {
  const a = prev.data;
  const b = next.data;
  return (
    prev.onPress       === next.onPress        &&
    a.price            === b.price             &&
    a.change           === b.change            &&
    a.score            === b.score             &&
    a.expectedDays     === b.expectedDays      &&
    a.indicator.value  === b.indicator.value   &&
    a.indicator.tone   === b.indicator.tone    &&
    a.verdict.status   === b.verdict.status    &&
    a.verdict.body     === b.verdict.body
  );
}

export default React.memo(StockCard, propsAreEqual);
