import type { FontSizeOption } from '@/types';

export const fonts = {
  serifRegular: 'FrankRuhlLibre_500Medium',
  serifBold: 'FrankRuhlLibre_700Bold',
  sansRegular: 'Heebo_400Regular',
  sansMedium: 'Heebo_500Medium',
  sansBold: 'Heebo_700Bold',
};

/** Base verse font size in px for each user-selectable size option. */
export const VERSE_FONT_SIZES: Record<FontSizeOption, number> = {
  small: 17,
  medium: 20,
  large: 23,
  xlarge: 27,
};

export const UI_FONT_SIZES = {
  caption: 12,
  body: 15,
  bodyLarge: 17,
  title: 20,
  headline: 26,
  display: 32,
};
