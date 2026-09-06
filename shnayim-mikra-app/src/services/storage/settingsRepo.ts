import type { UserSettings } from '@/types';
import { getItem, setItem } from './LocalStore';

const KEY = 'settings';

export const DEFAULT_SETTINGS: UserSettings = {
  country: 'IL',
  divisionScheme: 'sun-fri-6days',
  readingMode: 'sequential',
  fontSize: 'medium',
  nikud: true,
  theme: 'system',
  hideCommentary: false,
  revealCommentaryAfterReading: false,
  shabbatObservantMode: true,
  notifications: {
    enabled: true,
    hour: 20,
    minute: 0,
    activeDays: [0, 1, 2, 3, 4, 5, 6],
    snoozeMinutes: 30,
  },
  onboardingCompleted: false,
};

export async function loadSettings(): Promise<UserSettings> {
  const stored = await getItem<UserSettings>(KEY);
  if (!stored) return DEFAULT_SETTINGS;
  // Merge with defaults so new fields introduced in app updates get sane values.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications },
  };
}

export async function saveSettings(settings: UserSettings): Promise<void> {
  await setItem(KEY, settings);
}

export async function updateSettings(
  patch: Partial<UserSettings>
): Promise<UserSettings> {
  const current = await loadSettings();
  const next: UserSettings = {
    ...current,
    ...patch,
    notifications: { ...current.notifications, ...patch.notifications },
  };
  await saveSettings(next);
  return next;
}
