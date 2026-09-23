"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Wallet, Plus, Trash2, Check } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { formatAgorot, shekelsToAgorot } from "@/lib/money";
import { todayLocalDate } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { SPEND_PERIODS, periodRange, daysInRange, describeRange, monthlyInstalments, type SpendPeriod } from "@/lib/adPeriods";
import type { BusinessExpense, ExpenseCategory, ExpenseReceipt } from "@/lib/types";
import { ExpenseReceipts } from "@/components/expenses/ExpenseReceipts";
import { listExpenseReceipts } from "@/lib/api/expenseReceipts";

export default function ExpensesPage() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();

  const [categories, setCategories] = useState<ExpenseCategory[]>([]);
  const [rows, setRows] = useState<BusinessExpense[]>([]);
  const [receipts, setReceipts] = useState<ExpenseReceipt[]>([]);
  const [loading, setLoading] = useState(true);

  const [period, setPeriod] = useState<SpendPeriod>("month");
  const [spentOn, setSpentOn] = useState(todayLocalDate());
  const [customEnd, setCustomEnd] = useState(todayLocalDate());
  const [categoryId, setCategoryId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // a yearly bill is felt monthly, and that is how the business wants to read it
  const [splitMonthly, setSplitMonthly] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [cat, exp] = await Promise.all([
      supabase.from("expense_categories").select("*").order("sort_order"),
      supabase.from("business_expenses").select("*").order("spent_on", { ascending: false }).limit(120),
    ]);
    setCategories((cat.data as ExpenseCategory[]) ?? []);
    const expenses = (exp.data as BusinessExpense[]) ?? [];
    setRows(expenses);
    // the photographs are fetched for the whole page at once rather than per row
    setReceipts(await listExpenseReceipts(supabase, expenses.map((e) => e.id)).catch(() => []));
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  const range = periodRange(period, spentOn, customEnd);
  const days = daysInRange(range.from, range.to);
  const perDay = amount.trim() ? Math.round(shekelsToAgorot(amount) / days) : 0;
  const asMonths = period === "year" && splitMonthly;
  const perMonth = amount.trim() ? Math.round(shekelsToAgorot(amount) / 12) : 0;
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "אחר";

  async function add() {
    const agorot = shekelsToAgorot(amount || "0");
    if (!Number.isFinite(agorot) || agorot <= 0) return toast.error("נא להזין סכום גדול מאפס");
    setSaving(true);

    const shared = {
      category_id: categoryId || null,
      notes: notes.trim() || null,
    };
    const payload = asMonths
      ? (() => {
          // one group, twelve rows, so the year can be read and removed as one
          const groupId = crypto.randomUUID();
          return monthlyInstalments(agorot, new Date(range.from + "T00:00:00").getFullYear()).map((m) => ({
            ...shared,
            group_id: groupId,
            spent_on: m.from,
            covers_to: m.to,
            amount_agorot: m.amount_agorot,
          }));
        })()
      : [{ ...shared, spent_on: range.from, covers_to: range.to, amount_agorot: agorot }];

    const { error } = await supabase.from("business_expenses").insert(payload);
    setSaving(false);
    if (error) return toast.error(errorMessage(error, "שגיאה בשמירת ההוצאה"));
    setAmount("");
    setNotes("");
    await load();
    toast.success(asMonths ? "ההוצאה נרשמה ונפרסה על 12 חודשים" : "ההוצאה נרשמה");
  }

  async function removeGroup(groupId: string) {
    await supabase.from("business_expenses").delete().eq("group_id", groupId);
    await load();
    toast.success("ההוצאה השנתית נמחקה מכל החודשים");
  }

  async function remove(id: string) {
    await supabase.from("business_expenses").delete().eq("id", id);
    await load();
    toast.success("ההוצאה נמחקה");
  }

  // twelve rows of one yearly bill read as one line; everything else stands alone
  const listed: { key: string; group: BusinessExpense[] }[] = [];
  const seenGroups = new Set<string>();
  for (const row of rows) {
    const gid = row.group_id;
    if (!gid) {
      listed.push({ key: row.id, group: [row] });
      continue;
    }
    if (seenGroups.has(gid)) continue;
    seenGroups.add(gid);
    listed.push({
      key: gid,
      group: rows.filter((r) => r.group_id === gid),
    });
  }

  const byCategory = categories
    .map((c) => ({
      name: c.name,
      total: rows.filter((r) => r.category_id === c.id).reduce((s, r) => s + r.amount_agorot, 0),
    }))
    .filter((c) => c.total > 0)
    .sort((a, b) => b.total - a.total);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">הוצאות קבועות</h1>
        <p className="text-sm text-ink-500">
          רואה חשבון, ביטוח, שכירות, ציוד וכל מה שלא שייך לעבודה מסוימת — נפרס על ימי התקופה ויורד
          מהרווח. אפשר לצלם את הקבלה בכפתור המצלמה שליד כל שורה, והיא תישלח לרואה החשבון עם הדוח החודשי.
        </p>
      </div>

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
            <Label required>לאיזו תקופה</Label>
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
            {period === "year" && (
              <button
                type="button"
                onClick={() => setSplitMonthly((v) => !v)}
                className={`mt-2 flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-right transition ${
                  splitMonthly ? "border-brand-200 bg-brand-50/60" : "border-ink-200 hover:bg-ink-50"
                }`}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    splitMonthly ? "border-brand-600 bg-brand-600 text-white" : "border-ink-300"
                  }`}
                >
                  {splitMonthly && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-bold text-ink-900">לחלק ל-12 תשלומים חודשיים</span>
                  <span className="block text-xs text-ink-500">
                    למשל שכר טרחה שנתי לרואה חשבון — כל חודש יישא בדיוק שתים־עשרה ממנו
                  </span>
                </span>
              </button>
            )}
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
              <Label required>סוג ההוצאה</Label>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="input">
                <option value="">בחרו...</option>
                {categories
                  .filter((c) => c.is_active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
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
                placeholder="600"
              />
            </div>
          </div>

          {amount.trim() && (
            <div className="rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-3 text-sm">
              {asMonths ? (
                <>
                  <p className="font-bold text-ink-900">
                    {formatAgorot(shekelsToAgorot(amount))} לשנה ={" "}
                    <span className="text-brand-700">{formatAgorot(perMonth)} לחודש</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    12 רישומים, אחד לכל חודש של {new Date(range.from + "T00:00:00").getFullYear()}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-bold text-ink-900">
                    {formatAgorot(shekelsToAgorot(amount))} על פני {days} ימים ={" "}
                    <span className="text-brand-700">{formatAgorot(perDay)} ליום</span>
                  </p>
                  <p className="mt-0.5 text-xs text-ink-500">{describeRange(range.from, range.to)}</p>
                </>
              )}
            </div>
          )}

          <div>
            <Label>הערה</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="למשל: שכר טרחה חודשי" />
          </div>

          <Button onClick={add} loading={saving} disabled={!amount.trim()}>
            <Plus className="h-4 w-4" /> רישום ההוצאה
          </Button>
        </CardBody>
      </Card>

      {byCategory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-brand-600" /> סך הכל לפי סוג
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-2">
            {byCategory.map((c) => (
              <div key={c.name} className="flex items-center justify-between text-sm">
                <span className="font-semibold text-ink-700">{c.name}</span>
                <span className="font-extrabold text-ink-900">{formatAgorot(c.total)}</span>
              </div>
            ))}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>הוצאות אחרונות</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-ink-400">טוען...</p>
          ) : rows.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">עדיין לא נרשמו הוצאות</p>
          ) : (
            <div className="divide-y divide-ink-50">
              {listed.map(({ key, group }) => {
                const yearly = group.length > 1;
                const r = group[0];
                const total = group.reduce((sum, x) => sum + x.amount_agorot, 0);
                const gid = r.group_id;
                // rows arrive newest first, so the earliest month is last
                const receiptHolder = group[group.length - 1];
                return (
                  <div key={key} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="w-28 shrink-0 text-xs font-bold text-ink-400">
                      {yearly
                        ? `שנתי ${new Date(r.spent_on + "T00:00:00").getFullYear()}`
                        : r.covers_to && r.covers_to !== r.spent_on
                          ? `${r.spent_on} → ${r.covers_to}`
                          : r.spent_on}
                    </span>
                    <span className="flex-1 text-sm font-semibold text-ink-800">
                      {catName(r.category_id)}
                      {yearly ? (
                        <span className="mr-1.5 text-xs font-normal text-brand-600">
                          {formatAgorot(Math.round(total / 12))} לחודש · {group.length} חודשים
                        </span>
                      ) : (
                        r.covers_to &&
                        r.covers_to !== r.spent_on && (
                          <span className="mr-1.5 text-xs font-normal text-brand-600">
                            {formatAgorot(Math.round(r.amount_agorot / daysInRange(r.spent_on, r.covers_to)))} ליום
                          </span>
                        )
                      )}
                      {r.notes && <span className="mr-1.5 text-xs font-normal text-ink-400">{r.notes}</span>}
                    </span>
                    <span className="font-extrabold text-ink-900">{formatAgorot(total)}</span>
                    <ExpenseReceipts
                      /* a yearly bill is paid once, so its receipt belongs to the
                         first of its twelve months — not to whichever one the
                         list happens to show first */
                      expenseId={receiptHolder.id}
                      receipts={receipts.filter((x) => x.business_expense_id === receiptHolder.id)}
                      onChange={load}
                    />
                    <button
                      onClick={() => (yearly && gid ? removeGroup(gid) : remove(r.id))}
                      className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-100 hover:text-danger-600"
                      aria-label={yearly ? "מחיקת ההוצאה השנתית" : "מחיקת ההוצאה"}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
