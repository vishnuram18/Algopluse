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
import { saveCandidatesCache, getCandidatesCache } from '../../services/database';
import { useAppStore } from '../../store/useAppStore';
import StockCard from '../../components/StockCard';
import HandshakeDrawer from '../../components/HandshakeDrawer';
import AlertBanner from '../../components/AlertBanner';
import { useConnectionPulse } from '../../hooks/useConnectionPulse';
import UserAvatar from '../../components/UserAvatar';

const CLAUDE_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';

type DataSourceMode = 'LIVE' | 'CACHED';

function formatAge(cachedAt: number): string {
  const mins = Math.round((Date.now() - cachedAt) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

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
  const [refreshing,  setRefreshing]  = useState(false);
  const [mode,        setMode]        = useState<DataSourceMode>('LIVE');
  const [cachedAt,    setCachedAt]    = useState<number | null>(null);
  const [toast,       setToast]       = useState<string | null>(null);

  const pulse       = useConnectionPulse();
  const userProfile = useAppStore(s => s.userProfile);

  // Ref so handleCardPress is always stable
  const candidatesRef = useRef(candidates);
  candidatesRef.current = candidates;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }, []);

  const handleCardPress = useCallback((ticker: string) => {
    const stock = candidatesRef.current.find(c => c.ticker === ticker) ?? null;
    setSelectedStock(stock);
  }, [setSelectedStock]);

  // ── Load from SQLite cache ────────────────────────────────────────────────────
  const loadFromCache = useCallback(async (): Promise<boolean> => {
    try {
      const cached = await getCandidatesCache();
      if (!cached) return false;
      const parsed: ScoutCandidate[] = JSON.parse(cached.json);
      // Filter to current tab
      const base = scoutTab === 'momentum' ? SCOUT_MOMENTUM : SCOUT_VALUE;
      const baseTickers = new Set(base.map(c => c.ticker));
      const filtered = parsed.filter(c => baseTickers.has(c.ticker));
      if (filtered.length === 0) return false;
      setCandidates(filtered);
      setCachedAt(cached.cachedAt);
      return true;
    } catch {
      return false;
    }
  }, [scoutTab]);

  // ── Live fetch ────────────────────────────────────────────────────────────────
  const loadLive = useCallback(async () => {
    const base = scoutTab === 'momentum' ? SCOUT_MOMENTUM : SCOUT_VALUE;
    setCandidates(base);
    setRefreshing(true);

    const prices = await getBatchPrices(base.map(c => c.ticker)).catch(() => ({}));
    const withPrices = base.map(c => ({
      ...c,
      price: (prices as Record<string, number>)[c.ticker] ?? c.price,
    }));
    setCandidates(withPrices);
    setRefreshing(false);

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
      } catch { /* keep current card data */ }
    }

    // Persist the full enriched list for Local Mode
    const now = Date.now();
    saveCandidatesCache(JSON.stringify(updated)).catch(() => {});
    setCachedAt(now);
  }, [scoutTab]);

  // ── Main load dispatcher ──────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    if (mode === 'CACHED') {
      const ok = await loadFromCache();
      if (!ok) showToast('No cache yet — switching to Live');
      else     return;
    }
    await loadLive();
  }, [mode, loadFromCache, loadLive, showToast]);

  // ── Reload button handler ─────────────────────────────────────────────────────
  const handleReload = useCallback(() => {
    pulse.check();

    if (pulse.isUp === false && mode === 'LIVE') {
      // Auto-switch to cache and notify
      setMode('CACHED');
      showToast('APIs Offline — switching to Local Cache');
      loadFromCache().catch(() => {});
      return;
    }

    loadData();
  }, [pulse, mode, loadData, loadFromCache, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  const approved = useMemo(
    () => candidates.filter(c => c.verdict.status === 'APPROVED').length,
    [candidates]
  );

  const isCached = mode === 'CACHED';

  return (
    <SafeAreaView style={s.safe}>
      {alert && (
        <AlertBanner
          ticker={alert.ticker} name={alert.name} price={alert.price}
          onDismiss={dismissAlert}
        />
      )}

      {/* Toast notification */}
      {toast && (
        <View style={s.toast}>
          <Text style={s.toastText}>{toast}</Text>
        </View>
      )}

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>SCOUTING HUB</Text>
            <Text style={s.title}>{"Today's\nopportunities"}</Text>
          </View>
          <View style={s.headerRight}>
            {/* Connection pulse dot */}
            <View style={[
              s.pulseDot,
              pulse.isUp === true  && s.pulseDotUp,
              pulse.isUp === false && s.pulseDotDown,
            ]} />
            {pulse.isUp === false && (
              <Text style={s.pulseOffline}>Offline</Text>
            )}
            {/* User avatar */}
            {userProfile && <UserAvatar profile={userProfile} size={30} />}
            {/* Source toggle */}
            <Pressable
              style={[s.modeToggle, isCached && s.modeToggleCached]}
              onPress={() => {
                const next: DataSourceMode = isCached ? 'LIVE' : 'CACHED';
                setMode(next);
              }}
            >
              <Text style={[s.modeToggleText, isCached && s.modeToggleTextCached]}>
                {isCached ? 'Local' : 'Sync'}
              </Text>
            </Pressable>
            {/* Reload */}
            <Pressable style={s.filterBtn} onPress={handleReload}>
              {refreshing
                ? <ActivityIndicator size="small" color={Colors.muted} />
                : <Text style={s.filterIcon}>⟳</Text>
              }
            </Pressable>
          </View>
        </View>

        {/* Cached data banner */}
        {isCached && (
          <View style={s.cacheBanner}>
            <Text style={s.cacheBannerText}>
              {cachedAt
                ? `Local cache · saved ${formatAge(cachedAt)}`
                : 'Local cache · no data yet'}
            </Text>
            <Pressable onPress={() => { setMode('LIVE'); loadLive(); }}>
              <Text style={s.cacheBannerRefresh}>Go Live</Text>
            </Pressable>
          </View>
        )}

        {/* Meta strip — sepia tint in cached mode */}
        <View style={[s.metaStrip, isCached && s.metaStripCached]}>
          <View style={s.metaPiece}>
            <View style={[s.metaDot, refreshing && s.metaDotPulsing]} />
            <Text style={s.metaLabel}>Run</Text>
            <Text style={[s.metaValue, isCached && s.metaValueCached]}>09:15 IST</Text>
          </View>
          <View style={s.divider} />
          <View style={s.metaPiece}>
            <Text style={s.metaLabel}>Universe</Text>
            <Text style={[s.metaValue, isCached && s.metaValueCached]}>NIFTY 500</Text>
          </View>
          <View style={s.divider} />
          <View style={s.metaPiece}>
            <Text style={s.metaLabel}>Cleared</Text>
            <Text style={[s.metaValue, isCached && s.metaValueCached]}>{approved}/{candidates.length}</Text>
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

  // Toast
  toast:     { position: 'absolute', top: 56, left: 20, right: 20, zIndex: 99,
               backgroundColor: Colors.ink, borderRadius: Radii.md,
               paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
  toastText: { fontFamily: Fonts.mono, fontSize: 11.5, color: Colors.canvas },

  // Header
  header:    { flexDirection: 'row', justifyContent: 'space-between',
               alignItems: 'flex-start', paddingTop: Space.base, marginBottom: Space.md },
  eyebrow:   { fontSize: 10, color: Colors.muted, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: '500', marginBottom: 4 },
  title:     { fontFamily: Fonts.serifMedium, fontSize: 26, color: Colors.ink, lineHeight: 32, letterSpacing: -0.5 },
  headerRight:     { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 28 },
  pulseDot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.hair },
  pulseDotUp:      { backgroundColor: '#22c55e' },
  pulseDotDown:    { backgroundColor: '#f87171' },
  pulseOffline:    { fontFamily: Fonts.mono, fontSize: 9.5, color: '#f87171', letterSpacing: 0.4 },
  modeToggle:      { paddingHorizontal: 8, paddingVertical: 4, borderRadius: Radii.sm,
                     borderWidth: 1, borderColor: Colors.hairStrong,
                     backgroundColor: Colors.raised },
  modeToggleCached:{ backgroundColor: Colors.sepiaSoft, borderColor: Colors.sepia },
  modeToggleText:      { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted },
  modeToggleTextCached:{ color: Colors.sepia },
  filterBtn: { width: 36, height: 36, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.hair,
               alignItems: 'center', justifyContent: 'center' },
  filterIcon:{ fontSize: 18, color: Colors.muted },

  // Cached data banner
  cacheBanner:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                       backgroundColor: Colors.sepiaSoft, borderWidth: 1, borderColor: Colors.sepia,
                       borderRadius: Radii.sm, paddingHorizontal: 12, paddingVertical: 7,
                       marginBottom: Space.sm },
  cacheBannerText:   { fontFamily: Fonts.mono, fontSize: 10.5, color: Colors.sepia },
  cacheBannerRefresh:{ fontFamily: Fonts.mono, fontSize: 10.5, color: Colors.sepia, fontWeight: '600',
                       textDecorationLine: 'underline' },

  // Meta strip
  metaStrip:      { flexDirection: 'row', borderWidth: 1, borderColor: Colors.hair, borderRadius: Radii.md, padding: 10, marginBottom: Space.md },
  metaStripCached:{ borderColor: Colors.sepia, backgroundColor: Colors.sepiaSoft },
  metaPiece:      { flex: 1, alignItems: 'center', gap: 2 },
  metaDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  metaDotPulsing: { backgroundColor: Colors.sepia },
  metaLabel:      { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted, textTransform: 'uppercase', letterSpacing: 0.8 },
  metaValue:      { fontFamily: Fonts.mono, fontSize: 11, color: Colors.ink },
  metaValueCached:{ color: Colors.sepia },
  divider:        { width: 1, height: 18, backgroundColor: Colors.hair, alignSelf: 'center' },

  // Segmented control
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
