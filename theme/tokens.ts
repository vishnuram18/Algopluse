// Design tokens from the AlgoPulse design spec.
// oklch values are approximated to hex for React Native compatibility.

export const Colors = {
  canvas:      '#FBF9F6',
  raised:      '#F4F1EB',
  raised2:     '#EDE8E0',
  ink:         '#191919',
  inkSoft:     '#2B2926',
  muted:       '#6E6862',
  muted2:      '#9A938B',
  hair:        '#E6E1DB',
  hairStrong:  '#D8D2C8',

  // Forest green accent (default palette)
  accent:      '#3F5E4C',
  accentSoft:  'rgba(63, 94, 76, 0.08)',
  accentInk:   '#2A4035',

  // Sepia / watch state
  sepia:       '#8A6A3A',
  sepiaSoft:   'rgba(138, 106, 58, 0.10)',

  // Danger / drawdown
  danger:      '#B94030',
} as const;

export const Fonts = {
  serif:       'SourceSerif4_400Regular',
  serifMedium: 'SourceSerif4_500Medium',
  serifSemiBold:'SourceSerif4_600SemiBold',
  mono:        'JetBrainsMono_400Regular',
  monoMedium:  'JetBrainsMono_500Medium',
} as const;

export const Radii = {
  xs:    4,
  sm:    6,
  md:    8,
  card:  10,
  lg:    12,
  xl:    14,
  sheet: 24,
} as const;

export const Space = {
  xs:   4,
  sm:   8,
  md:   12,
  base: 16,
  lg:   20,
  xl:   24,
} as const;
