import { useMemo } from 'react';
import { getDailyReadingPlan, todayIsoDate } from '@/services/calendar';
import { useApp } from './AppProvider';
import type { DailyReadingPlan } from '@/types';

export function useDailyPlan(date?: string): DailyReadingPlan {
  const { settings } = useApp();
  return useMemo(
    () => getDailyReadingPlan(date ?? todayIsoDate(), settings.country, settings.divisionScheme),
    [date, settings.country, settings.divisionScheme]
  );
}
