import { startOfWeek, endOfWeek, format, parseISO } from 'date-fns';

/** Israeli week: Sunday–Saturday. Returns a stable key + display label. */
export function weekOf(dateStr: string): { key: string; start: Date; end: Date; label: string } {
  const date = parseISO(dateStr);
  const start = startOfWeek(date, { weekStartsOn: 0 });
  const end = endOfWeek(date, { weekStartsOn: 0 });
  const key = format(start, 'yyyy-MM-dd');
  const label = `${format(start, 'dd/MM/yyyy')} – ${format(end, 'dd/MM/yyyy')}`;
  return { key, start, end, label };
}
