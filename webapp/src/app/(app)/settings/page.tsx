"use client";

import { useMemo, useState } from "react";
import { Bell, BellOff, Trash2, Info } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useNotifications } from "@/lib/notifications";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EditableList } from "@/components/settings/EditableList";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const STATUS_COLORS = ["#3b82f6", "#6172f3", "#06b6d4", "#8b5cf6", "#f59e0b", "#64748b", "#f97316", "#10b981", "#ef4444", "#6b7280"];

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { paymentMethods, leadSources, jobStatuses, refresh } = useRefData();
  const { notificationPermission, requestPermission } = useNotifications();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newStatusName, setNewStatusName] = useState("");

  async function addPaymentMethod(name: string) {
    const { error } = await supabase.from("payment_methods").insert({ name, sort_order: paymentMethods.length });
    if (error) return toast.error("שגיאה בהוספה (אולי כבר קיים)");
    await refresh();
  }
  async function addLeadSource(name: string) {
    const { error } = await supabase.from("lead_sources").insert({ name, sort_order: leadSources.length });
    if (error) return toast.error("שגיאה בהוספה (אולי כבר קיים)");
    await refresh();
  }

  async function addStatus() {
    if (!newStatusName.trim()) return;
    const color = STATUS_COLORS[jobStatuses.length % STATUS_COLORS.length];
    const { error } = await supabase.from("job_statuses").insert({ name: newStatusName.trim(), color, sort_order: jobStatuses.length });
    if (error) return toast.error("שגיאה בהוספת סטטוס (אולי כבר קיים)");
    setNewStatusName("");
    await refresh();
  }
  async function updateStatusColor(id: string, color: string) {
    await supabase.from("job_statuses").update({ color }).eq("id", id);
    await refresh();
  }
  async function toggleStatusActive(id: string, active: boolean) {
    await supabase.from("job_statuses").update({ is_active: active }).eq("id", id);
    await refresh();
  }

  async function handleResetDemoData() {
    setResetting(true);
    try {
      await supabase.from("jobs").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("settlements").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await supabase.from("contractors").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      await refresh();
      toast.success("נתוני הדוגמה נמחקו. אפשר להתחיל לעבוד עם נתונים אמיתיים.");
    } catch {
      toast.error("שגיאה במחיקת הנתונים");
    } finally {
      setResetting(false);
      setConfirmReset(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">הגדרות</h1>
        <p className="text-sm text-ink-500">אמצעי תשלום, מקורות ליד, סטטוסים והתראות</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>התראות דפדפן</CardTitle>
        </CardHeader>
        <CardBody className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-500">
            קבלו התראה בדפדפן כשעבודה לא נסגרת יותר משעתיים, גם אם המערכת פתוחה ברקע.
          </p>
          {notificationPermission === "granted" ? (
            <span className="flex shrink-0 items-center gap-1.5 badge bg-success-50 text-success-700">
              <Bell className="h-3.5 w-3.5" /> מאושר
            </span>
          ) : notificationPermission === "unsupported" ? (
            <span className="shrink-0 badge bg-ink-100 text-ink-500">לא נתמך</span>
          ) : (
            <Button size="sm" onClick={requestPermission} className="shrink-0">
              <BellOff className="h-4 w-4" /> הפעלת התראות
            </Button>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>אמצעי תשלום</CardTitle>
        </CardHeader>
        <CardBody>
          <EditableList
            items={paymentMethods}
            addPlaceholder="אמצעי תשלום חדש"
            onAdd={addPaymentMethod}
            onRename={async (id, name) => { await supabase.from("payment_methods").update({ name }).eq("id", id); await refresh(); }}
            onToggleActive={async (id, active) => { await supabase.from("payment_methods").update({ is_active: active }).eq("id", id); await refresh(); }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>מקורות ליד</CardTitle>
        </CardHeader>
        <CardBody>
          <EditableList
            items={leadSources}
            addPlaceholder="מקור ליד חדש"
            onAdd={addLeadSource}
            onRename={async (id, name) => { await supabase.from("lead_sources").update({ name }).eq("id", id); await refresh(); }}
            onToggleActive={async (id, active) => { await supabase.from("lead_sources").update({ is_active: active }).eq("id", id); await refresh(); }}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>סטטוסים לעבודה</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex gap-2">
            <Input value={newStatusName} onChange={(e) => setNewStatusName(e.target.value)} placeholder="סטטוס חדש" />
            <Button onClick={addStatus}>הוספה</Button>
          </div>
          <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
            {jobStatuses.map((s) => (
              <div key={s.id} className={`flex items-center gap-2 p-3 ${!s.is_active ? "bg-ink-50/60" : ""}`}>
                <div className="flex gap-1">
                  {STATUS_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => updateStatusColor(s.id, c)}
                      className="h-5 w-5 shrink-0 rounded-full ring-offset-1"
                      style={{ backgroundColor: c, boxShadow: s.color === c ? `0 0 0 2px white, 0 0 0 3.5px ${c}` : undefined }}
                    />
                  ))}
                </div>
                <span className={`flex-1 text-sm font-semibold ${s.is_active ? "text-ink-800" : "text-ink-400 line-through"}`}>{s.name}</span>
                <button
                  onClick={() => toggleStatusActive(s.id, !s.is_active)}
                  className="rounded-lg px-2 py-1 text-xs font-bold text-ink-400 hover:bg-ink-100"
                >
                  {s.is_active ? "השבתה" : "הפעלה"}
                </button>
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card className="border-2 border-danger-100">
        <CardHeader>
          <CardTitle className="text-danger-700">אזור מסוכן</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-start gap-2 rounded-xl bg-warning-50 p-3 text-xs text-warning-700">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            המערכת מגיעה עם נתוני דוגמה (קבלנים ועבודות) כדי שתוכלו לראות איך היא עובדת. לפני תחילת עבודה אמיתית מומלץ למחוק אותם.
          </div>
          <Button variant="danger" onClick={() => setConfirmReset(true)}>
            <Trash2 className="h-4 w-4" /> מחיקת כל נתוני הדוגמה (עבודות וקבלנים)
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={handleResetDemoData}
        title="למחוק את כל העבודות והקבלנים?"
        description="פעולה זו תמחק לצמיתות את כל העבודות, ההתחשבנויות והקבלנים במערכת. תחומים, סוגי עבודה, ערים וסטטוסים יישארו. לא ניתן לבטל פעולה זו."
        confirmLabel="כן, מחיקה לצמיתות"
        loading={resetting}
      />
    </div>
  );
}
