import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ProgressStore, UserSettings } from '@/types';
import { DEFAULT_SETTINGS, loadSettings, updateSettings as persistSettingsUpdate } from '@/services/storage/settingsRepo';
import { loadProgress, markDayCompleted, markVerseCompleted, refreshStreak } from '@/services/storage/progressRepo';
import { rescheduleDailyReminders } from '@/services/notifications/scheduler';

interface AppContextValue {
  settings: UserSettings;
  progress: ProgressStore;
  loading: boolean;
  updateSettings: (patch: Partial<UserSettings>) => Promise<void>;
  completeVerse: (date: string, verseRefLabel: string, totalVerses: number) => Promise<void>;
  completeDay: (
    date: string,
    opts?: { completedBeforeShabbat?: boolean; secondsSpentReading?: number }
  ) => Promise<ProgressStore>;
  refreshProgress: () => Promise<void>;
}

const AppContext = createContext<AppContextValue | null>(null);

const EMPTY_PROGRESS: ProgressStore = {
  days: {},
  streak: { currentStreak: 0, longestStreak: 0, lastCompletedDate: null, totalDaysCompleted: 0 },
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [progress, setProgress] = useState<ProgressStore>(EMPTY_PROGRESS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, p] = await Promise.all([loadSettings(), loadProgress()]);
      setSettings(s);
      setProgress(p);
      setLoading(false);
      rescheduleDailyReminders(s.notifications, p, s.shabbatObservantMode, s.country).catch(() => {});
    })();
  }, []);

  const updateSettings = useCallback(
    async (patch: Partial<UserSettings>) => {
      const next = await persistSettingsUpdate(patch);
      setSettings(next);
      rescheduleDailyReminders(next.notifications, progress, next.shabbatObservantMode, next.country).catch(
        () => {}
      );
    },
    [progress]
  );

  const refreshProgress = useCallback(async () => {
    const p = await loadProgress();
    setProgress(p);
  }, []);

  const completeVerse = useCallback(
    async (date: string, verseRefLabel: string, totalVerses: number) => {
      const p = await markVerseCompleted(date, verseRefLabel, totalVerses);
      setProgress(p);
    },
    []
  );

  const completeDay = useCallback(
    async (
      date: string,
      opts?: { completedBeforeShabbat?: boolean; secondsSpentReading?: number }
    ) => {
      const p = await markDayCompleted(date, settings.country, settings.divisionScheme, opts);
      setProgress(p);
      rescheduleDailyReminders(settings.notifications, p, settings.shabbatObservantMode, settings.country).catch(
        () => {}
      );
      return p;
    },
    [settings]
  );

  useEffect(() => {
    if (loading) return;
    refreshStreak(settings.country, settings.divisionScheme)
      .then(setProgress)
      .catch(() => {});
    // Re-derive streak whenever the country/scheme changes, since rest days depend on them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.country, settings.divisionScheme]);

  const value = useMemo<AppContextValue>(
    () => ({ settings, progress, loading, updateSettings, completeVerse, completeDay, refreshProgress }),
    [settings, progress, loading, updateSettings, completeVerse, completeDay, refreshProgress]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
