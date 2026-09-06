export interface Palette {
  background: string;
  surface: string;
  surfaceAlt: string;
  primary: string;
  primaryText: string;
  accent: string;
  text: string;
  textMuted: string;
  border: string;
  success: string;
  danger: string;
  cardShadow: string;
}

export const lightPalette: Palette = {
  background: '#F7F3EA',
  surface: '#FFFFFF',
  surfaceAlt: '#F0EAD9',
  primary: '#1B2A4A',
  primaryText: '#FFFFFF',
  accent: '#B08D57',
  text: '#20242E',
  textMuted: '#6B7280',
  border: '#E3DCC8',
  success: '#3B7A57',
  danger: '#A8442C',
  cardShadow: 'rgba(27, 42, 74, 0.08)',
};

export const darkPalette: Palette = {
  background: '#10141C',
  surface: '#1A2030',
  surfaceAlt: '#212840',
  primary: '#C9A55C',
  primaryText: '#10141C',
  accent: '#C9A55C',
  text: '#EDEBE3',
  textMuted: '#9AA3B5',
  border: '#2A3245',
  success: '#5FAE82',
  danger: '#E08165',
  cardShadow: 'rgba(0, 0, 0, 0.4)',
};
