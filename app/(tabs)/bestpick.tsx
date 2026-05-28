import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, ScrollView, Pressable, StyleSheet,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import { Colors, Fonts, Space, Radii } from '../../theme/tokens';
import { ScoutCandidate } from '../../types';
import { getCandidatesCache } from '../../services/database';
import { getBatchPriceDetails } from '../../services/marketData';
import { NIFTY_500 } from '../../data/nifty500';

const GAINER_UNIVERSE = NIFTY_500.slice(0, 50);

function formatAge(cachedAt: number): string {
  const mins = Math.round((Date.now() - cachedAt) / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const color = score >= 70 ? Colors.accent : score >= 45 ? Colors.sepia : Colors.hairStrong;
  return (
    <View style={s.scoreRow}>
      <Text style={s.scoreLabel}>{label}</Text>
      <View style={s.scoreTrack}>
        <View style={[s.scoreFill, { width: `${score}%` as any, backgroundColor: color }]} />
      </View>
      <Text style={[s.scoreNum, { color }]}>{score}</Text>
    </View>
  );
}

export default function BestPickScreen() {
  const [topPick,     setTopPick]     = useState<ScoutCandidate | null>(null);
  const [cachedAt,    setCachedAt]    = useState<number | null>(null);
  const [topLoading,  setTopLoading]  = useState(true);
  const [topError,    setTopError]    = useState<string | null>(null);

  const [gainer,        setGainer]        = useState<{ ticker: string; name: string; sector: string; price: number; changePercent: number } | null>(null);
  const [gainerLoading, setGainerLoading] = useState(true);
  const [gainerError,   setGainerError]   = useState<string | null>(null);

  const loadTopPick = useCallback(async () => {
    setTopLoading(true);
    setTopError(null);
    try {
      const cached = await getCandidatesCache();
      if (!cached) { setTopError('No scan data yet — run the Scout tab first'); return; }
      const candidates: ScoutCandidate[] = JSON.parse(cached.json);
      if (candidates.length === 0) { setTopError('No scan data yet — run the Scout tab first'); return; }
      // Weight timing (intraday) 65% over value (swing) 35% — for swing trades
      // a cheap stock in a downtrend should not beat a trending stock on fundamentals alone.
      const blend = (c: ScoutCandidate) =>
        (c.weightedScore?.swing ?? 0) * 0.35 + (c.weightedScore?.intraday ?? 0) * 0.65;
      const best = candidates.reduce((a, b) => blend(b) > blend(a) ? b : a);
      setTopPick(best);
      setCachedAt(cached.cachedAt);
    } catch {
      setTopError('Failed to read scan cache');
    } finally {
      setTopLoading(false);
    }
  }, []);

  const loadGainer = useCallback(async () => {
    setGainerLoading(true);
    setGainerError(null);
    try {
      const tickers = GAINER_UNIVERSE.map(s => s.ticker);
      const details = await getBatchPriceDetails(tickers);
      const entries = Object.entries(details);
      if (entries.length === 0) { setGainerError('Offline — check connection'); return; }
      const [bestTicker, bestDetail] = entries.reduce((a, b) => b[1].changePercent > a[1].changePercent ? b : a);
      const stock = GAINER_UNIVERSE.find(s => s.ticker === bestTicker);
      setGainer({
        ticker: bestTicker,
        name: stock?.name ?? bestTicker,
        sector: stock?.sector ?? '',
        price: bestDetail.price,
        changePercent: bestDetail.changePercent,
      });
    } catch {
      setGainerError('Offline — check connection');
    } finally {
      setGainerLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTopPick();
    loadGainer();
  }, [loadTopPick, loadGainer]);

  const refresh = useCallback(() => {
    loadTopPick();
    loadGainer();
  }, [loadTopPick, loadGainer]);

  const swing    = topPick?.weightedScore?.swing    ?? 0;
  const intraday = topPick?.weightedScore?.intraday ?? 0;
  const bestScore = Math.max(swing, intraday);
  const verdictColor = bestScore >= 70 ? Colors.accent : bestScore >= 45 ? Colors.sepia : Colors.muted;
  const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={s.header}>
          <View>
            <Text style={s.eyebrow}>BEST PICK</Text>
            <Text style={s.title}>{"Today's top\nopportunities"}</Text>
          </View>
          <Pressable style={s.refreshBtn} onPress={refresh}>
            {(topLoading || gainerLoading)
              ? <ActivityIndicator size="small" color={Colors.muted} />
              : <Text style={s.refreshIcon}>⟳</Text>
            }
          </Pressable>
        </View>

        {/* ── Top Scored ───────────────────────────────────────────────── */}
        <Text style={s.sectionLabel}>TOP SCORED</Text>

        <View style={s.card}>
          {topLoading ? (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color={Colors.accent} />
              <Text style={s.loadingText}>Reading scan cache…</Text>
            </View>
          ) : topError ? (
            <Text style={s.errorText}>{topError}</Text>
          ) : topPick ? (
            <>
              {/* Head */}
              <View style={s.cardHead}>
                <View style={s.cardHeadLeft}>
                  <Text style={s.ticker}>{topPick.ticker} · NSE</Text>
                  <Text style={s.name}>{topPick.name}</Text>
                </View>
                <View style={[s.verdictPill, { borderColor: verdictColor }]}>
                  <Text style={[s.verdictText, { color: verdictColor }]}>
                    {topPick.verdict.status}
                  </Text>
                </View>
              </View>

              {/* Price */}
              <Text style={s.price}>₹{fmt(topPick.price)}</Text>
              <Text style={s.sector}>{topPick.sector}</Text>

              {/* Score bars */}
              <View style={s.scoreBars}>
                <ScoreBar label="Swing" score={swing} />
                <ScoreBar label="Intraday" score={intraday} />
              </View>

              {/* Source */}
              <Text style={s.sourceNote}>{topPick.verdict.body}</Text>
            </>
          ) : null}
        </View>

        {cachedAt && !topLoading && !topError && (
          <Text style={s.footnote}>From last scan · saved {formatAge(cachedAt)}</Text>
        )}

        {/* ── Biggest Gainer ───────────────────────────────────────────── */}
        <Text style={[s.sectionLabel, { marginTop: Space.xl }]}>BIGGEST GAINER TODAY</Text>

        <View style={s.card}>
          {gainerLoading ? (
            <View style={s.loadingRow}>
              <ActivityIndicator size="small" color={Colors.accent} />
              <Text style={s.loadingText}>Fetching live prices…</Text>
            </View>
          ) : gainerError ? (
            <Text style={s.errorText}>{gainerError}</Text>
          ) : gainer ? (
            <>
              <View style={s.cardHead}>
                <View style={s.cardHeadLeft}>
                  <Text style={s.ticker}>{gainer.ticker} · NSE</Text>
                  <Text style={s.name}>{gainer.name}</Text>
                </View>
                <View style={[s.changePill, gainer.changePercent >= 0 ? s.changePillUp : s.changePillDown]}>
                  <Text style={[s.changeText, gainer.changePercent >= 0 ? s.changeTextUp : s.changeTextDown]}>
                    {gainer.changePercent >= 0 ? '+' : ''}{gainer.changePercent.toFixed(2)}%
                  </Text>
                </View>
              </View>

              <Text style={s.price}>₹{fmt(gainer.price)}</Text>
              <Text style={s.sector}>{gainer.sector}</Text>
              <Text style={s.sourceNote}>vs previous close · Nifty 50 universe</Text>
            </>
          ) : null}
        </View>

        {!gainerLoading && !gainerError && (
          <Text style={s.footnote}>Live · from Nifty 50 universe</Text>
        )}

        <View style={{ height: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: Colors.canvas },
  scroll: { flex: 1, paddingHorizontal: Space.lg },

  header:      { flexDirection: 'row', justifyContent: 'space-between',
                 alignItems: 'flex-start', paddingTop: Space.base, marginBottom: Space.lg },
  eyebrow:     { fontSize: 10, color: Colors.muted, letterSpacing: 1.4,
                 textTransform: 'uppercase', fontWeight: '500', marginBottom: 4 },
  title:       { fontFamily: Fonts.serifMedium, fontSize: 26, color: Colors.ink,
                 lineHeight: 32, letterSpacing: -0.5 },
  refreshBtn:  { width: 36, height: 36, borderRadius: Radii.md, borderWidth: 1,
                 borderColor: Colors.hair, alignItems: 'center', justifyContent: 'center',
                 marginTop: 28 },
  refreshIcon: { fontSize: 18, color: Colors.muted },

  sectionLabel: { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted,
                  letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: Space.sm },

  card: { borderWidth: 1, borderColor: Colors.hair, borderRadius: Radii.card,
          backgroundColor: Colors.raised, padding: Space.base, marginBottom: Space.sm },

  loadingRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  loadingText: { fontFamily: Fonts.mono, fontSize: 11, color: Colors.muted },
  errorText:   { fontFamily: Fonts.mono, fontSize: 11, color: Colors.muted,
                 paddingVertical: 4 },

  cardHead:     { flexDirection: 'row', justifyContent: 'space-between',
                  alignItems: 'flex-start', marginBottom: Space.sm },
  cardHeadLeft: { flex: 1, marginRight: Space.sm },
  ticker:       { fontFamily: Fonts.mono, fontSize: 10.5, color: Colors.muted,
                  letterSpacing: 0.5, marginBottom: 2 },
  name:         { fontFamily: Fonts.serifMedium, fontSize: 16, color: Colors.ink, lineHeight: 20 },

  verdictPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radii.xs,
                 borderWidth: 1, backgroundColor: Colors.canvas },
  verdictText: { fontFamily: Fonts.mono, fontSize: 9, fontWeight: '600', letterSpacing: 0.4 },

  changePill:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: Radii.xs, borderWidth: 1 },
  changePillUp:   { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: '#22c55e' },
  changePillDown: { backgroundColor: 'rgba(239,68,68,0.08)', borderColor: '#ef4444' },
  changeText:     { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '600' },
  changeTextUp:   { color: '#16a34a' },
  changeTextDown: { color: '#dc2626' },

  price:  { fontFamily: Fonts.serifMedium, fontSize: 22, color: Colors.ink, marginBottom: 2 },
  sector: { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted2, marginBottom: Space.md },

  scoreBars: { gap: 6, marginBottom: Space.sm },
  scoreRow:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreLabel:{ fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.muted,
               width: 52, textTransform: 'uppercase' },
  scoreTrack:{ flex: 1, height: 4, backgroundColor: Colors.hair, borderRadius: 2, overflow: 'hidden' },
  scoreFill: { height: 4, borderRadius: 2 },
  scoreNum:  { fontFamily: Fonts.mono, fontSize: 11, fontWeight: '600', width: 28,
               textAlign: 'right' },

  sourceNote: { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted2, fontStyle: 'italic' },
  footnote:   { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted2,
                textAlign: 'center', marginBottom: Space.sm },
});
