import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Colors, Fonts, Space, Radii } from '../../theme/tokens';
import { ScoutCandidate, ScoutTab } from '../../types';
import { SCOUT_MOMENTUM, SCOUT_VALUE } from '../../data/scoutCandidates';
import { getBatchPrices } from '../../services/marketData';
import { analyseStock } from '../../services/stockAnalysis';
import { useAppStore } from '../../store/useAppStore';
import StockCard from '../../components/StockCard';
import HandshakeDrawer from '../../components/HandshakeDrawer';
import AlertBanner from '../../components/AlertBanner';

const CLAUDE_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';

export default function ScoutScreen() {
  const {
    scoutTab, setScoutTab,
    selectedStock, setSelectedStock,
    commitPosition,
    alert, dismissAlert,
  } = useAppStore();

  const [candidates, setCandidates] = useState<ScoutCandidate[]>(
    scoutTab === 'momentum' ? SCOUT_MOMENTUM : SCOUT_VALUE
  );
  const [refreshing, setRefreshing] = useState(false);

  // Mutable ref so handleCardPress always reads the latest candidates
  // without being recreated on every render.
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  // Stable callback — never recreated, safe to pass to React.memo'd cards.
  const handleCardPress = useCallback((ticker: string) => {
    const stock = candidatesRef.current.find(c => c.ticker === ticker) ?? null;
    setSelectedStock(stock);
  }, [setSelectedStock]);

  const loadData = useCallback(async () => {
    const base = scoutTab === 'momentum' ? SCOUT_MOMENTUM : SCOUT_VALUE;

    // Reset to seed immediately so the list is always visible —
    // no conditional hide that unmounts cards and loses scroll position.
    setCandidates(base);
    setRefreshing(true);

    // 1. Fetch live prices for the whole universe in one batch
    const prices = await getBatchPrices(base.map(c => c.ticker)).catch(() => ({}));
    const withPrices = base.map(c => ({
      ...c,
      price: (prices as Record<string, number>)[c.ticker] ?? c.price,
    }));
    setCandidates(withPrices);
    setRefreshing(false);

    // 2. Score each stock progressively.
    //    Each individual setCandidates call only causes cards whose data
    //    changed to re-render (guarded by React.memo + propsAreEqual).
    const updated = [...withPrices];
    for (let i = 0; i < updated.length; i++) {
      const c = updated[i];
      try {
        const result = await analyseStock(c.ticker, c.name, c.price, CLAUDE_KEY, c.sector);
        const rsi = result.signals.rsi;
        updated[i] = {
          ...c,
          indicator: {
            label: 'RSI 14',
            value: rsi !== null ? rsi.toFixed(1) : '—',
            tone:  result.breakdown.rsiOversold    ? 'accent'
                 : rsi !== null && rsi < 50        ? 'sepia' : 'muted',
          },
          verdict:      result.verdict,
          score:        result.score,
          signals:      result.signals,
          breakdown:    result.breakdown,
          expectedDays: result.expectedDays ?? undefined,
        };
        setCandidates([...updated]);
      } catch { /* keep current card data on error */ }
    }
  }, [scoutTab]);

  useEffect(() => { loadData(); }, [loadData]);

  const approved = useMemo(
    () => candidates.filter(c => c.verdict.status === 'APPROVED').length,
    [candidates]
  );

  return (
    <SafeAreaView style={s.safe}>
      {alert && (
        <AlertBanner
          ticker={alert.ticker} name={alert.name} price={alert.price}
          onDismiss={dismissAlert}
        />
      )}

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>SCOUTING HUB</Text>
            <Text style={s.title}>{"Today's\nopportunities"}</Text>
          </View>
          <Pressable style={s.filterBtn} onPress={loadData}>
            {refreshing
              ? <ActivityIndicator size="small" color={Colors.muted} />
              : <Text style={s.filterIcon}>⟳</Text>
            }
          </Pressable>
        </View>

        {/* Meta strip */}
        <View style={s.metaStrip}>
          <View style={s.metaPiece}>
            <View style={[s.metaDot, refreshing && s.metaDotPulsing]} />
            <Text style={s.metaLabel}>Run</Text>
            <Text style={s.metaValue}>09:15 IST</Text>
          </View>
          <View style={s.divider} />
          <View style={s.metaPiece}>
            <Text style={s.metaLabel}>Universe</Text>
            <Text style={s.metaValue}>NIFTY 500</Text>
          </View>
          <View style={s.divider} />
          <View style={s.metaPiece}>
            <Text style={s.metaLabel}>Cleared</Text>
            <Text style={s.metaValue}>{approved}/{candidates.length}</Text>
          </View>
        </View>

        {/* Segmented control */}
        <View style={s.segmented}>
          {(['momentum', 'value'] as ScoutTab[]).map(tab => (
            <Pressable
              key={tab}
              style={[s.segBtn, scoutTab === tab && s.segBtnActive]}
              onPress={() => setScoutTab(tab)}
            >
              <Text style={[s.segLabel, scoutTab === tab && s.segLabelActive]}>
                {tab === 'momentum' ? 'Short-Term' : 'Long-Term'}
              </Text>
              <Text style={[s.segCount, scoutTab === tab && s.segLabelActive]}>
                {tab === 'momentum' ? SCOUT_MOMENTUM.length : SCOUT_VALUE.length}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Cards — always rendered; React.memo guards individual re-renders */}
        {candidates.map(c => (
          <StockCard key={c.ticker} data={c} onPress={handleCardPress} />
        ))}

        <Text style={s.footnote}>
          Notes by Claude Finance Agent · executions stay manual on Groww.
        </Text>
        <View style={{ height: 24 }} />
      </ScrollView>

      <HandshakeDrawer
        stock={selectedStock}
        strategyType={scoutTab === 'momentum' ? 'SHORT_TERM' : 'LONG_TERM'}
        onClose={() => setSelectedStock(null)}
        onCommit={pos => { commitPosition(pos); setSelectedStock(null); }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.canvas },
  scroll: { flex: 1, paddingHorizontal: Space.lg },
  header: { flexDirection: 'row', justifyContent: 'space-between',
            alignItems: 'flex-start', paddingTop: Space.base, marginBottom: Space.md },
  eyebrow:   { fontSize: 10, color: Colors.muted, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: '500', marginBottom: 4 },
  title:     { fontFamily: Fonts.serifMedium, fontSize: 26, color: Colors.ink, lineHeight: 32, letterSpacing: -0.5 },
  filterBtn: { width: 36, height: 36, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.hair,
               alignItems: 'center', justifyContent: 'center', marginTop: 28 },
  filterIcon:{ fontSize: 18, color: Colors.muted },
  metaStrip:     { flexDirection: 'row', borderWidth: 1, borderColor: Colors.hair, borderRadius: Radii.md, padding: 10, marginBottom: Space.md },
  metaPiece:     { flex: 1, alignItems: 'center', gap: 2 },
  metaDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  metaDotPulsing:{ backgroundColor: Colors.sepia },
  metaLabel:     { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  metaValue:     { fontFamily: Fonts.mono, fontSize: 11, color: Colors.ink },
  divider:       { width: 1, height: 18, backgroundColor: Colors.hair, alignSelf: 'center' },
  segmented:      { flexDirection: 'row', backgroundColor: Colors.raised, borderWidth: 1,
                    borderColor: Colors.hair, borderRadius: Radii.md, padding: 3, marginBottom: Space.base },
  segBtn:         { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                    gap: 6, paddingVertical: 8, borderRadius: Radii.sm },
  segBtnActive:   { backgroundColor: Colors.canvas, borderWidth: 1, borderColor: Colors.hairStrong },
  segLabel:       { fontFamily: Fonts.mono, fontSize: 12, color: Colors.muted },
  segLabelActive: { color: Colors.ink, fontWeight: '500' },
  segCount:       { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted2 },
  footnote: { fontFamily: Fonts.mono, fontSize: 10.5, color: Colors.muted2, textAlign: 'center', marginTop: Space.sm },
});
