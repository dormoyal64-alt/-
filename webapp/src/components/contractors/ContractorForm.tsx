"use client";

import { useMemo, useState } from "react";
import { useRefData } from "@/lib/refdata";
import type { ContractorWithRelations } from "@/lib/types";
import type { ContractorFormInput } from "@/lib/api/contractors";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { CityPicker } from "@/components/ui/CityPicker";

export function ContractorForm({
  initial,
  onSubmit,
  submitLabel = "שמירה",
  loading,
}: {
  initial?: ContractorWithRelations;
  onSubmit: (input: ContractorFormInput) => Promise<void>;
  submitLabel?: string;
  loading?: boolean;
}) {
  const { professions, jobTypes, cities } = useRefData();

  const [name, setName] = useState(initial?.name ?? "");
  const [phone, setPhone] = useState(initial?.phone ?? "");
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp ?? "");
  const [defaultPct, setDefaultPct] = useState(initial?.default_commission_pct ?? 60);
  const [active, setActive] = useState(initial?.active ?? true);
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [professionIds, setProfessionIds] = useState<string[]>(
    initial?.contractor_professions?.map((p) => p.profession_id) ?? []
  );
  const [cityIds, setCityIds] = useState<string[]>(initial?.contractor_cities?.map((c) => c.city_id) ?? []);
  const [jobTypeOverrides, setJobTypeOverrides] = useState<Record<string, number | null>>(
    Object.fromEntries((initial?.contractor_job_types ?? []).map((jt) => [jt.job_type_id, jt.commission_pct]))
  );
  const [error, setError] = useState<string | null>(null);

  const relevantJobTypes = useMemo(
    () => jobTypes.filter((jt) => professionIds.includes(jt.profession_id) && jt.is_active),
    [jobTypes, professionIds]
  );

  function toggleProfession(id: string) {
    setProfessionIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleCity(id: string) {
    setCityIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function toggleJobType(id: string) {
    setJobTypeOverrides((prev) => {
      const next = { ...prev };
      if (id in next) delete next[id];
      else next[id] = null;
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("יש להזין שם קבלן");
      return;
    }
    if (professionIds.length === 0) {
      setError("יש לבחור לפחות תחום אחד");
      return;
    }
    if (cityIds.length === 0) {
      setError("יש לבחור לפחות עיר אחת");
      return;
    }
    const jobTypeCommissions = Object.fromEntries(
      Object.entries(jobTypeOverrides).filter(([jtId]) => relevantJobTypes.some((jt) => jt.id === jtId))
    );
    await onSubmit({
      name: name.trim(),
      phone,
      whatsapp,
      default_commission_pct: defaultPct,
      active,
      notes,
      professionIds,
      cityIds,
      jobTypeCommissions,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label required>שם הקבלן</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: דוד כהן" />
        </div>
        <div>
          <Label>סטטוס</Label>
          <button
            type="button"
            onClick={() => setActive((a) => !a)}
            className={`flex h-[46px] w-full items-center justify-center gap-2 rounded-xl border text-sm font-bold ${
              active ? "border-success-100 bg-success-50 text-success-700" : "border-ink-200 bg-ink-100 text-ink-500"
            }`}
          >
            <span className={`h-2 w-2 rounded-full ${active ? "bg-success-500" : "bg-ink-400"}`} />
            {active ? "פעיל" : "לא פעיל"}
          </button>
        </div>
        <div>
          <Label>טלפון</Label>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="050-1234567" dir="ltr" />
        </div>
        <div>
          <Label>WhatsApp</Label>
          <Input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} placeholder="050-1234567" dir="ltr" />
        </div>
        <div>
          <Label required>אחוז קבוע לקבלן (%)</Label>
          <Input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={defaultPct}
            onChange={(e) => setDefaultPct(parseFloat(e.target.value) || 0)}
          />
        </div>
      </div>

      <div>
        <Label required>תחומים</Label>
        <div className="flex flex-wrap gap-2">
          {professions
            .filter((p) => p.is_active)
            .map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => toggleProfession(p.id)}
                className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                  professionIds.includes(p.id)
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                {p.name}
              </button>
            ))}
        </div>
      </div>

      <div>
        <Label required>ערים בהן הקבלן עובד</Label>
        <CityPicker
          cities={cities.filter((c) => c.is_active)}
          selectedIds={cityIds}
          onToggle={toggleCity}
          mode="multi"
          emptyHint="לא נמצאה עיר פעילה בשם הזה. אפשר להפעיל עוד ערים במסך ״ערים״."
        />
      </div>

      {relevantJobTypes.length > 0 && (
        <div>
          <Label>סוגי עבודות שהקבלן מבצע (ואחוז מיוחד אם רלוונטי)</Label>
          <div className="space-y-2 rounded-2xl border border-ink-100 p-3">
            {relevantJobTypes.map((jt) => {
              const included = jt.id in jobTypeOverrides;
              return (
                <div key={jt.id} className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={included}
                    onChange={() => toggleJobType(jt.id)}
                    className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span className="flex-1 text-sm text-ink-700">{jt.name}</span>
                  {included && (
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={0.5}
                        placeholder={`${defaultPct}%`}
                        value={jobTypeOverrides[jt.id] ?? ""}
                        onChange={(e) =>
                          setJobTypeOverrides((prev) => ({
                            ...prev,
                            [jt.id]: e.target.value === "" ? null : parseFloat(e.target.value),
                          }))
                        }
                        className="w-24 py-1.5 text-center"
                      />
                      <span className="text-xs text-ink-400">%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <Label>הערות</Label>
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="הערות פנימיות על הקבלן..." />
      </div>

      {error && <p className="text-sm font-medium text-danger-600">{error}</p>}

      <Button type="submit" fullWidth size="lg" loading={loading}>
        {submitLabel}
      </Button>
    </form>
  );
}
