"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { EditableList } from "@/components/settings/EditableList";
import { Input } from "@/components/ui/Input";
import { agorotToShekels, shekelsToAgorot } from "@/lib/money";
import { errorMessage } from "@/lib/errors";

/** A money box on a list row, in shekels. Saves when it loses focus. */
function MoneyInput({
  label,
  agorot,
  onSave,
  placeholder = "—",
}: {
  label: string;
  agorot: number | null;
  onSave: (shekels: string) => Promise<void>;
  placeholder?: string;
}) {
  const initial = agorot == null ? "" : String(agorotToShekels(agorot));
  const [value, setValue] = useState(initial);
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-xs font-bold text-ink-400">{label}</span>
      <Input
        type="number"
        min={0}
        inputMode="decimal"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => {
          if (value.trim() !== initial) onSave(value);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        placeholder={placeholder}
        aria-label={`${label} בשקלים`}
        className="w-24 py-1.5 text-center font-bold"
      />
      <span className="text-xs font-bold text-ink-400">₪</span>
    </span>
  );
}

export default function ProfessionsSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { professions, jobTypes, settings, refresh } = useRefData();
  const toast = useToast();
  const [expanded, setExpanded] = useState<string | null>(null);

  async function addProfession(name: string) {
    const { error } = await supabase.from("professions").insert({ name, sort_order: professions.length });
    if (error) return toast.error("שגיאה בהוספת תחום (אולי כבר קיים)");
    await refresh();
    toast.success("התחום נוסף");
  }
  async function renameProfession(id: string, name: string) {
    await supabase.from("professions").update({ name }).eq("id", id);
    await refresh();
    toast.success("התחום עודכן");
  }
  async function toggleProfession(id: string, active: boolean) {
    await supabase.from("professions").update({ is_active: active }).eq("id", id);
    await refresh();
  }

  async function saveTechnicianLabel(id: string, label: string) {
    await supabase.from("professions").update({ technician_label: label.trim() || "הטכנאי" }).eq("id", id);
    await refresh();
    toast.success("הניסוח ללקוח עודכן");
  }

  async function addJobType(professionId: string, name: string) {
    const { error } = await supabase.from("job_types").insert({ profession_id: professionId, name, sort_order: jobTypes.length });
    if (error) return toast.error("שגיאה בהוספת סוג עבודה (אולי כבר קיים)");
    await refresh();
    toast.success("סוג העבודה נוסף");
  }
  async function renameJobType(id: string, name: string) {
    await supabase.from("job_types").update({ name }).eq("id", id);
    await refresh();
  }
  async function toggleJobType(id: string, active: boolean) {
    await supabase.from("job_types").update({ is_active: active }).eq("id", id);
    await refresh();
  }

  // the price normally quoted for this kind of job; an empty box clears it
  async function saveBasePrice(id: string, shekels: string) {
    const trimmed = shekels.trim();
    const agorot = trimmed === "" ? null : shekelsToAgorot(trimmed);
    if (agorot !== null && (!Number.isFinite(agorot) || agorot < 0)) {
      return toast.error("מחיר חייב להיות מספר חיובי");
    }
    const { error } = await supabase.from("job_types").update({ base_price_agorot: agorot }).eq("id", id);
    if (error) return toast.error("שגיאה בשמירת המחיר");
    await refresh();
    toast.success(agorot === null ? "המחיר הקבוע הוסר" : "המחיר הקבוע עודכן");
  }

  async function saveVisitFee(table: "job_types" | "professions", id: string, shekels: string) {
    const agorot = shekels.trim() === "" ? null : shekelsToAgorot(shekels);
    const { error } = await supabase.from(table).update({ visit_fee_agorot: agorot }).eq("id", id);
    if (error) return toast.error(errorMessage(error, "שגיאה בשמירת דמי הביקור"));
    await refresh();
    toast.success(agorot === null ? "דמי הביקור חזרו לברירת המחדל" : "דמי הביקור עודכנו");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">תחומים וסוגי עבודות</h1>
        <p className="text-sm text-ink-500">נהלו את התחומים המקצועיים ואת סוגי העבודות בכל תחום</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>תחומים</CardTitle>
        </CardHeader>
        <CardBody>
          <EditableList
            items={professions}
            addPlaceholder="שם תחום חדש (לדוגמה: הדברה)"
            onAdd={addProfession}
            onRename={renameProfession}
            onToggleActive={toggleProfession}
            archiveNoun="התחום"
          />
        </CardBody>
      </Card>

      <div className="space-y-3">
        {professions.map((profession) => {
          const types = jobTypes.filter((jt) => jt.profession_id === profession.id);
          const isOpen = expanded === profession.id;
          return (
            <Card key={profession.id}>
              <button
                onClick={() => setExpanded(isOpen ? null : profession.id)}
                className="flex w-full items-center justify-between px-5 py-4"
              >
                <span className="font-bold text-ink-800">סוגי עבודה: {profession.name}</span>
                {isOpen ? <ChevronUp className="h-4 w-4 text-ink-400" /> : <ChevronDown className="h-4 w-4 text-ink-400" />}
              </button>
              {isOpen && (
                <CardBody className="pt-0">
                  <div className="mb-4 rounded-2xl border border-brand-100 bg-brand-50/50 p-3.5">
                    <p className="mb-2 text-xs font-bold text-ink-500">
                      איך הלקוח ישמע על בעל המקצוע בהודעת ״בדרך אליך״
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-ink-500">שלום ישראל,</span>
                      <Input
                        defaultValue={profession.technician_label ?? ""}
                        onBlur={(e) => {
                          if (e.target.value.trim() !== (profession.technician_label ?? "")) {
                            saveTechnicianLabel(profession.id, e.target.value);
                          }
                        }}
                        className="w-auto min-w-[170px] max-w-[240px] flex-1 bg-white py-1.5 font-bold text-brand-700"
                        placeholder="טכנאי האינסטלציה"
                      />
                      <span className="text-ink-500">כבר בדרך אליך 🚚</span>
                    </div>
                  </div>
                  <div className="mb-4 rounded-2xl border border-ink-100 bg-ink-50/60 p-3.5">
                    <p className="mb-2 text-xs font-bold text-ink-500">
                      דמי ביקור ואבחון לכל התחום — אלא אם לסוג תקלה מסוים יש סכום משלו
                    </p>
                    <MoneyInput
                      label="דמי ביקור לתחום"
                      key={`${profession.id}-fee-${profession.visit_fee_agorot ?? "none"}`}
                      agorot={profession.visit_fee_agorot ?? null}
                      onSave={(v) => saveVisitFee("professions", profession.id, v)}
                      placeholder={String(agorotToShekels(settings?.visit_fee_agorot ?? 49900))}
                    />
                  </div>
                  <p className="mb-2 text-xs font-bold text-ink-500">
                    המחיר הקבוע הוא מה שתגידו ללקוח בטלפון — הוא ימולא לבד בפתיחת עבודה.
                    דמי הביקור הם מה שהלקוח מאשר בהודעה לפני שיוצאים אליו.
                  </p>
                  <EditableList
                    items={types}
                    addPlaceholder="סוג עבודה חדש"
                    onAdd={(name) => addJobType(profession.id, name)}
                    onRename={renameJobType}
                    onToggleActive={toggleJobType}
                    archiveNoun="סוג העבודה"
                    renderExtra={(item) => {
                      const jt = jobTypes.find((t) => t.id === item.id);
                      return (
                        <>
                          <MoneyInput
                            label="מחיר קבוע"
                            key={`${item.id}-${jt?.base_price_agorot ?? "none"}`}
                            agorot={jt?.base_price_agorot ?? null}
                            onSave={(v) => saveBasePrice(item.id, v)}
                          />
                          <MoneyInput
                            label="דמי ביקור"
                            key={`${item.id}-fee-${jt?.visit_fee_agorot ?? "none"}`}
                            agorot={jt?.visit_fee_agorot ?? null}
                            onSave={(v) => saveVisitFee("job_types", item.id, v)}
                            placeholder={String(
                              agorotToShekels(profession.visit_fee_agorot ?? settings?.visit_fee_agorot ?? 49900)
                            )}
                          />
                        </>
                      );
                    }}
                  />
                </CardBody>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
