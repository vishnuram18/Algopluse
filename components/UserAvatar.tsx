import React, { useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import { Colors, Fonts } from '../theme/tokens';
import { UserProfile } from '../store/useAppStore';

interface Props {
  profile: UserProfile;
  size?: number;
}

export default function UserAvatar({ profile, size = 32 }: Props) {
  const [imgFailed, setImgFailed] = useState(false);

  const initials = profile.name
    .split(' ')
    .slice(0, 2)
    .map(w => w[0]?.toUpperCase() ?? '')
    .join('');

  const radius   = size / 2;
  const fontSize = size * 0.38;

  if (!imgFailed && profile.picture) {
    return (
      <Image
        source={{ uri: profile.picture }}
        style={[s.avatar, { width: size, height: size, borderRadius: radius }]}
        onError={() => setImgFailed(true)}
      />
    );
  }

  return (
    <View style={[s.fallback, { width: size, height: size, borderRadius: radius }]}>
      <Text style={[s.initials, { fontSize }]}>{initials}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  avatar:   { borderWidth: 1, borderColor: Colors.hair },
  fallback: { backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center',
              borderWidth: 1, borderColor: Colors.accent },
  initials: { color: '#fff', fontFamily: Fonts.monoMedium, lineHeight: undefined },
});
