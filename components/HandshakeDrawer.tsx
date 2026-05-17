import React, { useState, useEffect, useRef } from 'react';
import {
  Modal, View, Text, TextInput, Pressable, ScrollView,
  Animated, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Colors, Fonts, Radii, Space } from '../theme/tokens';
import { ScoutCandidate, StrategyType, Position } from '../types';
import { getDailyCloses } from '../services/marketData';
import { getSmartTarget } from '../services/claudeAgent';
import { calculateExpectedDays } from '../services/atrCalculator';

const CLAUDE_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY ?? '';

interface Props {
  stock: ScoutCandidate | null;
  strategyType: StrategyType;
  onClose: () => void;
  onCommit: (pos: Position) => void;
}

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function HandshakeDrawer({ stock, strategyType, onClose, onCommit }: Props) {
  const [price,      setPrice]      = useState('');
  const [qty,        setQty]        = useState('');
  const [executed,   setExecuted]   = useState(false);
  const [step,       setStep]       = useState<'form' | 'calculating' | 'committed'>('form');
  const [targetNote, setTargetNote] = useState('');
  const translateY = useRef(new Animated.Value(600)).current;
  const open = !!stock;

  useEffect(() => {
    if (stock) {
      setPrice(stock.price > 0 ? stock.price.toFixed(2) : '');
      setQty(''); setExecuted(false); setStep('form');
      Animated.timing(translateY, { toValue: 0, duration: 380, useNativeDriver: true }).start();
    } else {
      Animated.timing(translateY, { toValue: 600, duration: 300, useNativeDriver: true }).start();
    }
  }, [open]);

  const parsedPrice = parseFloat(price);
  const parsedQty   = parseInt(qty, 10);
  const notional    = (parsedPrice || 0) * (parsedQty || 0);
  const canCommit   = executed && parsedPrice > 0 && parsedQty > 0;

  const commit = async () => {
    if (!canCommit || !stock) return;
    setStep('calculating');

    const entry = parsedPrice;
    const stop  = Math.round(entry * 0.93 * 100) / 100;
    let target  = Math.round(entry * 1.12 * 100) / 100;

    // Ask Claude for a smarter exit price using recent price history
    if (CLAUDE_KEY && !CLAUDE_KEY.includes('xxxx')) {
      try {
        const closes = await getDailyCloses(stock.ticker, 14);
        const result = await getSmartTarget(
          stock.ticker, stock.name, entry, closes, strategyType, CLAUDE_KEY
        );
        target = result.target;
        setTargetNote(result.rationale);
      } catch {
        // fall back silently — default target already set
      }
    }

    const opened       = new Date().toLocaleDateString('en-IN', { month: 'short', day: '2-digit' });
    const expectedDays = await calculateExpectedDays(stock.ticker, entry, target).catch(() => null);

    const pos: Position = {
      id:           stock.ticker.toLowerCase(),
      ticker:       stock.ticker,
      name:         stock.name,
      entry,
      current:      entry,
      target,
      stopLoss:     stop,
      qty:          parsedQty,
      opened,
      pnl:          0,
      status:       'Tracking',
      strategyType,
      expectedDays: expectedDays ?? stock.expectedDays,
    };
    onCommit(pos);
    setStep('committed');
    setTimeout(onClose, 1100);
  };

  if (!stock) return null;

  return (
    <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
      <Pressable style={s.scrim} onPress={onClose} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.kavWrap}>
        <Animated.View style={[s.sheet, { transform: [{ translateY }] }]}>
          {/* Drag handle */}
          <View style={s.handleWrap}><View style={s.handle} /></View>

          {/* Header */}
          <View style={s.head}>
            <View style={s.eyebrow}>
              <View style={s.eyebrowDot} />
              <Text style={s.eyebrowText}>HANDSHAKE EXECUTION</Text>
            </View>
            <Pressable style={s.closeBtn} onPress={onClose}>
              <Text style={s.closeX}>✕</Text>
            </Pressable>
          </View>

          <ScrollView style={s.scroll} showsVerticalScrollIndicator={false}>
            {/* Title block */}
            <View style={s.titleBlock}>
              <Text style={s.ticker}>{stock.ticker}</Text>
              <Text style={s.exch}>{stock.exchange}</Text>
              <Text style={s.name}>{stock.name}</Text>
              <View style={s.priceRow}>
                <Text style={s.priceCur}>{stock.currency}</Text>
                <Text style={s.price}>{stock.price > 0 ? fmt(stock.price) : '—'}</Text>
                {stock.change !== 0 && (
                  <Text style={[s.change, { color: stock.change >= 0 ? Colors.accentInk : Colors.danger }]}>
                    {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)}%
                  </Text>
                )}
              </View>
            </View>

            {/* Broker note */}
            <View style={s.brokerCard}>
              <View style={s.brokerHead}>
                <Text style={s.brokerLabel}>BROKER</Text>
                <Text style={s.brokerName}>Groww</Text>
              </View>
              <Text style={s.brokerCopy}>
                AlgoPulse never places orders. Execute in your Groww app, then log it here for tracking.
              </Text>
            </View>

            {/* Form */}
            <View style={s.formSection}>
              <Text style={s.formSectionLabel}>Log execution</Text>

              {/* Price field */}
              <View style={s.fieldWrap}>
                <View style={s.fieldHead}>
                  <Text style={s.fieldLabel}>Execution Price</Text>
                  <Text style={s.fieldHint}>Last tape {stock.currency}{stock.price > 0 ? fmt(stock.price) : '—'}</Text>
                </View>
                <View style={s.inputRow}>
                  <Text style={s.inputPrefix}>{stock.currency}</Text>
                  <TextInput
                    style={s.input}
                    value={price}
                    onChangeText={setPrice}
                    placeholder="0.00"
                    placeholderTextColor={Colors.muted2}
                    keyboardType="decimal-pad"
                  />
                </View>
              </View>

              {/* Qty field */}
              <View style={s.fieldWrap}>
                <View style={s.fieldHead}>
                  <Text style={s.fieldLabel}>Share Quantity</Text>
                  <Text style={s.fieldHint}>Whole shares only</Text>
                </View>
                <View style={s.inputRow}>
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={qty}
                    onChangeText={t => setQty(t.replace(/[^\d]/g, ''))}
                    placeholder="0"
                    placeholderTextColor={Colors.muted2}
                    keyboardType="number-pad"
                  />
                  <Text style={s.inputSuffix}>shares</Text>
                </View>
              </View>

              {/* Notional */}
              <View style={s.totalRow}>
                <Text style={s.totalLabel}>NOTIONAL</Text>
                <Text style={s.totalValue}>{stock.currency}{fmt(notional)}</Text>
              </View>
            </View>

            <View style={{ height: 100 }} />
          </ScrollView>

          {/* Sticky footer */}
          <View style={s.foot}>
            <Pressable
              style={[s.checkbox, executed && s.checkboxChecked]}
              onPress={() => setExecuted(e => !e)}
            >
              <View style={[s.checkBox, executed && s.checkBoxChecked]}>
                {executed && <Text style={s.checkMark}>✓</Text>}
              </View>
              <Text style={s.checkLabel}>I have executed this trade manually on Groww</Text>
            </Pressable>

            {targetNote ? (
              <Text style={s.targetNote}>Target set by Claude: {targetNote}</Text>
            ) : null}

            <Pressable
              style={[s.cta,
                (!canCommit || step === 'calculating') && s.ctaDisabled,
                step === 'committed' && { backgroundColor: Colors.accentInk }]}
              onPress={commit}
              disabled={!canCommit || step === 'calculating'}
            >
              {step === 'calculating'
                ? <ActivityIndicator color={Colors.canvas} size="small" />
                : <Text style={s.ctaText}>
                    {step === 'committed'
                      ? 'Tracking active ✓'
                      : 'Commit to Active Sentinel Tracking →'}
                  </Text>
              }
            </Pressable>
          </View>
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const s = StyleSheet.create({
  scrim:     { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(25,25,25,0.45)' },
  kavWrap:   { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.canvas,
    borderTopLeftRadius: Radii.sheet, borderTopRightRadius: Radii.sheet,
    borderTopWidth: 1, borderColor: Colors.hairStrong,
    maxHeight: '92%',
  },
  handleWrap: { alignItems: 'center', paddingVertical: 10 },
  handle:     { width: 40, height: 4, borderRadius: 99, backgroundColor: Colors.hairStrong },

  head:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                paddingHorizontal: Space.lg, paddingBottom: Space.md,
                borderBottomWidth: 1, borderColor: Colors.hair },
  eyebrow:    { flexDirection: 'row', alignItems: 'center', gap: 7 },
  eyebrowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  eyebrowText:{ fontSize: 10, color: Colors.muted, letterSpacing: 1.4, textTransform: 'uppercase', fontWeight: '500' },
  closeBtn:   { width: 30, height: 30, borderRadius: Radii.sm, borderWidth: 1, borderColor: Colors.hair,
                alignItems: 'center', justifyContent: 'center' },
  closeX:     { fontSize: 14, color: Colors.inkSoft },

  scroll:     { paddingHorizontal: Space.lg },

  titleBlock: { paddingVertical: Space.base, borderBottomWidth: 1, borderColor: Colors.hair, marginBottom: Space.base },
  ticker:     { fontFamily: Fonts.serifMedium, fontSize: 28, color: Colors.ink, letterSpacing: -0.5 },
  exch:       { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted, letterSpacing: 1 },
  name:       { fontSize: 12, color: Colors.muted, marginTop: 2 },
  priceRow:   { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 10 },
  priceCur:   { fontFamily: Fonts.mono, fontSize: 13, color: Colors.muted },
  price:      { fontFamily: Fonts.mono, fontSize: 15, color: Colors.ink },
  change:     { fontFamily: Fonts.mono, fontSize: 11 },

  brokerCard: { borderWidth: 1, borderColor: Colors.hair, borderRadius: Radii.md,
                backgroundColor: Colors.raised, padding: Space.md, marginBottom: Space.base },
  brokerHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  brokerLabel:{ fontSize: 9.5, color: Colors.muted, letterSpacing: 1.2, textTransform: 'uppercase' },
  brokerName: { fontFamily: Fonts.serif, fontSize: 13, color: Colors.ink },
  brokerCopy: { fontSize: 11.5, color: Colors.muted, lineHeight: 17 },

  formSection:      { marginBottom: Space.base },
  formSectionLabel: { fontSize: 10, color: Colors.muted, letterSpacing: 1.4, textTransform: 'uppercase',
                      fontWeight: '500', marginBottom: Space.md },
  fieldWrap:   { marginBottom: Space.md },
  fieldHead:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 },
  fieldLabel:  { fontSize: 11.5, color: Colors.inkSoft, fontWeight: '500' },
  fieldHint:   { fontFamily: Fonts.mono, fontSize: 10, color: Colors.muted2 },
  inputRow:    { flexDirection: 'row', alignItems: 'center',
                 borderWidth: 1, borderColor: Colors.hairStrong, borderRadius: Radii.sm,
                 backgroundColor: Colors.canvas, paddingHorizontal: Space.md, height: 44 },
  inputPrefix: { fontFamily: Fonts.mono, fontSize: 13, color: Colors.muted, marginRight: 8 },
  inputSuffix: { fontFamily: Fonts.mono, fontSize: 11, color: Colors.muted },
  input:       { flex: 1, fontFamily: Fonts.mono, fontSize: 16, color: Colors.ink,
                 padding: 0, margin: 0 },
  totalRow:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline',
                 paddingTop: Space.sm, borderTopWidth: 1, borderStyle: 'dashed', borderColor: Colors.hair },
  totalLabel:  { fontSize: 10, color: Colors.muted, letterSpacing: 1, textTransform: 'uppercase' },
  totalValue:  { fontFamily: Fonts.monoMedium, fontSize: 15, color: Colors.ink },

  foot:          { padding: Space.lg, paddingBottom: 28, borderTopWidth: 1, borderColor: Colors.hair, gap: Space.md },
  checkbox:      { flexDirection: 'row', alignItems: 'center', gap: 10, padding: Space.md,
                   borderWidth: 1, borderColor: Colors.hairStrong, borderRadius: Radii.md, backgroundColor: Colors.canvas },
  checkboxChecked:{ borderColor: Colors.accent, backgroundColor: Colors.accentSoft },
  checkBox:      { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: Colors.hairStrong,
                   alignItems: 'center', justifyContent: 'center' },
  checkBoxChecked:{ backgroundColor: Colors.accent, borderColor: Colors.accent },
  checkMark:     { color: Colors.canvas, fontSize: 12, fontWeight: '700' },
  checkLabel:    { flex: 1, fontSize: 12.5, fontWeight: '500', color: Colors.ink },

  targetNote:  { fontFamily: Fonts.mono, fontSize: 10, color: Colors.accentInk,
                 textAlign: 'center', paddingHorizontal: Space.sm },
  cta:         { backgroundColor: Colors.ink, borderRadius: Radii.md, padding: Space.base,
                 alignItems: 'center', minHeight: 50, justifyContent: 'center' },
  ctaDisabled: { opacity: 0.42 },
  ctaText:     { color: Colors.canvas, fontSize: 13.5, fontWeight: '500', letterSpacing: 0.2 },
});
