import { Tabs } from 'expo-router';
import { View, Text, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../../theme/tokens';
import { useAppStore } from '../../store/useAppStore';

function ScoutIcon({ focused }: { focused: boolean }) {
  return (
    <View style={[ti.wrap, focused && ti.activeWrap]}>
      {focused && <View style={ti.indicator} />}
      <Text style={[ti.icon, { color: focused ? Colors.ink : Colors.muted2 }]}>⌕</Text>
      <Text style={[ti.label, { color: focused ? Colors.ink : Colors.muted2,
                                fontWeight: focused ? '500' : '400' }]}>Scout</Text>
    </View>
  );
}

function PortfolioIcon({ focused }: { focused: boolean }) {
  const count = useAppStore(s => s.positions.length);
  return (
    <View style={[ti.wrap, focused && ti.activeWrap]}>
      {focused && <View style={ti.indicator} />}
      <View>
        <Text style={[ti.icon, { color: focused ? Colors.ink : Colors.muted2 }]}>▦</Text>
        {count > 0 && (
          <View style={ti.badge}>
            <Text style={ti.badgeText}>{count > 9 ? '9+' : count}</Text>
          </View>
        )}
      </View>
      <Text style={[ti.label, { color: focused ? Colors.ink : Colors.muted2,
                                fontWeight: focused ? '500' : '400' }]}>Portfolio</Text>
    </View>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: Colors.canvas,
          borderTopWidth: 1,
          borderTopColor: Colors.hair,
          height: 72,
          paddingBottom: 0,
        },
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ tabBarIcon: ({ focused }) => <ScoutIcon focused={focused} /> }}
      />
      <Tabs.Screen
        name="portfolio"
        options={{ tabBarIcon: ({ focused }) => <PortfolioIcon focused={focused} /> }}
      />
    </Tabs>
  );
}

const ti = StyleSheet.create({
  wrap:      { alignItems: 'center', justifyContent: 'center', paddingTop: 8, flex: 1, position: 'relative' },
  activeWrap:{},
  indicator: { position: 'absolute', top: 0, width: 20, height: 2, backgroundColor: Colors.ink, borderRadius: 1 },
  icon:      { fontSize: 20 },
  label:     { fontFamily: Fonts.mono, fontSize: 10, marginTop: 3, letterSpacing: 0.3 },
  badge:     { position: 'absolute', top: -5, right: -8, minWidth: 16, height: 16,
               backgroundColor: Colors.accent, borderRadius: 8, alignItems: 'center', justifyContent: 'center',
               borderWidth: 2, borderColor: Colors.canvas, paddingHorizontal: 3 },
  badgeText: { fontFamily: Fonts.mono, fontSize: 8, color: Colors.canvas, fontWeight: '500' },
});
