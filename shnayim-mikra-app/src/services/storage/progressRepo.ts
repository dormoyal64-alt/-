import type { Country, DayProgress, IsoDate, ProgressStore, ReadingDivisionSchemeId } from '@/types';
import { getItem, setItem } from './LocalStore';
import { computeStreakState } from '@/services/streak/streakEngine';

const KEY = 'progress';

const EMPTY_STORE: ProgressStore = {
  days: {},
  streak: { currentStreak: 0, longestStreak: 0, lastCompletedDate: null, totalDaysCompleted: 0 },
};

export async function loadProgress(): Promise<ProgressStore> {
  const stored = await getItem<ProgressStore>(KEY);
  return stored ?? EMPTY_STORE;
}

async function saveProgress(store: ProgressStore): Promise<void> {
  await setItem(KEY, store);
}

function getOrCreateDay(store: ProgressStore, date: IsoDate, totalVerses: number): DayProgress {
  const existing = store.days[date];
  if (existing) return existing;
  const created: DayProgress = {
    date,
    completedVerseRefs: [],
    totalVersesInPortion: totalVerses,
    secondsSpentReading: 0,
    startedAt: new Date().toISOString(),
  };
  store.days[date] = created;
  return created;
}

export async function startReading(date: IsoDate, totalVerses: number): Promise<ProgressStore> {
  const store = await loadProgress();
  getOrCreateDay(store, date, totalVerses);
  await saveProgress(store);
  return store;
}

export async function markVerseCompleted(
  date: IsoDate,
  verseRefLabel: string,
  totalVerses: number
): Promise<ProgressStore> {
  const store = await loadProgress();
  const day = getOrCreateDay(store, date, totalVerses);
  if (!day.completedVerseRefs.includes(verseRefLabel)) {
    day.completedVerseRefs.push(verseRefLabel);
  }
  day.totalVersesInPortion = totalVerses;
  await saveProgress(store);
  return store;
}

export async function markDayCompleted(
  date: IsoDate,
  country: Country,
  scheme: ReadingDivisionSchemeId,
  opts: { completedBeforeShabbat?: boolean; secondsSpentReading?: number } = {}
): Promise<ProgressStore> {
  const store = await loadProgress();
  const day = getOrCreateDay(store, date, store.days[date]?.totalVersesInPortion ?? 0);
  day.completedAt = new Date().toISOString();
  if (opts.completedBeforeShabbat) day.completedBeforeShabbat = true;
  if (opts.secondsSpentReading) day.secondsSpentReading += opts.secondsSpentReading;

  store.streak = computeStreakState(store.days, country, scheme);
  await saveProgress(store);
  return store;
}

export async function getDayProgress(date: IsoDate): Promise<DayProgress | null> {
  const store = await loadProgress();
  return store.days[date] ?? null;
}

export async function isDayComplete(date: IsoDate): Promise<boolean> {
  const day = await getDayProgress(date);
  return Boolean(day?.completedAt);
}

export async function refreshStreak(
  country: Country,
  scheme: ReadingDivisionSchemeId
): Promise<ProgressStore> {
  const store = await loadProgress();
  store.streak = computeStreakState(store.days, country, scheme);
  await saveProgress(store);
  return store;
}

export async function addReadingSeconds(date: IsoDate, seconds: number): Promise<void> {
  const store = await loadProgress();
  const day = getOrCreateDay(store, date, store.days[date]?.totalVersesInPortion ?? 0);
  day.secondsSpentReading += seconds;
  await saveProgress(store);
}
