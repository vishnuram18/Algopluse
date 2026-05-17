import React, { useState } from 'react';
import { View, Text, StyleSheet, LayoutChangeEvent, Pressable, Alert } from 'react-native';
import { Colors, Fonts, Radii, Space } from '../theme/tokens';
import { Position, PositionStatus } from '../types';
import { useAppStore } from '../store/useAppStore';

const STATUS_COLORS: Record<PositionStatus, { text: string; bg: string; dot: string }> = {
  'Tracking':    { text: Colors.muted,     bg: Colors.raised,    dot: Colors.muted     },
  'Near Target': { text: Colors.sepia,     bg: Colors.sepiaSoft, dot: Colors.sepia     },
  'Target hit':  { text: Colors.accentInk, bg: Colors.accentSoft,dot: Colors.accent    },
  'Drawdown':    { text: Colors.danger,    bg: 'rgba(185,64,48,0.08)', dot: Colors.danger },
};

interface Props { position: Position }

export default function PositionCard({ position: p }: Props) {
  const [trackWidth, setTrackWidth] = useState(0);
  const statusColors   = STATUS_COLORS[p.status];
  const removePosition = useAppStore(s => s.removePosition);

  const handleRemove = () => {
    Alert.alert(
      'Mark as Sold',
      `Remove ${p.ticker} from tracking? This confirms you have sold the position on Groww.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sold — Remove',
          style: 'destructive',
          onPress: () => {
            removePosition(p.id).catch(() => {
              Alert.alert('Error', 'Could not remove position. Please try again.');
            });
          },
        },
      ]
    );
  };
  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Clamp progress to [0, 1]
  const rawProgress   = (p.current - p.entry) / (p.target - p.entry);
  const progress      = Math.max(0, Math.min(1, rawProgress));
  const fillWidth     = trackWidth * progress;
  const dotLeft       = trackWidth * progress - 5.5; // 11px dot, centered
  const fillColor     = p.status === 'Target hit' ? Colors.accent : Colors.inkSoft;

  const onTrackLayout = (e: LayoutChangeEvent) => setTrackWidth(e.nativeEvent.layout.width);

  return (
    <View style={s.card}>
      {/* Top row */}
      <View style={s.topRow}>
        <View>
          <Text style={s.ticker}>{p.ticker}</Text>
          <Text style={s.sub}>{p.qty} sh · opened {p.opened}</Text>
        </View>
        <View style={s.rightCol}>
          <Text style={[s.pnl, { color: p.pnl >= 0 ? Colors.accentInk : Colors.danger }]}>
            {p.pnl >= 0 ? '+' : ''}{p.pnl.toFixed(2)}%
          </Text>
          <View style={[s.statusPill, { backgroundColor: statusColors.bg }]}>
            <View style={[s.statusDot, { backgroundColor: statusColors.dot }]} />
            <Text style={[s.statusText, { color: statusColors.text }]}>{p.status}</Text>
          </View>
        </View>
      </View>

      {/* Progress track */}
      <View style={s.trackWrap} onLayout={onTrackLayout}>
        {/* Background rail */}
        <View style={s.rail}>
          {/* Fill */}
          {trackWidth > 0 && (
            <View style={[s.fill, { width: fillWidth, backgroundColor: fillColor }]} />
          )}
          {/* Quarter-mark sliver ticks */}
          {[0.25, 0.5, 0.75].map(pct => (
            <View key={pct} style={[s.tick, { left: `${pct * 100}%` as any }]} />
          ))}
        </View>

        {/* Entry dot — left edge */}
        <View style={[s.edgeDot, { left: -3.5, backgroundColor: Colors.inkSoft }]} />

        {/* Target dot — right edge */}
        <View style={[s.edgeDot, { right: -3.5,
          backgroundColor: p.status === 'Target hit' ? Colors.accent : Colors.inkSoft }]}
        />

        {/* Current price dot — movable */}
        {trackWidth > 0 && (
          <View style={[s.currentDot, { left: dotLeft,
            borderColor: p.status === 'Target hit' ? Colors.accent : Colors.ink }]}>
            <Text style={s.currentLabel}>₹{fmt(p.current)}</Text>
          </View>
        )}
      </View>

      {/* Edge labels */}
      <View style={s.edgeLabels}>
        <View>
          <Text style={s.edgeLabelTitle}>Entry</Text>
          <Text style={s.edgeLabelPrice}>₹{fmt(p.entry)}</Text>
        </View>
        {p.expectedDays != null && (
          <View style={s.exitBadge}>
            <Text style={s.exitBadgeText}>Est. exit {p.expectedDays}d</Text>
          </View>
        )}
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.edgeLabelTitle}>Target</Text>
          <Text style={s.edgeLabelPrice}>₹{fmt(p.target)}</Text>
        </View>
      </View>

      {/* Sold / remove button */}
      <Pressable
        style={({ pressed }) => [s.soldBtn, pressed && s.soldBtnPressed]}
        onPress={handleRemove}
      >
        <Text style={s.soldBtnText}>Sold on Groww — Remove</Text>
        <Text style={s.soldBtnArrow}>✕</Text>
      </Pressable>
    </View>
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
  topRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: Space.sm + 2 },
  ticker:     { fontFamily: Fonts.serifMedium, fontSize: 17, color: Colors.ink },
  sub:        { fontSize: 11, color: Colors.muted, marginTop: 2 },
  rightCol:   { alignItems: 'flex-end', gap: 5 },
  pnl:        { fontFamily: Fonts.monoMedium, fontSize: 14 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 99 },
  statusDot:  { width: 5, height: 5, borderRadius: 3 },
  statusText: { fontFamily: Fonts.mono, fontSize: 9.5, textTransform: 'uppercase', letterSpacing: 0.5 },

  trackWrap:  { marginTop: Space.xs, marginBottom: 6, height: 28, justifyContent: 'center' },
  rail:       { height: 4, backgroundColor: Colors.hair, borderRadius: 99, overflow: 'visible', position: 'relative' },
  fill:       { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 99 },
  tick:       { position: 'absolute', top: 0, bottom: 0, width: 1, backgroundColor: Colors.canvas },
  edgeDot:    { position: 'absolute', top: 10, width: 7, height: 7, borderRadius: 4, borderWidth: 2, borderColor: Colors.canvas },
  currentDot: { position: 'absolute', top: 8, width: 11, height: 11, borderRadius: 6,
                backgroundColor: Colors.canvas, borderWidth: 2 },
  currentLabel:{ position: 'absolute', bottom: 14, left: -20, width: 60,
                 fontFamily: Fonts.mono, fontSize: 9, color: Colors.ink, textAlign: 'center' },

  edgeLabels:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 2 },
  edgeLabelTitle: { fontFamily: Fonts.mono, fontSize: 9, color: Colors.muted2, textTransform: 'uppercase', letterSpacing: 0.5 },
  edgeLabelPrice: { fontFamily: Fonts.mono, fontSize: 10.5, color: Colors.muted, marginTop: 1 },
  exitBadge:      { backgroundColor: Colors.raised, borderWidth: 1, borderColor: Colors.hairStrong,
                    borderRadius: Radii.xs, paddingHorizontal: 6, paddingVertical: 3 },
  exitBadgeText:  { fontFamily: Fonts.mono, fontSize: 9, color: Colors.muted },

  soldBtn:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    marginTop: Space.md, paddingVertical: Space.sm, paddingHorizontal: Space.md,
                    borderWidth: 1, borderColor: Colors.hairStrong, borderRadius: Radii.sm,
                    backgroundColor: Colors.raised },
  soldBtnPressed: { backgroundColor: 'rgba(185,64,48,0.06)', borderColor: Colors.danger },
  soldBtnText:    { fontFamily: Fonts.mono, fontSize: 11, color: Colors.muted },
  soldBtnArrow:   { fontSize: 11, color: Colors.muted2 },
});
