"use client";

import { useMemo, useState } from "react";
import { Bell, BellOff, Trash2, Info, Eye, EyeOff, Receipt as ReceiptIcon, Percent } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useNotifications } from "@/lib/notifications";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { EditableList } from "@/components/settings/EditableList";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

const STATUS_COLORS = ["#3b82f6", "#6172f3", "#06b6d4", "#8b5cf6", "#f59e0b", "#64748b", "#f97316", "#10b981", "#ef4444", "#6b7280"];

export default function SettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { paymentMethods, leadSources, jobStatuses, settings, refresh } = useRefData();
  const { notificationPermission, requestPermission } = useNotifications();
  const toast = useToast();
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newStatusName, setNewStatusName] = useState("");
  const [savingReminder, setSavingReminder] = useState(false);
  const [savingPhonePolicy, setSavingPhonePolicy] = useState(false);
  const [savingBusiness, setSavingBusiness] = useState(false);

  async function saveReminderMinutes(minutes: number) {
    if (!minutes || minutes < 5) return;
    setSavingReminder(true);
    const { error } = await supabase.from("app_settings").update({ reminder_minutes: minutes }).eq("id", true);
    setSavingReminder(false);
    if (error) return toast.error("שגיאה בשמירת זמן התזכורת");
    await refresh();
    toast.success("מעכשיו תישלח תזכורת אחרי " + (minutes < 60 ? minutes + " דקות" : minutes / 60 + " שעות"));
  }

  async function saveBusinessField(field: string, value: string | boolean) {
    setSavingBusiness(true);
    const { error } = await supabase
      .from("app_settings")
      .update({ [field]: typeof value === "string" ? value.trim() || null : value })
      .eq("id", true);
    setSavingBusiness(false);
    if (error) return toast.error("שגיאה בשמירה");
    await refresh();
    toast.success("נשמר");
  }

  async function saveSendPhonePolicy(next: boolean) {
    setSavingPhonePolicy(true);
    const { error } = await supabase
      .from("app_settings")
      .update({ send_customer_phone_to_contractor: next })
      .eq("id", true);
    setSavingPhonePolicy(false);
    if (error) return toast.error("שגיאה בשמירת ההגדרה");
    await refresh();
    toast.success(next ? "טלפון הלקוח ייכלל בהודעות לקבלנים" : "טלפון הלקוח לא ייכלל בהודעות לקבלנים");
  }

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

  const reminderMinutes = settings?.reminder_minutes ?? 120;
  const sendPhonePolicy = settings?.send_customer_phone_to_contractor ?? true;
  const taxRate = settings?.tax_rate_pct ?? 18;
  const includesTax = settings?.prices_include_tax ?? true;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">הגדרות</h1>
        <p className="text-sm text-ink-500">אמצעי תשלום, מקורות ליד, סטטוסים והתראות</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>תזכורת מעקב אחרי עבודה</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-500">
            אחרי כמה זמן מפתיחת העבודה לקבל התראה לבדוק מה הסטטוס מול הקבלן?
          </p>
          <div className="flex flex-wrap gap-2">
            {[30, 60, 90, 120, 180, 240].map((v) => (
              <button
                key={v}
                onClick={() => saveReminderMinutes(v)}
                disabled={savingReminder}
                className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                  reminderMinutes === v
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                {v < 60 ? `${v} דק׳` : v === 60 ? "שעה" : `${v / 60} שעות`}
              </button>
            ))}
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Label>או זמן מותאם (בדקות)</Label>
              <Input
                type="number"
                min={5}
                step={5}
                defaultValue={reminderMinutes}
                onBlur={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (v >= 5 && v !== reminderMinutes) saveReminderMinutes(v);
                }}
              />
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-5 w-5 text-ink-400" /> מס על עבודות שנסגרו עם קבלה
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-500">
            רק עבודה שנסגרה <b>עם קבלה</b> נושאת מס. המס מחושב ברגע הסגירה ונשמר על העבודה,
            כך ששינוי האחוז כאן <b>לא משנה עבודות שכבר נסגרו</b>.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>אחוז המס</Label>
              <Input
                type="number"
                min={0}
                max={100}
                step="any"
                dir="ltr"
                key={String(taxRate)}
                defaultValue={taxRate}
                onBlur={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isNaN(v) && v >= 0 && v <= 100 && v !== taxRate) saveBusinessField("tax_rate_pct", String(v));
                }}
              />
              <p className="mt-1 text-xs text-ink-400">מע״מ בישראל — עדכנו אם האחוז משתנה</p>
            </div>
            <div>
              <Label>המחירים שאתם גובים</Label>
              <div className="flex flex-wrap gap-2">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    onClick={() => saveBusinessField("prices_include_tax", v)}
                    disabled={savingBusiness}
                    className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                      includesTax === v
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-ink-200 text-ink-600 hover:bg-ink-50"
                    }`}
                  >
                    {v ? "כוללים מס" : "לפני מס"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-ink-400">
                {includesTax
                  ? `מ-₪1,000 המס הוא ${(1000 * taxRate / (100 + taxRate)).toFixed(2)} ₪`
                  : `על ₪1,000 יתווסף מס של ${(1000 * taxRate / 100).toFixed(2)} ₪`}
              </p>
            </div>
          </div>
          <p className="text-xs text-ink-400">
            זה חישוב לניהול פנימי שלכם, לא דיווח רשמי. התייעצו עם רואה החשבון לגבי החבות בפועל.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5 text-ink-400" /> פרטי העסק לקבלות
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-500">
            מה שימולא כאן יופיע בראש כל קבלה שתפיקו ללקוחות. שינוי כאן משפיע על קבלות
            <b> חדשות בלבד</b> — קבלות שכבר הופקו נשארות כפי שהיו.
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <BusinessField label="שם העסק" field="business_name" value={settings?.business_name} onSave={saveBusinessField} disabled={savingBusiness} placeholder="ביוביות בדרום" />
            <BusinessField label="ח.פ. / מספר עוסק" field="business_number" value={settings?.business_number} onSave={saveBusinessField} disabled={savingBusiness} placeholder="123456789" dir="ltr" />
            <BusinessField label="כתובת" field="business_address" value={settings?.business_address} onSave={saveBusinessField} disabled={savingBusiness} placeholder="שדרות הנשיא 22, באר שבע" />
            <BusinessField label="טלפון" field="business_phone" value={settings?.business_phone} onSave={saveBusinessField} disabled={savingBusiness} placeholder="050-1234567" dir="ltr" />
            <BusinessField label="אימייל" field="business_email" value={settings?.business_email} onSave={saveBusinessField} disabled={savingBusiness} placeholder="info@example.com" dir="ltr" />
            <BusinessField label="שורת סיום בקבלה" field="receipt_footer" value={settings?.receipt_footer} onSave={saveBusinessField} disabled={savingBusiness} placeholder="תודה שבחרתם בנו!" />
          </div>
          <div className="border-t border-ink-100 pt-3">
            <p className="mb-2 text-sm font-semibold text-ink-700">בסגירת עבודה, המתג ״הפקת קבלה״ יתחיל:</p>
            <div className="flex flex-wrap gap-2">
              {[true, false].map((v) => (
                <button
                  key={String(v)}
                  onClick={() => saveBusinessField("auto_receipt", v)}
                  disabled={savingBusiness}
                  className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                    (settings?.auto_receipt ?? false) === v
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-ink-200 text-ink-600 hover:bg-ink-50"
                  }`}
                >
                  {v ? "דלוק" : "כבוי"}
                </button>
              ))}
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>טלפון הלקוח בהודעה לקבלן</CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-sm text-ink-500">
            ברירת המחדל לעבודות חדשות. המספר תמיד נשמר במערכת — ההגדרה קובעת רק אם הוא נכלל
            בהודעת הוואטסאפ שנשלחת לקבלן. אפשר לשנות לכל עבודה בנפרד.
          </p>
          <div className="flex flex-wrap gap-2">
            {[true, false].map((v) => (
              <button
                key={String(v)}
                onClick={() => saveSendPhonePolicy(v)}
                disabled={savingPhonePolicy}
                className={`flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition ${
                  sendPhonePolicy === v
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                {v ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                {v ? "לשלוח את המספר" : "לא לשלוח את המספר"}
              </button>
            ))}
          </div>
          {!sendPhonePolicy && (
            <p className="text-xs text-ink-400">
              בהודעה לקבלן ייכתב במקום המספר: ״לתיאום מול הלקוח — דברו איתי״.
            </p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>התראות דפדפן</CardTitle>
        </CardHeader>
        <CardBody className="flex items-center justify-between gap-3">
          <p className="text-sm text-ink-500">
            קבלו התראה בדפדפן כשעבודה חורגת מהזמן שהגדרתם, גם אם המערכת פתוחה ברקע בלבד.
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

/** One business detail, saved when the field loses focus. */
function BusinessField({
  label, field, value, onSave, disabled, placeholder, dir,
}: {
  label: string;
  field: string;
  value: string | null | undefined;
  onSave: (field: string, value: string) => Promise<void>;
  disabled?: boolean;
  placeholder?: string;
  dir?: "ltr" | "rtl";
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        defaultValue={value ?? ""}
        placeholder={placeholder}
        dir={dir}
        disabled={disabled}
        // keyed on the stored value so an external change re-seeds the box
        key={value ?? ""}
        onBlur={(e) => {
          if (e.target.value.trim() !== (value ?? "").trim()) onSave(field, e.target.value);
        }}
      />
    </div>
  );
}
