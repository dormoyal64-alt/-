import { useColorScheme } from 'react-native';
import type { ThemeOption } from '@/types';
import { darkPalette, lightPalette, type Palette } from '@/theme/colors';

export function resolvePalette(theme: ThemeOption, systemScheme: string | null | undefined): Palette {
  const effective = theme === 'system' ? (systemScheme ?? 'light') : theme;
  return effective === 'dark' ? darkPalette : lightPalette;
}

export function useThemeColors(theme: ThemeOption): Palette {
  const systemScheme = useColorScheme();
  return resolvePalette(theme, systemScheme);
}
