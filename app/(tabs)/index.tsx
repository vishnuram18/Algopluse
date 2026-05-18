import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Colors, Fonts, Space, Radii } from '../../theme/tokens';
import { ScoutCandidate, ScoutTab } from '../../types';
import { PHONE_SCAN_UNIVERSE, NiftyStock } from '../../data/nifty500';
import { getBatchPrices } from '../../services/marketData';
import { analyseStock } from '../../services/stockAnalysis';
import {
  saveCandidatesCache, getCandidatesCache,
  getScanIntervalMins, setScanIntervalMins,
  getPcServerUrl,
} from '../../services/database';
import { useAppStore } from '../../store/useAppStore';
import StockCard from '../../components/StockCard';
import HandshakeDrawer from '../../components/HandshakeDrawer';
import AlertBanner from '../../components/AlertBanner';
import { useConnectionPulse } from '../../hooks/useConnectionPulse';
import UserAvatar from '../../components/UserAvatar';

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
  const [pcServerUrl,  setPcServerUrl_] = useState('');

  const pulse       = useConnectionPulse();
  const userProfile = useAppStore(s => s.userProfile);

  const candidatesRef = useRef(candidates);
  const intervalRef   = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMounted     = useRef(true);
  const loadLiveRef   = useRef<() => Promise<void>>(async () => {});
  candidatesRef.current = candidates;

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(msg);
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  }, []);

  const handleCardPress = useCallback((ticker: string) => {
    const stock = candidatesRef.current.find(c => c.ticker === ticker) ?? null;
    setSelectedStock(stock);
  }, [setSelectedStock]);

  // ── Display candidates sorted by active tab ───────────────────────────────
  const displayCandidates = useMemo(() => {
    const key = scoutTab === 'momentum' ? 'swing' : 'intraday';
    return [...candidates].sort((a, b) => {
      const sa = a.weightedScore?.[key] ?? 0;
      const sb = b.weightedScore?.[key] ?? 0;
      return sb - sa;
    });
  }, [candidates, scoutTab]);

  // ── Qualified counts for segmented control ────────────────────────────────
  const swingCleared    = useMemo(() => candidates.filter(c => (c.weightedScore?.swing    ?? 0) >= 55).length, [candidates]);
  const intradayCleared = useMemo(() => candidates.filter(c => (c.weightedScore?.intraday ?? 0) >= 60).length, [candidates]);
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

  // ── Live fetch — scans PHONE_SCAN_UNIVERSE (top 100 Nifty by market cap) ─
  const loadLive = useCallback(async () => {
    setCandidates([]);
    setRefreshing(true);

    const allTickers = PHONE_SCAN_UNIVERSE.map(s => s.ticker);
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

    // Build initial placeholders for stocks that have a live price
    const initialCandidates: ScoutCandidate[] = PHONE_SCAN_UNIVERSE
      .filter(s => (priceMap[s.ticker] ?? 0) > 0)
      .map(s => makePlaceholder(s, priceMap[s.ticker]));

    if (isMounted.current) {
      setCandidates(initialCandidates);
      setRefreshing(false);
      setMode('LIVE');
    }

    // Analyse each stock sequentially, updating cards as results arrive
    const updated = [...initialCandidates];
    for (let i = 0; i < updated.length; i++) {
      if (!isMounted.current) return;
      const c = updated[i];
      try {
        const result = await analyseStock(c.ticker, c.name, c.price, CLAUDE_KEY, c.sector);
        const ws  = result.weightedScore;
        const best = Math.max(ws.swing, ws.intraday);
        updated[i] = {
          ...c,
          indicator: {
            label: 'SCORE',
            value: `${best}/100`,
            tone:  best >= 70 ? 'accent' : best >= 45 ? 'sepia' : 'muted',
          },
          verdict:       result.verdict,
          score:         result.score,
          signals:       result.signals,
          breakdown:     result.breakdown,
          expectedDays:  result.expectedDays ?? undefined,
          weightedScore: result.weightedScore,
          scanSource:    'phone',
        };
        if (isMounted.current) setCandidates([...updated]);
      } catch { /* keep placeholder card */ }
    }

    if (!isMounted.current) return;
    const now = Date.now();
    saveCandidatesCache(JSON.stringify(updated)).catch(() => {});
    setCachedAt(now);
  }, [loadFromCache, showToast]);

  // ── PC reachability check ─────────────────────────────────────────────────
  const checkPcServer = useCallback(async (url: string): Promise<boolean> => {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 4000);
    try {
      const res = await fetch(url.endsWith('/') ? url + 'health' : url + '/health', {
        signal: controller.signal,
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(t);
    }
  }, []);

  // ── Reload button ─────────────────────────────────────────────────────────
  const handleReload = useCallback(async () => {
    pulse.check();

    if (mode === 'CACHED') {
      const ok = await loadFromCache();
      if (!ok) showToast('No cache yet — wait for auto-refresh or switch to Live');
      return;
    }

    if (pcServerUrl) {
      const up = await checkPcServer(pcServerUrl);
      if (!up) showToast('PC offline — fetching directly from phone');
    }

    loadLive();
  }, [pulse, mode, pcServerUrl, checkPcServer, loadLive, loadFromCache, showToast]);

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

  // ── On mount: load settings → try cache → start live scan ────────────────
  useEffect(() => {
    Promise.all([
      getScanIntervalMins().catch(() => 0),
      getPcServerUrl().catch(() => ''),
    ]).then(([mins, url]) => {
      setIntervalMins(mins);
      setPcServerUrl_(url);
    });

    loadFromCache().then(ok => {
      if (ok) setMode('CACHED');
      loadLive();
    });
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
            <Pressable onPress={loadLive}>
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
              {candidates.length > 0 ? `${candidates.length} stocks` : 'NIFTY 500'}
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
                {tab === 'momentum' ? 'Swing Picks' : 'Intraday Picks'}
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
            <Text style={s.emptyStateText}>Scanning Nifty 500…</Text>
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
