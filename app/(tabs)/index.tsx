import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Colors, Fonts, Space, Radii } from '../../theme/tokens';
import { ScoutCandidate, ScoutTab } from '../../types';
import { PHONE_SCAN_UNIVERSE, NiftyStock } from '../../data/nifty500';
import { getNiftyUniverse, UniverseSource } from '../../services/niftyUniverseService';
import { getBatchPrices } from '../../services/marketData';
import { analyseGrahamStock } from '../../services/grahamScorer';
import {
  saveCandidatesCache, getCandidatesCache,
  getScanIntervalMins, setScanIntervalMins,
} from '../../services/database';
import { useAppStore } from '../../store/useAppStore';
import StockCard from '../../components/StockCard';
import HandshakeDrawer from '../../components/HandshakeDrawer';
import AlertBanner from '../../components/AlertBanner';
import { useConnectionPulse } from '../../hooks/useConnectionPulse';
import UserAvatar from '../../components/UserAvatar';
import { getFirebaseScan, saveFirebaseScan } from '../../services/firebaseService';

const CLAUDE_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';

type DataSourceMode = 'LIVE' | 'CACHED';

const INTERVAL_OPTIONS: { label: string; mins: number }[] = [
  { label: 'Manual', mins: 0  },
  { label: '5m',     mins: 5  },
  { label: '10m',    mins: 10 },
  { label: '30m',    mins: 30 },
  { label: '1h',     mins: 60 },
];

function formatAge(cachedAt: number): string {
  const mins = Math.round((Date.now() - cachedAt) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function makePlaceholder(stock: NiftyStock, price: number): ScoutCandidate {
  return {
    ticker:    stock.ticker,
    name:      stock.name,
    exchange:  'NSE',
    price,
    currency:  '₹',
    change:    0,
    sector:    stock.sector,
    indicator: { label: 'Scanning', value: '…', tone: 'muted' },
    verdict:   { status: 'WATCH', tone: 'watch', body: 'Analysis in progress…' },
    scanSource: 'phone',
  };
}

export default function ScoutScreen() {
  const {
    scoutTab, setScoutTab,
    selectedStock, setSelectedStock,
    commitPosition,
    alert, dismissAlert,
  } = useAppStore();

  const [candidates,   setCandidates]   = useState<ScoutCandidate[]>([]);
  const [refreshing,   setRefreshing]   = useState(false);
  const [mode,         setMode]         = useState<DataSourceMode>('LIVE');
  const [cachedAt,     setCachedAt]     = useState<number | null>(null);
  const [toast,        setToast]        = useState<string | null>(null);
  const [intervalMins, setIntervalMins] = useState(0);

  const pulse       = useConnectionPulse();
  const userProfile = useAppStore(s => s.userProfile);

  const [universeSource, setUniverseSource] = useState<UniverseSource>('fallback');

  const candidatesRef    = useRef(candidates);
  const intervalRef      = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted        = useRef(true);
  const loadLiveRef      = useRef<() => Promise<void>>(async () => {});
  const scanUniverseRef  = useRef<NiftyStock[]>(PHONE_SCAN_UNIVERSE);
  candidatesRef.current  = candidates;

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const handleCardPress = useCallback((ticker: string) => {
    const stock = candidatesRef.current.find(c => c.ticker === ticker) ?? null;
    setSelectedStock(stock);
  }, [setSelectedStock]);

  const displayCandidates = useMemo(() => {
    const key = scoutTab === 'momentum' ? 'swing' : 'intraday';
    return [...candidates].sort((a, b) => {
      const sa = a.weightedScore?.[key] ?? 0;
      const sb = b.weightedScore?.[key] ?? 0;
      return sb - sa;
    });
  }, [candidates, scoutTab]);

  // ── Qualified counts for segmented control ────────────────────────────────
  const swingCleared    = useMemo(() => candidates.filter(c => (c.weightedScore?.swing    ?? 0) >= 50).length, [candidates]);
  const intradayCleared = useMemo(() => candidates.filter(c => (c.weightedScore?.intraday ?? 0) >= 25).length, [candidates]);
  const approved        = useMemo(() => candidates.filter(c => c.verdict.status === 'APPROVED').length, [candidates]);

  // ── Load from SQLite cache ────────────────────────────────────────────────
  const loadFromCache = useCallback(async (): Promise<boolean> => {
    try {
      const cached = await getCandidatesCache();
      if (!cached) return false;
      const parsed: ScoutCandidate[] = JSON.parse(cached.json);
      if (parsed.length === 0) return false;
      setCandidates(parsed);
      setCachedAt(cached.cachedAt);
      return true;
    } catch {
      return false;
    }
  }, []);

  // ── Live fetch — tries Firebase first, falls back to phone scan ──────────
  const loadLive = useCallback(async () => {
    setCandidates([]);
    setRefreshing(true);

    // 1. Try Firebase cloud scan (fresh within 4 hours)
    const cloudScan = await getFirebaseScan();
    if (cloudScan) {
      const age = Date.now() - cloudScan.cachedAt;
      if (age < 4 * 60 * 60 * 1000) {
        const cloudCandidates: ScoutCandidate[] = JSON.parse(cloudScan.json);
        if (cloudCandidates.length > 0) {
          if (!isMounted.current) return;
          setCandidates(cloudCandidates);
          setMode('LIVE');
          setRefreshing(false);
          saveCandidatesCache(cloudScan.json).catch(() => {});
          setCachedAt(cloudScan.cachedAt);
          showToast(`Cloud scan — ${cloudCandidates.length} picks from Nifty 200`);
          return;
        }
      }
    }

    // 2. Phone fallback: scan universe, keep top 15 that pass the gate
    const universe   = scanUniverseRef.current;
    const allTickers = universe.map(s => s.ticker);
    const prices = await getBatchPrices(allTickers).catch(() => ({}));
    if (!isMounted.current) return;

    const priceMap = prices as Record<string, number>;
    const anyPrice = Object.values(priceMap).some(p => p > 0);

    if (!anyPrice) {
      setRefreshing(false);
      const ok = await loadFromCache();
      if (!isMounted.current) return;
      if (ok) {
        setMode('CACHED');
        showToast('No connection — showing local cache');
      } else {
        showToast('No connection and no cache yet');
      }
      return;
    }

    const stocksWithPrice = universe.filter(s => (priceMap[s.ticker] ?? 0) > 0);
    if (isMounted.current) {
      setCandidates(stocksWithPrice.map(s => makePlaceholder(s, priceMap[s.ticker])));
      setMode('LIVE');
      setRefreshing(false);
    }

    // Analyse stocks with bounded concurrency — 8 workers pull from a shared queue.
    // ~8x faster than sequential; safe in JS single-thread (shift/push are atomic between awaits).
    const passed: ScoutCandidate[] = [];
    const queue = [...stocksWithPrice];
    const worker = async () => {
      while (queue.length > 0) {
        if (!isMounted.current) return;
        const s = queue.shift();
        if (!s) break;
        try {
          const result = await analyseGrahamStock(s.ticker, s.name, priceMap[s.ticker], CLAUDE_KEY, s.sector);
          if (!isMounted.current) return;
          const ws = result.weightedScore;
          const best = Math.max(ws.swing, ws.intraday);
          passed.push({
            ticker:    s.ticker,
            name:      s.name,
            exchange:  'NSE',
            price:     priceMap[s.ticker],
            currency:  '₹',
            change:    0,
            sector:    s.sector,
            indicator: {
              label: 'GRAHAM',
              value: `${best}/100`,
              tone:  best >= 70 ? 'accent' : best >= 45 ? 'sepia' : 'muted',
            },
            verdict:       result.verdict,
            score:         result.score,
            signals:       result.signals,
            breakdown:     result.breakdown,
            expectedDays:  result.expectedDays ?? undefined,
            weightedScore: ws,
            scanSource:    'phone',
          });
          const top15 = [...passed]
            .sort((a, b) => Math.max(b.weightedScore!.swing, b.weightedScore!.intraday)
                          - Math.max(a.weightedScore!.swing, a.weightedScore!.intraday))
            .slice(0, 15);
          if (isMounted.current) setCandidates(top15);
        } catch { /* skip failed ticker */ }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));

    if (!isMounted.current) return;
    const top15Final = [...passed]
      .sort((a, b) => Math.max(b.weightedScore!.swing, b.weightedScore!.intraday)
                    - Math.max(a.weightedScore!.swing, a.weightedScore!.intraday))
      .slice(0, 15);

    if (isMounted.current) setCandidates(top15Final);
    const now = Date.now();
    saveCandidatesCache(JSON.stringify(top15Final)).catch(() => {});
    setCachedAt(now);
    saveFirebaseScan(top15Final).catch(() => {});
  }, [loadFromCache, showToast]);

  // ── Reload button ─────────────────────────────────────────────────────────
  const handleReload = useCallback(async () => {
    pulse.check();

    if (mode === 'CACHED') {
      const ok = await loadFromCache();
      if (!ok) showToast('No cache yet — wait for auto-refresh or switch to Live');
      return;
    }

    loadLive();
  }, [pulse, mode, loadLive, loadFromCache, showToast]);


  // ── Auto-refresh interval ─────────────────────────────────────────────────
  const changeInterval = useCallback(async (mins: number) => {
    setIntervalMins(mins);
    await setScanIntervalMins(mins).catch(() => {});
  }, []);

  useEffect(() => { loadLiveRef.current = loadLive; }, [loadLive]);

  useEffect(() => {
    if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    if (intervalMins > 0) {
      intervalRef.current = setInterval(() => { loadLiveRef.current(); }, intervalMins * 60_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [intervalMins]);

  // ── Unmount cleanup ───────────────────────────────────────────────────────
  useEffect(() => () => {
    isMounted.current = false;
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  // ── On mount: load settings → fetch universe → try cache → live scan ────
  // Sequential so interval is resolved before loadLive fires.
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const mins = await getScanIntervalMins().catch(() => 0);
      if (cancelled) return;
      setIntervalMins(mins);

      try {
        const { top100, source } = await getNiftyUniverse();
        if (!cancelled) {
          scanUniverseRef.current = top100;
          setUniverseSource(source);
          if (source === 'live')     showToast(`Stock list updated — ${top100.length} stocks from NSE`);
          if (source === 'fallback') showToast('Using offline stock list');
        }
      } catch {}

      if (cancelled) return;
      const ok = await loadFromCache();
      if (cancelled) return;
      if (ok) setMode('CACHED');
      loadLive();
    }
    init();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCached = mode === 'CACHED';

  return (
    <SafeAreaView style={s.safe}>
      {alert && (
        <AlertBanner
          ticker={alert.ticker} name={alert.name} price={alert.price}
          onDismiss={dismissAlert}
        />
      )}

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
            <View style={[
              s.pulseDot,
              pulse.isUp === true  && s.pulseDotUp,
              pulse.isUp === false && s.pulseDotDown,
            ]} />
            {pulse.isUp === false && (
              <Text style={s.pulseOffline}>Offline</Text>
            )}
            {userProfile && <UserAvatar profile={userProfile} size={30} />}
            <View style={[s.modeTag, isCached && s.modeTagCached]}>
              <Text style={[s.modeTagText, isCached && s.modeTagTextCached]}>
                {isCached ? 'Cache' : 'Live'}
              </Text>
            </View>
            <Pressable style={s.filterBtn} onPress={handleReload}>
              {refreshing
                ? <ActivityIndicator size="small" color={Colors.muted} />
                : <Text style={s.filterIcon}>⟳</Text>
              }
            </Pressable>
          </View>
        </View>

        {/* Cached data banner */}
        {isCached && cachedAt && (
          <View style={s.cacheBanner}>
            <Text style={s.cacheBannerText}>
              Local cache · saved {formatAge(cachedAt)}
            </Text>
            <Pressable onPress={() => loadLive()}>
              <Text style={s.cacheBannerRefresh}>Refresh now</Text>
            </Pressable>
          </View>
        )}

        {/* Meta strip */}
        <View style={[s.metaStrip, isCached && s.metaStripCached]}>
          <View style={s.metaPiece}>
            <View style={[s.metaDot, refreshing && s.metaDotPulsing]} />
            <Text style={s.metaLabel}>Status</Text>
            <Text style={[s.metaValue, isCached && s.metaValueCached]}>
              {refreshing ? 'Scanning…' : isCached ? 'Cached' : 'Live'}
            </Text>
          </View>
          <View style={s.metaDivider} />
          <View style={s.metaPiece}>
            <Text style={s.metaLabel}>Universe</Text>
            <Text style={[s.metaValue, isCached && s.metaValueCached]}>
              {`${scanUniverseRef.current.length} · ${universeSource === 'live' ? 'NSE live' : universeSource === 'cached' ? 'NSE cache' : 'offline'}`}
            </Text>
          </View>
          <View style={s.metaDivider} />
          <View style={s.metaPiece}>
            <Text style={s.metaLabel}>Cleared</Text>
            <Text style={[s.metaValue, isCached && s.metaValueCached]}>{approved}/{candidates.length}</Text>
          </View>
        </View>

        {/* Auto-refresh interval picker */}
        <View style={s.intervalRow}>
          <Text style={s.intervalLabel}>Auto-refresh</Text>
          <View style={s.intervalPills}>
            {INTERVAL_OPTIONS.map(opt => (
              <Pressable
                key={opt.mins}
                style={[s.intervalPill, intervalMins === opt.mins && s.intervalPillActive]}
                onPress={() => changeInterval(opt.mins)}
              >
                <Text style={[s.intervalPillText, intervalMins === opt.mins && s.intervalPillTextActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Segmented control — Swing Picks / Intraday Picks */}
        <View style={s.segmented}>
          {(['momentum', 'value'] as ScoutTab[]).map(tab => (
            <Pressable
              key={tab}
              style={[s.segBtn, scoutTab === tab && s.segBtnActive]}
              onPress={() => setScoutTab(tab)}
            >
              <Text style={[s.segLabel, scoutTab === tab && s.segLabelActive]}>
                {tab === 'momentum' ? 'Swing' : 'Intraday'}
              </Text>
              <Text style={[s.segCount, scoutTab === tab && s.segLabelActive]}>
                {tab === 'momentum' ? swingCleared : intradayCleared}
              </Text>
            </Pressable>
          ))}
        </View>

        {candidates.length === 0 && refreshing && (
          <View style={s.emptyState}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={s.emptyStateText}>
              {`Scanning ${scanUniverseRef.current.length} stocks…`}
            </Text>
          </View>
        )}

        {displayCandidates.map(c => (
          <StockCard key={c.ticker} data={c} onPress={handleCardPress} />
        ))}

        {candidates.length > 0 && (
          <Text style={s.footnote}>
            {candidates.length} stocks scanned from Nifty 500 · executions stay manual on Groww.
          </Text>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>

      <HandshakeDrawer
        stock={selectedStock}
        strategyType={scoutTab === 'momentum' ? 'SHORT_TERM' : 'LONG_TERM'}
        onClose={() => setSelectedStock(null)}
        onCommit={pos => {
          commitPosition(pos).catch(() => showToast('Failed to save position — try again'));
        }}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.canvas },
  scroll: { flex: 1, paddingHorizontal: Space.lg },

  toast:     { position: 'absolute', top: 56, left: 20, right: 20, zIndex: 99,
               backgroundColor: Colors.ink, borderRadius: Radii.md,
               paddingHorizontal: 14, paddingVertical: 9, alignItems: 'center' },
  toastText: { fontFamily: Fonts.mono, fontSize: 11.5, color: Colors.canvas },

  header:      { flexDirection: 'row', justifyContent: 'space-between',
                 alignItems: 'flex-start', paddingTop: Space.base, marginBottom: Space.md },
  eyebrow:     { fontSize: 10, color: Colors.muted, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: '500', marginBottom: 4 },
  title:       { fontFamily: Fonts.serifMedium, fontSize: 26, color: Colors.ink, lineHeight: 32, letterSpacing: -0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 28 },

  pulseDot:     { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.hair },
  pulseDotUp:   { backgroundColor: '#22c55e' },
  pulseDotDown: { backgroundColor: '#f87171' },
  pulseOffline: { fontFamily: Fonts.mono, fontSize: 9.5, color: '#f87171', letterSpacing: 0.4 },

  modeTag:         { paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radii.xs,
                     borderWidth: 1, borderColor: Colors.hairStrong, backgroundColor: Colors.raised },
  modeTagCached:   { backgroundColor: Colors.sepiaSoft, borderColor: Colors.sepia },
  modeTagText:     { fontFamily: Fonts.mono, fontSize: 9, color: Colors.muted },
  modeTagTextCached:{ color: Colors.sepia },

  filterBtn:  { width: 36, height: 36, borderRadius: Radii.md, borderWidth: 1, borderColor: Colors.hair,
                alignItems: 'center', justifyContent: 'center' },
  filterIcon: { fontSize: 18, color: Colors.muted },

  cacheBanner:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                        backgroundColor: Colors.sepiaSoft, borderWidth: 1, borderColor: Colors.sepia,
                        borderRadius: Radii.sm, paddingHorizontal: 12, paddingVertical: 7,
                        marginBottom: Space.sm },
  cacheBannerText:    { fontFamily: Fonts.mono, fontSize: 10.5, color: Colors.sepia },
  cacheBannerRefresh: { fontFamily: Fonts.mono, fontSize: 10.5, color: Colors.sepia,
                        fontWeight: '600', textDecorationLine: 'underline' },

  metaStrip:      { flexDirection: 'row', borderWidth: 1, borderColor: Colors.hair,
                    borderRadius: Radii.md, padding: 10, marginBottom: Space.sm },
  metaStripCached:{ borderColor: Colors.sepia, backgroundColor: Colors.sepiaSoft },
  metaPiece:      { flex: 1, alignItems: 'center', gap: 2 },
  metaDot:        { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  metaDotPulsing: { backgroundColor: Colors.sepia },
  metaLabel:      { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted,
                    textTransform: 'uppercase', letterSpacing: 0.8 },
  metaValue:      { fontFamily: Fonts.mono, fontSize: 11, color: Colors.ink },
  metaValueCached:{ color: Colors.sepia },
  metaDivider:    { width: 1, height: 18, backgroundColor: Colors.hair, alignSelf: 'center' },

  intervalRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: Space.sm },
  intervalLabel:{ fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted,
                  textTransform: 'uppercase', letterSpacing: 0.8 },
  intervalPills:{ flexDirection: 'row', gap: 4, flex: 1 },
  intervalPill: { flex: 1, paddingVertical: 5, alignItems: 'center', borderRadius: Radii.xs,
                  borderWidth: 1, borderColor: Colors.hair, backgroundColor: Colors.raised },
  intervalPillActive:    { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  intervalPillText:      { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted },
  intervalPillTextActive:{ color: Colors.accentInk, fontWeight: '600' },

  segmented:    { flexDirection: 'row', backgroundColor: Colors.raised, borderWidth: 1,
                  borderColor: Colors.hair, borderRadius: Radii.md, padding: 3,
                  marginBottom: Space.base },
  segBtn:       { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: 6, paddingVertical: 8, borderRadius: Radii.sm },
  segBtnActive: { backgroundColor: Colors.canvas, borderWidth: 1, borderColor: Colors.hairStrong },
  segLabel:     { fontFamily: Fonts.mono, fontSize: 12, color: Colors.muted },
  segLabelActive:{ color: Colors.ink, fontWeight: '500' },
  segCount:     { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted2 },

  emptyState:     { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyStateText: { fontFamily: Fonts.mono, fontSize: 12, color: Colors.muted },

  footnote: { fontFamily: Fonts.mono, fontSize: 10.5, color: Colors.muted2,
              textAlign: 'center', marginTop: Space.sm },

});
