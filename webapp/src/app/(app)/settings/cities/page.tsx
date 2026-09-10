"use client";

import { useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody } from "@/components/ui/Card";
import { EditableList } from "@/components/settings/EditableList";

export default function CitiesSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { cities, refresh } = useRefData();
  const toast = useToast();

  async function addCity(name: string) {
    const { error } = await supabase.from("cities").insert({ name });
    if (error) return toast.error("שגיאה בהוספת עיר (אולי כבר קיימת)");
    await refresh();
    toast.success("העיר נוספה");
  }
  async function renameCity(id: string, name: string) {
    await supabase.from("cities").update({ name }).eq("id", id);
    await refresh();
  }
  async function toggleCity(id: string, active: boolean) {
    await supabase.from("cities").update({ is_active: active }).eq("id", id);
    await refresh();
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">ערים</h1>
        <p className="text-sm text-ink-500">נהלו את הערים בהן העסק פעיל</p>
      </div>
      <Card>
        <CardBody>
          <EditableList
            items={cities}
            addPlaceholder="שם עיר חדשה"
            onAdd={addCity}
            onRename={renameCity}
            onToggleActive={toggleCity}
            archiveNoun="העיר"
          />
        </CardBody>
      </Card>
    </div>
  );
}
