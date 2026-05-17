import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, Pressable, Alert } from 'react-native';
import { Colors, Fonts, Space, Radii } from '../../theme/tokens';
import { useAppStore } from '../../store/useAppStore';
import PositionCard from '../../components/PositionCard';
import AlertBanner from '../../components/AlertBanner';
import { sendSystemOnline } from '../../services/telegramService';

export default function PortfolioScreen() {
  const { positions, refreshPrices, alert, dismissAlert } = useAppStore();
  const [pinging, setPinging] = useState(false);

  useEffect(() => { if (positions.length > 0) refreshPrices(); }, []);

  const totalNotional = positions.reduce((a, p) => a + p.current * p.qty, 0);
  const totalEntry    = positions.reduce((a, p) => a + p.entry * p.qty, 0);
  const totalPnl      = totalEntry > 0
    ? Math.round(((totalNotional - totalEntry) / totalEntry) * 10000) / 100
    : 0;
  const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const handleSystemPing = async () => {
    setPinging(true);
    try {
      await sendSystemOnline();
      Alert.alert('Sent ✓', 'System Online message delivered to Telegram.');
    } catch {
      Alert.alert('Failed', 'Could not reach Telegram. Check your bot token and chat ID in .env.');
    } finally {
      setPinging(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      {alert && <AlertBanner ticker={alert.ticker} name={alert.name} price={alert.price} onDismiss={dismissAlert} />}

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>ACTIVE SENTINEL</Text>
            <Text style={s.title}>Your positions</Text>
          </View>
          <Pressable style={s.refreshBtn} onPress={refreshPrices}>
            <Text style={s.refreshIcon}>⟳</Text>
          </Pressable>
        </View>

        {positions.length > 0 && (
          <View style={s.summaryCard}>
            <View style={s.summaryCol}>
              <Text style={s.summaryLabel}>Notional</Text>
              <Text style={s.summaryValue}>₹ {fmt(totalNotional)}</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryCol}>
              <Text style={s.summaryLabel}>P/L</Text>
              <Text style={[s.summaryValue, { color: totalPnl >= 0 ? Colors.accentInk : Colors.danger }]}>
                {totalPnl >= 0 ? '+' : ''}{totalPnl.toFixed(2)}%
              </Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryCol}>
              <Text style={s.summaryLabel}>Positions</Text>
              <Text style={s.summaryValue}>{positions.length}</Text>
            </View>
          </View>
        )}

        <View style={s.sectionHead}>
          <Text style={s.sectionTitle}>TRACKING</Text>
          <Text style={s.sectionMeta}>{positions.length} open · Groww linked</Text>
        </View>

        {positions.length === 0 ? (
          <View style={s.empty}>
            <Text style={s.emptyIcon}>▦</Text>
            <Text style={s.emptyTitle}>No positions yet</Text>
            <Text style={s.emptySub}>Tap a stock card on the Scout tab and execute your first handshake.</Text>
          </View>
        ) : (
          positions.map(p => <PositionCard key={p.id} position={p} />)
        )}

        {/* Telegram integration test */}
        <View style={s.systemCard}>
          <View style={s.systemRow}>
            <View style={s.systemDot} />
            <Text style={s.systemLabel}>TELEGRAM INTEGRATION</Text>
          </View>
          <Text style={s.systemSub}>
            Sends a test ping to confirm your bot token and chat ID are working.
          </Text>
          <Pressable
            style={[s.pingBtn, pinging && s.pingBtnDisabled]}
            onPress={handleSystemPing}
            disabled={pinging}
          >
            <Text style={s.pingBtnText}>
              {pinging ? 'Sending…' : '🚀  Send System Online ping'}
            </Text>
          </Pressable>
        </View>

        <View style={{ height: 24 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.canvas },
  scroll: { flex: 1, paddingHorizontal: Space.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', paddingTop: Space.base, marginBottom: Space.md },
  eyebrow:{ fontSize: 10, color: Colors.muted, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: '500', marginBottom: 4 },
  title:  { fontFamily: Fonts.serifMedium, fontSize: 26, color: Colors.ink, letterSpacing: -0.5 },
  refreshBtn: { width: 36, height: 36, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.hair, alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  refreshIcon:{ fontSize: 18, color: Colors.muted },
  summaryCard:    { flexDirection: 'row', borderWidth: 1, borderColor: Colors.hair, borderRadius: Radii.card, marginBottom: Space.md },
  summaryCol:     { flex: 1, alignItems: 'center', paddingVertical: Space.base },
  summaryDivider: { width: 1, backgroundColor: Colors.hair, marginVertical: Space.sm },
  summaryLabel:   { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  summaryValue:   { fontFamily: Fonts.monoMedium, fontSize: 14, color: Colors.ink },
  sectionHead:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: Space.sm, borderBottomWidth: 1, borderColor: Colors.hair, marginBottom: Space.md },
  sectionTitle: { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 1 },
  sectionMeta:  { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted2 },
  empty:      { alignItems: 'center', paddingTop: 60, paddingHorizontal: Space.xl },
  emptyIcon:  { fontSize: 32, color: Colors.hair, marginBottom: Space.md },
  emptyTitle: { fontFamily: Fonts.serif, fontSize: 16, color: Colors.ink, marginBottom: 8 },
  emptySub:   { fontSize: 12, color: Colors.muted, textAlign: 'center', lineHeight: 18 },

  systemCard: { marginTop: Space.xl, borderWidth: 1, borderColor: Colors.hair,
                borderRadius: Radii.card, padding: Space.base, backgroundColor: Colors.raised },
  systemRow:  { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 6 },
  systemDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  systemLabel:{ fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted,
                textTransform: 'uppercase', letterSpacing: 1 },
  systemSub:  { fontSize: 11.5, color: Colors.muted, lineHeight: 17, marginBottom: Space.md },
  pingBtn:        { backgroundColor: Colors.ink, borderRadius: Radii.sm, paddingVertical: 11,
                    alignItems: 'center' },
  pingBtnDisabled:{ opacity: 0.45 },
  pingBtnText:    { fontFamily: Fonts.mono, fontSize: 12, color: Colors.canvas },
});
