"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { formatAgorot } from "@/lib/money";
import { customDateRange, getPeriodRange, isoRange, type PeriodKey } from "@/lib/dates";
import type { ReferralBalanceRow } from "@/lib/types";

export default function ReferralsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { referralCompanies, refresh } = useRefData();
  const toast = useToast();

  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const [balances, setBalances] = useState<ReferralBalanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newPct, setNewPct] = useState("20");
  const [adding, setAdding] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [settleId, setSettleId] = useState<string | null>(null);

  const range = period === "custom" ? customDateRange(customFrom, customTo) : getPeriodRange(period);
  const rangeIso = isoRange(range);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase.rpc("referral_balances", { p_from: rangeIso.from, p_to: rangeIso.to });
    setBalances((data as ReferralBalanceRow[]) ?? []);
    setLoading(false);
  }, [supabase, rangeIso.from, rangeIso.to]);

  useEffect(() => {
    load();
  }, [load]);

  async function addCompany() {
    const name = newName.trim();
    if (!name) return;
    const pct = parseFloat(newPct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return toast.error("אחוז חייב להיות בין 0 ל-100");
    setAdding(true);
    const { error } = await supabase.from("referral_companies").insert({
      name,
      contact_name: newContact.trim() || null,
      phone: newPhone.trim() || null,
      default_commission_pct: pct,
    });
    setAdding(false);
    if (error) return toast.error("החברה כבר קיימת ברשימה");
    setNewName("");
    setNewContact("");
    setNewPhone("");
    setNewPct("20");
    await refresh();
    toast.success(`${name} נוספה`);
  }

  async function savePct(id: string, value: string) {
    const pct = parseFloat(value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return toast.error("אחוז חייב להיות בין 0 ל-100");
    await supabase.from("referral_companies").update({ default_commission_pct: pct }).eq("id", id);
    await refresh();
    toast.success("האחוז הקבוע עודכן");
  }

  const settleTarget = balances.find((b) => b.company_id === settleId);
  const removeTarget = referralCompanies.find((c) => c.id === removeId);
  const totalOwed = balances.reduce((s, b) => s + b.unpaid_fee_agorot, 0);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">חברות מפנות</h1>
        <p className="text-sm text-ink-500">
          חברות שמעבירות לכם עבודות ולוקחות אחוז — כמה הן הביאו, וכמה אתם חייבים להן
        </p>
      </div>

      <PeriodPicker
        period={period}
        onChange={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      {totalOwed > 0 && (
        <Card className="border-warning-100 bg-warning-50">
          <CardBody className="flex items-center justify-between">
            <span className="text-sm font-bold text-warning-600">סך הכל אתם חייבים לחברות בתקופה</span>
            <span className="text-xl font-extrabold text-warning-600">{formatAgorot(totalOwed)}</span>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>מאזן מול החברות</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-ink-400">טוען...</p>
          ) : balances.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">אין עבודות מחברות בתקופה הזו</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-ink-100 text-xs font-bold text-ink-400">
                    <th className="p-3 text-start">חברה</th>
                    <th className="p-3 text-start">עבודות</th>
                    <th className="p-3 text-start">מחזור</th>
                    <th className="p-3 text-start">מגיע לחברה</th>
                    <th className="p-3 text-start">טרם שולם</th>
                    <th className="p-3 text-start">נשאר לי</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => (
                    <tr key={b.company_id} className="border-b border-ink-50 last:border-0">
                      <td className="p-3 font-bold text-ink-800">{b.company_name}</td>
                      <td className="p-3 tabular-nums text-ink-600">{b.jobs_count}</td>
                      <td className="p-3 tabular-nums text-ink-600">{formatAgorot(b.revenue_agorot)}</td>
                      <td className="p-3 tabular-nums font-bold text-danger-600">{formatAgorot(b.fee_agorot)}</td>
                      <td className="p-3 tabular-nums font-extrabold text-warning-600">
                        {formatAgorot(b.unpaid_fee_agorot)}
                      </td>
                      <td className="p-3 tabular-nums font-extrabold text-success-700">
                        {formatAgorot(b.my_share_agorot)}
                      </td>
                      <td className="p-3">
                        {b.unpaid_fee_agorot > 0 && (
                          <button
                            onClick={() => setSettleId(b.company_id)}
                            className="btn-secondary whitespace-nowrap px-2.5 py-1 text-xs"
                          >
                            סימון כשולם
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-brand-600" /> החברות שלי
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-ink-500">
            האחוז כאן הוא ברירת המחדל. בכל עבודה אפשר לשנות אותו בנפרד בלי לגעת בו.
          </p>

          <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
            {referralCompanies.length === 0 && (
              <p className="p-4 text-sm text-ink-400">עדיין לא הוספתם חברות</p>
            )}
            {referralCompanies.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-2 p-3">
                <span className="flex-1 text-sm font-bold text-ink-800">
                  {c.name}
                  {c.contact_name && <span className="mr-1.5 text-xs font-normal text-ink-400">{c.contact_name}</span>}
                </span>
                {c.phone && (
                  <span className="text-xs text-ink-400" dir="ltr">
                    {c.phone}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <span className="text-xs font-bold text-ink-400">לוקחת</span>
                  <Input
                    key={`${c.id}-${c.default_commission_pct}`}
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    defaultValue={String(c.default_commission_pct)}
                    onBlur={(e) => {
                      if (e.target.value.trim() !== String(c.default_commission_pct)) savePct(c.id, e.target.value);
                    }}
                    aria-label={`אחוז קבוע ל${c.name}`}
                    className="w-20 py-1.5 text-center font-bold"
                  />
                  <span className="text-xs font-bold text-ink-400">%</span>
                </span>
                <button
                  onClick={() => setRemoveId(c.id)}
                  className="rounded-lg p-2 text-ink-400 hover:bg-ink-100 hover:text-danger-600"
                  aria-label={`מחיקת ${c.name}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
            <div>
              <Label required>שם החברה</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="שם" />
            </div>
            <div>
              <Label>איש קשר</Label>
              <Input value={newContact} onChange={(e) => setNewContact(e.target.value)} placeholder="שם" />
            </div>
            <div>
              <Label>טלפון</Label>
              <Input value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="03-1234567" dir="ltr" />
            </div>
            <div>
              <Label required>אחוז קבוע</Label>
              <Input type="number" min={0} max={100} step={0.5} value={newPct} onChange={(e) => setNewPct(e.target.value)} />
            </div>
          </div>
          <Button onClick={addCompany} loading={adding} disabled={!newName.trim()}>
            <Plus className="h-4 w-4" /> הוספת חברה
          </Button>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={!!settleId}
        onClose={() => setSettleId(null)}
        onConfirm={async () => {
          if (!settleTarget) return;
          const { data, error } = await supabase.rpc("settle_referral", {
            p_company_id: settleTarget.company_id,
            p_from: rangeIso.from,
            p_to: rangeIso.to,
          });
          setSettleId(null);
          if (error) return toast.error("שגיאה בסימון התשלום");
          await load();
          toast.success(`${data} עבודות סומנו כשולמו`);
        }}
        title={`לסמן ש-${settleTarget?.company_name ?? ""} קיבלה את הכסף?`}
        description={`${formatAgorot(settleTarget?.unpaid_fee_agorot ?? 0)} יסומנו כשולמו עבור התקופה שנבחרה. אפשר לפתוח מחדש כל עבודה בנפרד.`}
        confirmLabel="כן, שולם"
      />

      <ConfirmDialog
        open={!!removeId}
        onClose={() => setRemoveId(null)}
        onConfirm={async () => {
          if (!removeTarget) return;
          const { error } = await supabase.from("referral_companies").delete().eq("id", removeTarget.id);
          setRemoveId(null);
          if (error) return toast.error("לא ניתן למחוק — יש עבודות שהגיעו מהחברה הזו");
          await refresh();
          toast.success("החברה נמחקה");
        }}
        title={`למחוק את ${removeTarget?.name ?? ""}?`}
        description="אם יש עבודות שהגיעו ממנה, המחיקה תיחסם — ההיסטוריה נשמרת."
        confirmLabel="מחיקה"
        danger
      />
    </div>
  );
}
