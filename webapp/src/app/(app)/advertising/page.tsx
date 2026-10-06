"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Megaphone, Plus, Trash2, ChevronRight, ChevronLeft, Send, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { formatAgorot, shekelsToAgorot } from "@/lib/money";
import { SPEND_PERIODS, periodRange, daysInRange, describeRange, type SpendPeriod } from "@/lib/adPeriods";
import { formatDateTimeHe, todayLocalDate } from "@/lib/dates";
import type { AdReportMonth, AdSpend, ExpenseReceipt } from "@/lib/types";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { buildAdMonth, monthEnd, monthKey, monthLabel } from "@/lib/ads/report";
import { errorMessage } from "@/lib/errors";
import { ReceiptFiles } from "@/components/receipts/ReceiptFiles";
import { deleteAdSpend, listAdSpendReceipts } from "@/lib/api/expenseReceipts";

const today = () => todayLocalDate();

export default function AdvertisingPage() {
  const supabase = useMemo(() => createClient(), []);
  const { leadSources } = useRefData();
  const toast = useToast();

  const [rows, setRows] = useState<AdSpend[]>([]);
  const [receipts, setReceipts] = useState<ExpenseReceipt[]>([]);
  // the column arrives with a migration; until it does, offering a camera that
  // can only fail is worse than not offering one
  const [canAttach, setCanAttach] = useState(true);
  // the spend whose file dialog should open — set the moment one is recorded,
  // because that is when the invoice is in front of the person
  const [askingFor, setAskingFor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // the month on screen: everything below shows this month and nothing else,
  // keyed by the date on the form rather than the day it was typed in
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [report, setReport] = useState<AdReportMonth | null>(null);
  const [mailReady, setMailReady] = useState(false);
  const [asking, setAsking] = useState(false);
  const [sending, setSending] = useState(false);

  const [period, setPeriod] = useState<SpendPeriod>("day");
  const [spentOn, setSpentOn] = useState(today());
  const [customEnd, setCustomEnd] = useState(today());
  const [sourceId, setSourceId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("ad_spend")
      .select("*")
      .gte("spent_on", month)
      .lte("spent_on", monthEnd(month))
      .order("spent_on", { ascending: false });
    const list = (data as AdSpend[]) ?? [];
    // the table arrives with a migration; until it does the month simply has
    // no sending history, and the card below stays out of the way
    const { data: monthRow } = await supabase
      .from("ad_report_months")
      .select("*")
      .eq("month", month)
      .maybeSingle();
    setReport((monthRow as AdReportMonth) ?? null);
    setRows(list);
    // ask the database whether it has the column at all, rather than inferring
    // it from a list that may simply be empty: the first spend recorded must
    // not be offered a camera that cannot work
    const probe = await supabase.from("expense_receipts").select("ad_spend_id").limit(1);
    const supported = !probe.error;
    setCanAttach(supported);
    setReceipts(
      supported ? await listAdSpendReceipts(supabase, list.map((r) => r.id)).catch(() => []) : []
    );
    setLoading(false);
  }, [supabase, month]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    // a real send exists only once the business mailbox is configured on the
    // server; until then the button would only produce an error
    fetch("/api/ads/report")
      .then((r) => r.json())
      .then((d) => setMailReady(!!d?.configured))
      .catch(() => setMailReady(false));
  }, []);

  function stepMonth(by: number) {
    const d = new Date(month + "T00:00:00");
    setMonth(monthKey(new Date(d.getFullYear(), d.getMonth() + by, 1)));
  }

  const changedSinceSent =
    !!report?.sent_at && !!report?.changed_at && report.changed_at > report.sent_at;

  async function sendToAccountant() {
    setSending(true);
    try {
      const res = await fetch("/api/ads/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ month }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error ?? "השליחה נכשלה");
      toast.success(`נשלח לרואה החשבון (${data.to})`);
      setAsking(false);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "השליחה נכשלה"));
    } finally {
      setSending(false);
    }
  }

  const sourceName = (id: string | null) => leadSources.find((l) => l.id === id)?.name ?? "ללא ערוץ";
  // grouped by the very function the email and the spreadsheet use, so the
  // screen and what the accountant receives cannot disagree — and so spend
  // recorded without a channel gets its own line instead of vanishing from a
  // summary whose total still counts it
  const summary = buildAdMonth(month, rows, sourceName);
  const total = summary.total;
  const byChannel = summary.byChannel;

  const range = periodRange(period, spentOn, customEnd);
  const days = daysInRange(range.from, range.to);
  const perDay = amount.trim() ? Math.round(shekelsToAgorot(amount) / days) : 0;

  async function add() {
    const agorot = shekelsToAgorot(amount || "0");
    if (!Number.isFinite(agorot) || agorot <= 0) return toast.error("נא להזין סכום גדול מאפס");
    setSaving(true);
    const { data, error } = await supabase
      .from("ad_spend")
      .insert({
        spent_on: range.from,
        covers_to: range.to,
        lead_source_id: sourceId || null,
        amount_agorot: agorot,
        notes: notes.trim() || null,
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) return toast.error("שגיאה בשמירת ההוצאה");
    setAmount("");
    setNotes("");
    // the expense belongs to the month on the form, so that is the month to
    // show: entering a 30 September cost on 6 October moves the screen to
    // September, where the new row — and its receipt prompt — actually are
    const target = monthKey(range.from);
    if (target !== month) setMonth(target);
    else await load();
    // ask for the invoice while it is still on the screen in front of them
    if (canAttach && data?.id) setAskingFor(data.id as string);
    toast.success(target === month ? "ההוצאה נרשמה" : `ההוצאה נרשמה ל${monthLabel(target)}`);
  }

  async function remove(id: string) {
    try {
      await deleteAdSpend(supabase, id);
    } catch {
      return toast.error("שגיאה במחיקת ההוצאה");
    }
    await load();
    toast.success("ההוצאה נמחקה");
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">הוצאות פרסום</h1>
        <p className="text-sm text-ink-500">
          כמה הלך היום על פרסום ובאיזה ערוץ — זה מה שיורד מהרווח במסך ״רווח נקי״.
          {canAttach ? " אפשר לצרף לכל שורה קבלה או חשבונית, והיא תישלח לרואה החשבון עם הדוח החודשי." : ""}
        </p>
      </div>

      <Card>
        <CardBody className="flex items-center justify-between gap-2">
          <button
            onClick={() => stepMonth(-1)}
            className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:bg-ink-50"
            aria-label="חודש קודם"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-lg font-extrabold text-ink-900">{monthLabel(month)}</span>
          <button
            onClick={() => stepMonth(1)}
            className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:bg-ink-50"
            aria-label="חודש הבא"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </CardBody>
      </Card>

      {/* what the accountant has had of this month, and whether it is still true */}
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              changedSinceSent
                ? "bg-warning-50 text-warning-700"
                : report?.sent_at
                  ? "bg-success-50 text-success-600"
                  : "bg-ink-100 text-ink-400"
            }`}
          >
            {changedSinceSent ? (
              <AlertTriangle className="h-5 w-5" />
            ) : report?.sent_at ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : (
              <Send className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-900">
              {changedSinceSent
                ? "יש שינויים מאז השליחה"
                : report?.sent_at
                  ? "נשלח לרואה החשבון"
                  : "עדיין לא נשלח לרואה החשבון"}
            </p>
            <p className="text-xs text-ink-500">
              {report?.sent_at
                ? `נשלח ב-${formatDateTimeHe(report.sent_at)}${report.sent_to ? ` אל ${report.sent_to}` : ""}${
                    changedSinceSent ? " — אפשר לשלוח גרסה מעודכנת" : ""
                  }`
                : `${rows.length} רישומים · ${formatAgorot(total)}`}
            </p>
          </div>
          <Button
            variant={changedSinceSent || !report?.sent_at ? "primary" : "secondary"}
            onClick={() => setAsking(true)}
            disabled={!mailReady || sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {report?.sent_at ? "שליחה מחדש" : "שליחה לרואה חשבון"}
          </Button>
        </CardBody>
        {!mailReady && (
          <CardBody className="pt-0">
            <p className="text-xs text-ink-400">
              שליחה אמיתית תתאפשר אחרי שהמייל של העסק יוגדר בשרת. עד אז אפשר לייצא ולשלוח ידנית.
            </p>
          </CardBody>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-brand-600" /> רישום הוצאה
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <div>
            <Label required>לאיזו תקופה ההוצאה</Label>
            <div className="flex flex-wrap gap-2">
              {SPEND_PERIODS.map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setPeriod(opt.key)}
                  className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
                    period === opt.key
                      ? "border-brand-600 bg-brand-600 text-white"
                      : "border-ink-200 text-ink-600 hover:bg-ink-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label required>{period === "day" ? "תאריך" : "מתאריך"}</Label>
              <Input type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} />
            </div>
            {period === "custom" && (
              <div>
                <Label required>עד תאריך</Label>
                <Input type="date" value={customEnd} min={spentOn} onChange={(e) => setCustomEnd(e.target.value)} />
              </div>
            )}
            <div>
              <Label>איזה פרסום</Label>
              <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="input">
                <option value="">לא נבחר</option>
                {leadSources
                  .filter((l) => l.is_active)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label required>סכום (₪)</Label>
              <Input
                type="number"
                min={0}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="150"
              />
            </div>
          </div>
          {/* the whole point: what this actually costs per day, before saving */}
          {amount.trim() && (
            <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-3 text-sm">
              <p className="font-bold text-ink-900">
                {formatAgorot(shekelsToAgorot(amount))} על פני {days} ימים ={" "}
                <span className="text-brand-700">{formatAgorot(perDay)} ליום</span>
              </p>
              <p className="mt-0.5 text-xs text-ink-500">{describeRange(range.from, range.to)}</p>
              <p className="mt-1 text-xs text-ink-500">
                זה מה שיירד מהרווח בכל יום בתקופה — לא הכל ביום אחד.
              </p>
            </div>
          )}

          <div>
            <Label>הערה</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="קליקים / ממומן / קמפיין..." />
          </div>
          <Button onClick={add} loading={saving} disabled={!amount.trim()}>
            <Plus className="h-4 w-4" /> רישום ההוצאה
          </Button>
        </CardBody>
      </Card>

      {byChannel.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-brand-600" /> סך הכל לפי ערוץ — {monthLabel(month)}
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {byChannel.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <span className="font-semibold text-ink-700">{c.name}</span>
                <span className="font-extrabold text-ink-900">{formatAgorot(c.total)}</span>
              </div>
            ))}
            <div className="flex items-center justify-between border-t border-ink-100 pt-2 text-sm">
              <span className="font-bold text-ink-700">סך הכל</span>
              <span className="font-extrabold text-danger-600">{formatAgorot(total)}</span>
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>הוצאות {monthLabel(month)}</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-ink-400">טוען...</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">אין הוצאות פרסום ב{monthLabel(month)}</p>
          ) : (
            <div className="divide-y divide-ink-50">
              {rows.map((r) => (
                <div key={r.id} className="flex items-center gap-2 px-4 py-2.5">
                  {/* two lines rather than one long row: on a phone the channel,
                      the dates and a note cannot share a line and stay readable */}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink-800">
                      {sourceName(r.lead_source_id)}
                      {r.covers_to && r.covers_to !== r.spent_on && (
                        <span className="mr-1.5 text-xs font-normal text-brand-600">
                          {formatAgorot(Math.round(r.amount_agorot / daysInRange(r.spent_on, r.covers_to)))} ליום
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-ink-400">
                      {r.covers_to && r.covers_to !== r.spent_on ? `${r.spent_on} → ${r.covers_to}` : r.spent_on}
                      {r.notes ? ` · ${r.notes}` : ""}
                    </p>
                  </div>
                  <span className="shrink-0 font-extrabold text-ink-900">{formatAgorot(r.amount_agorot)}</span>
                  {canAttach && (
                    <ReceiptFiles
                      parent={{ kind: "ad", id: r.id }}
                      receipts={receipts.filter((x) => x.ad_spend_id === r.id)}
                      onChange={load}
                      open={askingFor === r.id ? true : undefined}
                      onOpenChange={(next) => {
                        if (!next && askingFor === r.id) setAskingFor(null);
                      }}
                    />
                  )}
                  <button
                    onClick={() => remove(r.id)}
                    className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-100 hover:text-danger-600"
                    aria-label="מחיקת ההוצאה"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <ConfirmDialog
        open={asking}
        title={`לשלוח לרואה החשבון את ${monthLabel(month)}?`}
        description={
          report?.sent_at
            ? `החודש הזה כבר נשלח ב-${formatDateTimeHe(report.sent_at)}. זו תהיה גרסה מעודכנת: ${rows.length} רישומים, ${formatAgorot(total)}.`
            : `יישלח מייל עם ${rows.length} רישומים, סך הכל ${formatAgorot(total)}, וקובץ מצורף שנפתח באקסל. עותק יישלח גם אליך.`
        }
        confirmLabel={report?.sent_at ? "שליחת גרסה מעודכנת" : "שליחה"}
        loading={sending}
        onConfirm={sendToAccountant}
        danger={false}
        onClose={() => setAsking(false)}
      />
    </div>
  );
}
