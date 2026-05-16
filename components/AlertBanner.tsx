import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, Text, View, StyleSheet } from 'react-native';
import { Colors, Fonts, Radii, Space } from '../theme/tokens';

interface Props {
  ticker: string;
  name: string;
  price: number;
  onDismiss: () => void;
}

const fmt = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function AlertBanner({ ticker, name, price, onDismiss }: Props) {
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity    = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateY, { toValue: 0,   duration: 360, useNativeDriver: true }),
      Animated.timing(opacity,    { toValue: 1,   duration: 280, useNativeDriver: true }),
    ]).start();
  }, []);

  return (
    <Animated.View style={[s.wrap, { transform: [{ translateY }], opacity }]}>
      <View style={s.dot} />
      <View style={s.copy}>
        <Text style={s.title}><Text style={s.tickerText}>{ticker}</Text> hit target</Text>
        <Text style={s.sub} numberOfLines={1}>Tape ₹{fmt(price)} · open Groww and sell</Text>
      </View>
      <Pressable style={s.ctaBtn} onPress={onDismiss}>
        <Text style={s.ctaText}>Dismiss</Text>
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  wrap: {
    position: 'absolute', top: 12, left: 12, right: 12, zIndex: 100,
    flexDirection: 'row', alignItems: 'center', gap: Space.sm,
    backgroundColor: Colors.ink, borderRadius: Radii.card,
    padding: Space.sm + 2,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  dot:        { width: 7, height: 7, borderRadius: 4, backgroundColor: Colors.accent },
  copy:       { flex: 1 },
  title:      { fontSize: 12.5, fontWeight: '500', color: Colors.canvas },
  tickerText: { fontFamily: Fonts.serifMedium, fontSize: 13.5 },
  sub:        { fontFamily: Fonts.mono, fontSize: 10.5, color: 'rgba(251,249,246,0.65)', marginTop: 2 },
  ctaBtn:     { backgroundColor: Colors.accent, paddingHorizontal: 10, paddingVertical: 6, borderRadius: Radii.sm },
  ctaText:    { fontSize: 11, fontWeight: '500', color: Colors.canvas },
});
