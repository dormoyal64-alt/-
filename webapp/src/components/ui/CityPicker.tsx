"use client";

import { useMemo, useState } from "react";
import { Search, X, Check } from "lucide-react";
import { Input } from "@/components/ui/Input";
import type { City, CityRegion } from "@/lib/types";

const REGIONS: (CityRegion | "הכל")[] = ["הכל", "צפון", "מרכז", "דרום"];

/**
 * Picks cities out of a long list: type-ahead search plus region tabs.
 * `mode="single"` for choosing one city (job entry),
 * `mode="multi"` for the set a contractor covers.
 */
export function CityPicker({
  cities,
  selectedIds,
  onToggle,
  mode = "single",
  emptyHint,
}: {
  cities: City[];
  selectedIds: string[];
  onToggle: (cityId: string) => void;
  mode?: "single" | "multi";
  emptyHint?: string;
}) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState<CityRegion | "הכל">("הכל");

  const filtered = useMemo(() => {
    const q = query.trim();
    const hits = cities.filter((c) => {
      if (region !== "הכל" && c.region !== region) return false;
      if (q && !c.name.includes(q)) return false;
      return true;
    });
    // typing "רמ" means רמלה, not דאלית אל-כרמל: prefix hits come first
    if (!q) return hits;
    return hits.sort(
      (a, b) =>
        (a.name.startsWith(q) ? 0 : 1) - (b.name.startsWith(q) ? 0 : 1) ||
        a.name.localeCompare(b.name, "he")
    );
  }, [cities, query, region]);

  // whichever cities are already chosen stay visible even when filtered out
  const selectedOutsideFilter = cities.filter(
    (c) => selectedIds.includes(c.id) && !filtered.some((f) => f.id === c.id)
  );

  const regionCounts = useMemo(() => {
    const counts: Record<string, number> = { הכל: cities.length };
    cities.forEach((c) => {
      if (c.region) counts[c.region] = (counts[c.region] ?? 0) + 1;
    });
    return counts;
  }, [cities]);

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[180px] flex-1">
          <Search className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="חיפוש עיר..."
            className="pr-10"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="ניקוי חיפוש"
              className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-ink-400 hover:bg-ink-100"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <div className="flex overflow-hidden rounded-xl border border-ink-200">
          {REGIONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRegion(r)}
              className={`px-3 py-2 text-sm font-semibold transition ${
                region === r ? "bg-brand-600 text-white" : "bg-white text-ink-600 hover:bg-ink-50"
              }`}
            >
              {r}
              {regionCounts[r] ? <span className="mr-1 text-xs opacity-60">{regionCounts[r]}</span> : null}
            </button>
          ))}
        </div>
      </div>

      {filtered.length === 0 && selectedOutsideFilter.length === 0 ? (
        <p className="py-4 text-center text-sm text-ink-400">
          {emptyHint ?? `לא נמצאה עיר בשם "${query}"`}
        </p>
      ) : (
        <div className="max-h-64 overflow-y-auto rounded-2xl border border-ink-100 p-2">
          <div className="flex flex-wrap gap-2">
            {[...selectedOutsideFilter, ...filtered].map((c) => {
              const on = selectedIds.includes(c.id);
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => onToggle(c.id)}
                  className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold transition ${
                    on
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-ink-200 text-ink-700 hover:bg-ink-50"
                  }`}
                >
                  {on && mode === "multi" && <Check className="h-3.5 w-3.5" />}
                  {c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {mode === "multi" && selectedIds.length > 0 && (
        <p className="text-xs font-semibold text-ink-500">נבחרו {selectedIds.length} ערים</p>
      )}
    </div>
  );
}
