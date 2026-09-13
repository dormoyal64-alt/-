"use client";

import { useMemo, useState } from "react";
import { Fuel, Plus, Trash2, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { agorotToShekels, formatAgorot, shekelsToAgorot } from "@/lib/money";

export default function VehicleSettingsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { cities, helpers, settings, refresh } = useRefData();
  const toast = useToast();

  const [price, setPrice] = useState("");
  const [kmPerLiter, setKmPerLiter] = useState("");
  const [homeCity, setHomeCity] = useState("");
  const [savingFuel, setSavingFuel] = useState(false);

  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPay, setNewPay] = useState("");
  const [addingHelper, setAddingHelper] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);

  const activeCities = cities.filter((c) => c.is_active);
  // each box starts from what is stored, and shows your edit once you make one
  const priceValue = price !== "" ? price : settings ? String(agorotToShekels(settings.fuel_price_per_liter_agorot)) : "";
  const kmValue = kmPerLiter !== "" ? kmPerLiter : settings ? String(settings.km_per_liter) : "";
  const homeValue = homeCity !== "" ? homeCity : settings?.home_city_id ?? "";

  const sampleKm = 30;
  const previewAgorot =
    Number(kmValue) > 0 ? Math.round((sampleKm / Number(kmValue)) * shekelsToAgorot(priceValue || "0")) : 0;

  async function saveFuel() {
    const p = shekelsToAgorot(priceValue || "0");
    const k = Number(kmValue);
    if (!Number.isFinite(p) || p <= 0) return toast.error("מחיר לליטר חייב להיות גדול מאפס");
    if (!Number.isFinite(k) || k <= 0) return toast.error("צריכת דלק חייבת להיות גדולה מאפס");
    setSavingFuel(true);
    const { error } = await supabase
      .from("app_settings")
      .update({
        fuel_price_per_liter_agorot: p,
        km_per_liter: k,
        fuel_price_updated_on: new Date().toISOString().slice(0, 10),
        home_city_id: homeValue || null,
      })
      .eq("id", true);
    setSavingFuel(false);
    if (error) return toast.error("שגיאה בשמירת ההגדרות");
    await refresh();
    toast.success("הגדרות הרכב והדלק נשמרו");
  }

  async function addHelper() {
    const name = newName.trim();
    if (!name) return;
    setAddingHelper(true);
    const { error } = await supabase.from("helpers").insert({
      name,
      phone: newPhone.trim() || null,
      default_pay_agorot: newPay.trim() === "" ? null : shekelsToAgorot(newPay),
    });
    setAddingHelper(false);
    if (error) return toast.error("העובד כבר קיים ברשימה");
    setNewName("");
    setNewPhone("");
    setNewPay("");
    await refresh();
    toast.success(`${name} נוסף`);
  }

  async function savePay(id: string, shekels: string) {
    const agorot = shekels.trim() === "" ? null : shekelsToAgorot(shekels);
    if (agorot !== null && (!Number.isFinite(agorot) || agorot < 0)) {
      return toast.error("שכר חייב להיות מספר חיובי");
    }
    await supabase.from("helpers").update({ default_pay_agorot: agorot }).eq("id", id);
    await refresh();
    toast.success("השכר עודכן");
  }

  const removeTarget = helpers.find((h) => h.id === removeId);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">רכב, דלק ועובדים</h1>
        <p className="text-sm text-ink-500">
          מה שקובע כמה עולה לכם להגיע ללקוח, וכמה אתם משלמים לעובד שבא איתכם
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Fuel className="h-4 w-4 text-brand-600" /> דלק ורכב
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label required>מחיר לליטר (₪)</Label>
              <Input
                type="number"
                min={0}
                step={0.01}
                inputMode="decimal"
                value={priceValue}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div>
              <Label required>כמה ק״מ לליטר</Label>
              <Input
                type="number"
                min={0}
                step={0.1}
                inputMode="decimal"
                value={kmValue}
                onChange={(e) => setKmPerLiter(e.target.value)}
              />
            </div>
            <div>
              <Label>מאיפה אתם יוצאים בדרך כלל</Label>
              <select value={homeValue} onChange={(e) => setHomeCity(e.target.value)} className="input">
                <option value="">לא נבחר</option>
                {activeCities.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {previewAgorot > 0 && (
            <div className="rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-700">
              נסיעה של {sampleKm} ק״מ תעלה לכם {formatAgorot(previewAgorot)}
            </div>
          )}

          <p className="text-xs text-ink-400">
            מחירי הדלק בישראל מתעדכנים אחת לחודש. המערכת לא מושכת אותם מאף מקום — מעדכנים כאן ידנית.
            {settings?.fuel_price_updated_on ? ` עודכן לאחרונה: ${settings.fuel_price_updated_on}` : ""}
          </p>

          <Button onClick={saveFuel} loading={savingFuel}>
            שמירת הגדרות הדלק
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Users className="h-4 w-4 text-brand-600" /> עובדים
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-ink-500">
            עובד ששמור כאן יוצע בפתיחת עבודה שאתם מבצעים, והשכר שלו יתמלא לבד
          </p>

          <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
            {helpers.length === 0 && <p className="p-4 text-sm text-ink-400">עדיין לא הוספתם עובדים</p>}
            {helpers.map((h) => (
              <div key={h.id} className="flex flex-wrap items-center gap-2 p-3">
                <span className="flex-1 text-sm font-bold text-ink-800">{h.name}</span>
                {h.phone && (
                  <span className="text-xs text-ink-400" dir="ltr">
                    {h.phone}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-ink-400">שכר לעבודה</span>
                  <Input
                    key={`${h.id}-${h.default_pay_agorot ?? "none"}`}
                    type="number"
                    min={0}
                    inputMode="decimal"
                    defaultValue={h.default_pay_agorot == null ? "" : String(agorotToShekels(h.default_pay_agorot))}
                    onBlur={(e) => {
                      const current = h.default_pay_agorot == null ? "" : String(agorotToShekels(h.default_pay_agorot));
                      if (e.target.value.trim() !== current) savePay(h.id, e.target.value);
                    }}
                    placeholder="—"
                    aria-label={`שכר קבוע ל${h.name}`}
                    className="w-24 py-1.5 text-center font-bold"
                  />
                  <span className="text-xs font-bold text-ink-400">₪</span>
                </span>
                <button
                  onClick={() => setRemoveId(h.id)}
                  className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-danger-600"
                  aria-label={`מחיקת ${h.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="שם העובד"
              className="min-w-[140px] flex-1"
            />
            <Input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="טלפון"
              dir="ltr"
              className="w-36"
            />
            <Input
              type="number"
              min={0}
              value={newPay}
              onChange={(e) => setNewPay(e.target.value)}
              placeholder="שכר ₪"
              className="w-28"
            />
            <Button onClick={addHelper} loading={addingHelper} disabled={!newName.trim()}>
              <Plus className="h-4 w-4" /> הוספה
            </Button>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={!!removeId}
        onClose={() => setRemoveId(null)}
        onConfirm={async () => {
          if (!removeTarget) return;
          const { error } = await supabase.from("helpers").delete().eq("id", removeTarget.id);
          setRemoveId(null);
          if (error) return toast.error("לא ניתן למחוק — יש עבודות שמשויכות לעובד הזה");
          await refresh();
          toast.success("העובד נמחק");
        }}
        title={`למחוק את ${removeTarget?.name ?? ""}?`}
        description="אם יש עבודות שמשויכות אליו, המחיקה תיחסם ותוכלו פשוט להשאיר אותו ברשימה."
        confirmLabel="מחיקה"
        danger
      />
    </div>
  );
}
