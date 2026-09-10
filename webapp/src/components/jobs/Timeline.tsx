import { formatDateTimeHe } from "@/lib/dates";

export interface TimelineEntry {
  id: string;
  changed_at: string;
  note: string | null;
  status_name: string | null;
  status_color: string | null;
}

export function Timeline({ entries }: { entries: TimelineEntry[] }) {
  if (entries.length === 0) return <p className="text-sm text-ink-400">אין עדיין היסטוריה</p>;

  return (
    <ol className="relative space-y-5 border-r-2 border-ink-100 pr-5">
      {entries.map((entry) => (
        <li key={entry.id} className="relative">
          <span
            className="absolute top-1 right-[-27px] h-3 w-3 rounded-full ring-4 ring-white"
            style={{ backgroundColor: entry.status_color ?? "#9aa6b8" }}
          />
          <p className="text-xs font-semibold text-ink-400">{formatDateTimeHe(entry.changed_at)}</p>
          <p className="text-sm font-bold text-ink-800">{entry.status_name}</p>
          {entry.note && <p className="mt-0.5 text-sm text-ink-500">{entry.note}</p>}
        </li>
      ))}
    </ol>
  );
}
