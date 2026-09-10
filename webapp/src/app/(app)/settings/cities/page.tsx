"use client";

import { useMemo, useState } from "react";
import { Search, X, Plus, MapPin } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import type { CityRegion } from "@/lib/types";

const REGIONS: CityRegion[] = ["צפון", "מרכז", "דרום"];
// the list is every locality in the country, so only a screenful is rendered
const ROW_CAP = 80;
type Tab = CityRegion | "הכל" | "פעילות";

export default function CitiesSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { cities, refresh } = useRefData();
  const toast = useToast();

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("פעילות");
  const [newName, setNewName] = useState("");
  const [newRegion, setNewRegion] = useState<CityRegion>("דרום");
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const activeCount = cities.filter((c) => c.is_active).length;

  const filtered = useMemo(() => {
    const q = query.trim();
    return cities
      .filter((c) => {
        if (tab === "פעילות" && !c.is_active) return false;
        if (REGIONS.includes(tab as CityRegion) && c.region !== tab) return false;
        if (q && !c.name.includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
        // a name that starts with what was typed is what the search meant
        if (q) {
          const rank = (a.name.startsWith(q) ? 0 : 1) - (b.name.startsWith(q) ? 0 : 1);
          if (rank) return rank;
        }
        return a.name.localeCompare(b.name, "he");
      });
  }, [cities, query, tab]);

  async function toggleCity(id: string, next: boolean) {
    setBusyId(id);
    const { error } = await supabase.from("cities").update({ is_active: next }).eq("id", id);
    setBusyId(null);
    if (error) return toast.error("שגיאה בעדכון העיר");
    await refresh();
  }

  async function addCity() {
    const name = newName.trim();
    if (!name) return;
    setAdding(true);
    const { error } = await supabase.from("cities").insert({ name, region: newRegion, is_active: true });
    setAdding(false);
    if (error) return toast.error("העיר כבר קיימת ברשימה");
    setNewName("");
    await refresh();
    toast.success(`${name} נוספה והופעלה`);
  }

  const tabs: Tab[] = ["פעילות", "הכל", ...REGIONS];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">ערים</h1>
        <p className="text-sm text-ink-500">
          כל ערי ישראל כבר ברשימה. הפעילו את הערים שבהן אתם עובדים — רק הן יופיעו בפתיחת עבודה.
        </p>
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[190px] flex-1">
              <Search className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="התחילו להקליד שם עיר..."
                className="pr-10"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  aria-label="ניקוי חיפוש"
                  className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-ink-400 hover:bg-ink-100"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <span className="badge bg-success-50 text-success-700">{activeCount} ערים פעילות</span>
          </div>

          <div className="flex flex-wrap gap-1.5">
            {tabs.map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                  tab === t ? "bg-brand-600 text-white" : "bg-ink-100 text-ink-600 hover:bg-ink-200"
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <div className="py-8 text-center">
              <MapPin className="mx-auto h-7 w-7 text-ink-300" />
              <p className="mt-2 text-sm font-semibold text-ink-600">
                {query ? `לא נמצאה עיר בשם "${query}"` : "אין ערים בקטגוריה הזו"}
              </p>
              {query && <p className="mt-1 text-xs text-ink-400">אפשר להוסיף אותה למטה</p>}
            </div>
          ) : (
            <div className="max-h-[420px] overflow-y-auto rounded-2xl border border-ink-100">
              {filtered.slice(0, ROW_CAP).map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 border-b border-ink-50 px-3.5 py-2.5 last:border-0"
                >
                  <span className={`flex-1 text-sm font-semibold ${c.is_active ? "text-ink-800" : "text-ink-400"}`}>
                    {c.name}
                  </span>
                  {c.region && <span className="badge bg-ink-100 text-ink-500">{c.region}</span>}
                  <button
                    onClick={() => toggleCity(c.id, !c.is_active)}
                    disabled={busyId === c.id}
                    className={`w-24 rounded-lg px-2.5 py-1.5 text-xs font-bold transition disabled:opacity-50 ${
                      c.is_active
                        ? "bg-success-50 text-success-700 hover:bg-success-100"
                        : "bg-ink-100 text-ink-500 hover:bg-ink-200"
                    }`}
                  >
                    {c.is_active ? "עובדים כאן ✓" : "הפעלה"}
                  </button>
                </div>
              ))}
              {filtered.length > ROW_CAP && (
                <div className="bg-ink-50 px-3.5 py-2.5 text-center text-xs font-bold text-ink-400">
                  מוצגות {ROW_CAP} מתוך {filtered.length} — המשיכו להקליד כדי לצמצם
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="space-y-3">
          <Label>הוספת עיר או יישוב שלא ברשימה</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCity()}
              placeholder="שם היישוב"
              className="min-w-[160px] flex-1"
            />
            <select
              value={newRegion}
              onChange={(e) => setNewRegion(e.target.value as CityRegion)}
              className="input w-auto"
            >
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <Button onClick={addCity} loading={adding}>
              <Plus className="h-4 w-4" /> הוספה
            </Button>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
