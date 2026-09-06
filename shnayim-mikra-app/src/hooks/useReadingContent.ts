import { useEffect, useState } from 'react';
import type { DailyReadingPlan } from '@/types';
import { buildDayReadingContent, getDefaultTorahProvider, prefetchWeek, type DayReadingContent } from '@/services/torah';
import { useApp } from './AppProvider';

interface State {
  loading: boolean;
  error: string | null;
  content: DayReadingContent | null;
}

export function useReadingContent(plan: DailyReadingPlan): State {
  const { settings } = useApp();
  const [state, setState] = useState<State>({ loading: true, error: null, content: null });

  useEffect(() => {
    let cancelled = false;
    setState({ loading: true, error: null, content: null });

    (async () => {
      try {
        const provider = getDefaultTorahProvider();
        // Best-effort: make sure the whole week is cached for offline reading.
        prefetchWeek(plan.weekContext, provider, settings.nikud).catch(() => {});

        const content = await buildDayReadingContent(plan, provider, { nikud: settings.nikud });
        if (!cancelled) setState({ loading: false, error: null, content });
      } catch (e) {
        if (!cancelled) {
          setState({
            loading: false,
            error: e instanceof Error ? e.message : 'שגיאה בטעינת הטקסט. בדוק חיבור לאינטרנט ונסה שוב.',
            content: null,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [plan, settings.nikud]);

  return state;
}
