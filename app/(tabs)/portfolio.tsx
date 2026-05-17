import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, SafeAreaView, Pressable, Alert } from 'react-native';
import { Colors, Fonts, Space, Radii } from '../../theme/tokens';
import { useAppStore } from '../../store/useAppStore';
import PositionCard from '../../components/PositionCard';
import AlertBanner from '../../components/AlertBanner';
import { sendSystemOnline } from '../../services/telegramService';
import { marketCalendar } from '../../services/marketCalendarService';
import {
  signInWithGoogle, signOut, isSignedIn,
  backupToDrive, restoreFromDrive,
} from '../../services/driveBackupService';
import { CalendarEntry } from '../../types';

export default function PortfolioScreen() {
  const { positions, refreshPrices, alert, dismissAlert } = useAppStore();
  const [pinging,        setPinging]        = useState(false);
  const [calBusy,        setCalBusy]        = useState(false);
  const [driveSignedIn,  setDriveSignedIn]  = useState(false);
  const [driveBusy,      setDriveBusy]      = useState(false);
  const [todayEntry,     setTodayEntry]     = useState<CalendarEntry | null>(null);
  const [upcoming,       setUpcoming]       = useState<CalendarEntry[]>([]);
  const [marketOpen,     setMarketOpen]     = useState<boolean | null>(null);

  useEffect(() => { if (positions.length > 0) refreshPrices(); }, []);

  const refreshCalendar = useCallback(async () => {
    try {
      const [entry, open, next] = await Promise.all([
        marketCalendar.getTodayEntry(),
        marketCalendar.isMarketOpen(),
        marketCalendar.getUpcoming(5),
      ]);
      setTodayEntry(entry);
      setMarketOpen(open);
      setUpcoming(next);
    } catch { /* DB may not be ready on very first mount */ }
  }, []);

  useEffect(() => { refreshCalendar(); }, [refreshCalendar]);

  useEffect(() => {
    isSignedIn().then(setDriveSignedIn).catch(() => {});
  }, []);

  const handleDriveAuth = async () => {
    if (driveSignedIn) {
      Alert.alert('Sign out of Google?', 'Your local data will not be affected.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: async () => {
            await signOut();
            setDriveSignedIn(false);
          },
        },
      ]);
      return;
    }
    setDriveBusy(true);
    try {
      const ok = await signInWithGoogle();
      setDriveSignedIn(ok);
      if (!ok) Alert.alert('Sign-in cancelled');
    } catch (e: unknown) {
      Alert.alert('Google Sign-in Failed', e instanceof Error ? e.message : String(e));
    } finally {
      setDriveBusy(false);
    }
  };

  const handleBackup = async () => {
    setDriveBusy(true);
    try {
      await backupToDrive();
      Alert.alert('Backed up ✓', 'sync_backup.json saved to your Drive appDataFolder.');
    } catch (e: unknown) {
      Alert.alert('Backup failed', e instanceof Error ? e.message : String(e));
    } finally {
      setDriveBusy(false);
    }
  };

  const handleRestore = async () => {
    Alert.alert(
      'Restore from Cloud?',
      'This will merge Drive backup data into your local database. Existing positions are kept.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Restore', onPress: async () => {
            setDriveBusy(true);
            try {
              const result = await restoreFromDrive();
              await refreshPrices();
              Alert.alert('Restored ✓', result.message);
            } catch (e: unknown) {
              Alert.alert('Restore failed', e instanceof Error ? e.message : String(e));
            } finally {
              setDriveBusy(false);
            }
          },
        },
      ]
    );
  };

  const totalNotional = positions.reduce((a, p) => a + p.current * p.qty, 0);
  const totalEntry    = positions.reduce((a, p) => a + p.entry * p.qty, 0);
  const totalPnl      = totalEntry > 0
    ? Math.round(((totalNotional - totalEntry) / totalEntry) * 10000) / 100
    : 0;
  const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

  const handleMarkHoliday = async () => {
    setCalBusy(true);
    try {
      await marketCalendar.markHoliday(marketCalendar.todayIST(), 'Manual override');
      await refreshCalendar();
    } catch { Alert.alert('Error', 'Could not update calendar.'); }
    finally { setCalBusy(false); }
  };

  const handleMarkSpecial = async () => {
    setCalBusy(true);
    try {
      await marketCalendar.markSpecialTradingDay(marketCalendar.todayIST(), 'Manual override');
      await refreshCalendar();
    } catch { Alert.alert('Error', 'Could not update calendar.'); }
    finally { setCalBusy(false); }
  };

  const handleClearOverride = async () => {
    setCalBusy(true);
    try {
      await marketCalendar.clearOverride(marketCalendar.todayIST());
      await refreshCalendar();
    } catch { Alert.alert('Error', 'Could not update calendar.'); }
    finally { setCalBusy(false); }
  };

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

        {/* ── Market Control panel ─────────────────────────────────────── */}
        <View style={s.systemCard}>
          <View style={s.systemRow}>
            <View style={[s.systemDot, { backgroundColor: marketOpen ? Colors.accent : Colors.sepia }]} />
            <Text style={s.systemLabel}>MARKET CONTROL</Text>
            <Text style={s.calStatus}>
              {marketOpen === null ? '…' : marketOpen ? 'OPEN' : 'CLOSED'}
            </Text>
          </View>

          {/* Today override badge */}
          {todayEntry ? (
            <View style={s.calBadgeRow}>
              <View style={[
                s.calBadge,
                todayEntry.type === 'HOLIDAY'
                  ? s.calBadgeHoliday : s.calBadgeSpecial,
              ]}>
                <Text style={s.calBadgeText}>
                  {todayEntry.type === 'HOLIDAY' ? 'HOLIDAY' : 'SPECIAL TRADING'} · {todayEntry.label}
                </Text>
              </View>
              <Pressable
                style={[s.calClearBtn, calBusy && s.pingBtnDisabled]}
                onPress={handleClearOverride}
                disabled={calBusy}
              >
                <Text style={s.calClearText}>Clear</Text>
              </Pressable>
            </View>
          ) : (
            <Text style={s.systemSub}>Today: auto (weekday/weekend rule)</Text>
          )}

          {/* Action buttons */}
          <View style={s.calBtnRow}>
            <Pressable
              style={[s.calBtn, s.calBtnHoliday, calBusy && s.pingBtnDisabled]}
              onPress={handleMarkHoliday}
              disabled={calBusy}
            >
              <Text style={s.calBtnText}>Mark Holiday</Text>
            </Pressable>
            <Pressable
              style={[s.calBtn, s.calBtnSpecial, calBusy && s.pingBtnDisabled]}
              onPress={handleMarkSpecial}
              disabled={calBusy}
            >
              <Text style={[s.calBtnText, { color: Colors.accentInk }]}>Enable Session</Text>
            </Pressable>
          </View>

          {/* Upcoming overrides */}
          {upcoming.length > 0 && (
            <View style={s.calList}>
              <Text style={s.calListHead}>UPCOMING OVERRIDES</Text>
              {upcoming.map(e => (
                <View key={e.date} style={s.calListRow}>
                  <Text style={s.calListDate}>{e.date}</Text>
                  <Text style={[
                    s.calListType,
                    e.type === 'HOLIDAY' ? { color: Colors.sepia } : { color: Colors.accentInk },
                  ]}>
                    {e.type === 'HOLIDAY' ? 'Holiday' : 'Special'}
                  </Text>
                  <Text style={s.calListLabel} numberOfLines={1}>{e.label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* ── Google Drive backup ──────────────────────────────────────── */}
        <View style={s.systemCard}>
          <View style={s.systemRow}>
            <View style={[s.systemDot, { backgroundColor: driveSignedIn ? Colors.accent : Colors.muted2 }]} />
            <Text style={s.systemLabel}>DRIVE BACKUP</Text>
            <Text style={s.calStatus}>{driveSignedIn ? 'LINKED' : 'NOT LINKED'}</Text>
          </View>
          <Text style={s.systemSub}>
            {driveSignedIn
              ? 'Backs up your portfolio, calendar overrides, and scout cache to the hidden appDataFolder — invisible in Drive.'
              : 'Sign in with Google to enable automatic cloud backup and one-tap restore after a device reset.'}
          </Text>

          {/* Sign in / out */}
          <Pressable
            style={[s.pingBtn, !driveSignedIn && s.driveSignInBtn, driveBusy && s.pingBtnDisabled]}
            onPress={handleDriveAuth}
            disabled={driveBusy}
          >
            <Text style={[s.pingBtnText, !driveSignedIn && { color: Colors.accentInk }]}>
              {driveBusy ? '…' : driveSignedIn ? 'Sign out of Google' : 'Sign in with Google'}
            </Text>
          </Pressable>

          {driveSignedIn && (
            <View style={s.driveActions}>
              <Pressable
                style={[s.driveBtn, driveBusy && s.pingBtnDisabled]}
                onPress={handleBackup}
                disabled={driveBusy}
              >
                <Text style={s.driveBtnText}>{driveBusy ? 'Working…' : 'Backup Now'}</Text>
              </Pressable>
              <Pressable
                style={[s.driveBtn, s.driveBtnRestore, driveBusy && s.pingBtnDisabled]}
                onPress={handleRestore}
                disabled={driveBusy}
              >
                <Text style={[s.driveBtnText, { color: Colors.accentInk }]}>Restore from Cloud</Text>
              </Pressable>
            </View>
          )}
        </View>

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

  // Market control
  calStatus:      { fontFamily: Fonts.mono, fontSize: 9.5, color: Colors.ink, marginLeft: 'auto',
                    fontWeight: '600', letterSpacing: 0.6 },
  calBadgeRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  calBadge:       { flex: 1, borderRadius: Radii.sm, borderWidth: 1, paddingHorizontal: 8,
                    paddingVertical: 4 },
  calBadgeHoliday:{ backgroundColor: Colors.sepiaSoft, borderColor: Colors.sepia },
  calBadgeSpecial:{ backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  calBadgeText:   { fontFamily: Fonts.mono, fontSize: 10, color: Colors.ink },
  calClearBtn:    { paddingHorizontal: 10, paddingVertical: 5, borderRadius: Radii.sm,
                    borderWidth: 1, borderColor: Colors.hairStrong },
  calClearText:   { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted },
  calBtnRow:      { flexDirection: 'row', gap: 8, marginBottom: 12 },
  calBtn:         { flex: 1, borderRadius: Radii.sm, borderWidth: 1, paddingVertical: 10,
                    alignItems: 'center' },
  calBtnHoliday:  { backgroundColor: Colors.sepiaSoft, borderColor: Colors.sepia },
  calBtnSpecial:  { backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  calBtnText:     { fontFamily: Fonts.mono, fontSize: 11, color: Colors.sepia },
  calList:        { borderTopWidth: 1, borderColor: Colors.hair, paddingTop: 10, gap: 6 },
  calListHead:    { fontFamily: Fonts.mono, fontSize: 9, color: Colors.muted2,
                    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 },
  calListRow:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
  calListDate:    { fontFamily: Fonts.mono, fontSize: 10.5, color: Colors.ink, width: 90 },
  calListType:    { fontFamily: Fonts.mono, fontSize: 10, width: 54 },
  calListLabel:   { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted, flex: 1 },

  // Drive backup
  driveSignInBtn: { backgroundColor: Colors.accentSoft, borderWidth: 1, borderColor: Colors.accent },
  driveActions:   { flexDirection: 'row', gap: 8, marginTop: Space.sm },
  driveBtn:       { flex: 1, borderRadius: Radii.sm, borderWidth: 1,
                    borderColor: Colors.hairStrong, paddingVertical: 10, alignItems: 'center' },
  driveBtnRestore:{ backgroundColor: Colors.accentSoft, borderColor: Colors.accent },
  driveBtnText:   { fontFamily: Fonts.mono, fontSize: 11, color: Colors.ink },
});
