"use client";

import { useState } from "react";
import { Fuel, Plus, Trash2, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { ReceiptFiles } from "@/components/receipts/ReceiptFiles";
import { formatAgorot, shekelsToAgorot } from "@/lib/money";
import { formatDateHe, todayLocalDate } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { FUEL_CATEGORY } from "@/lib/accountant";
import type { BusinessExpense, ExpenseCategory, ExpenseReceipt } from "@/lib/types";

/**
 * A tank fill, logged where it happens.
 *
 * Fuel already appeared on every job, but that figure is an estimate worked out
 * from the distance and the price per litre — a fair guide to whether a job was
 * worth the drive, and nothing an accountant can deduct, because no receipt
 * stands behind it.
 *
 * This is the other thing: the actual fill, with the actual printed receipt.
 * It is a purchase like any other, so it goes in as one and travels to the
 * accountant with the month. Saving opens the camera straight away, because
 * this is filled in standing at the pump with the paper still in hand.
 */
export function FuelUpCard({
  categories,
  rows,
  receipts,
  fuelFromReceipts,
  onChange,
}: {
  categories: ExpenseCategory[];
  rows: BusinessExpense[];
  receipts: ExpenseReceipt[];
  fuelFromReceipts: boolean;
  onChange: () => void | Promise<void>;
}) {
  const supabase = createClient();
  const toast = useToast();

  const [amount, setAmount] = useState("");
  const [spentOn, setSpentOn] = useState(todayLocalDate());
  const [saving, setSaving] = useState(false);
  // the fill just logged, so the camera can open on it without another tap
  const [askingFor, setAskingFor] = useState<string | null>(null);

  const category = categories.find((c) => c.name === FUEL_CATEGORY);
  // the category arrives with a migration; until then the card stays out of the way
  if (!category) return null;

  const fills = rows.filter((r) => r.category_id === category.id);
  const agorot = shekelsToAgorot(amount || "0");

  async function add() {
    if (!Number.isFinite(agorot) || agorot <= 0) return toast.error("נא להזין סכום גדול מאפס");
    setSaving(true);
    const { data, error } = await supabase
      .from("business_expenses")
      .insert({
        category_id: category!.id,
        spent_on: spentOn,
        covers_to: spentOn,
        amount_agorot: agorot,
        notes: "תדלוק",
      })
      .select("id")
      .single();
    setSaving(false);
    if (error) return toast.error(errorMessage(error, "שגיאה בשמירת התדלוק"));
    setAmount("");
    await onChange();
    // ask for the paper while it is still in their hand
    setAskingFor((data as { id: string }).id);
  }

  async function remove(id: string) {
    const { error } = await supabase.from("business_expenses").delete().eq("id", id);
    if (error) return toast.error(errorMessage(error, "שגיאה במחיקה"));
    await onChange();
    toast.success("התדלוק נמחק");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fuel className="h-5 w-5 text-ink-400" /> תדלוק
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-500">
          הקבלה מתחנת הדלק. זו ההוצאה שרואה החשבון יכול להכיר בה, והיא נשלחת אליו בסוף החודש
          יחד עם התמונה.
        </p>

        {!fuelFromReceipts && (
          <Link
            href="/settings/vehicle"
            className="flex items-start gap-2 rounded-xl bg-warning-50 px-3.5 py-3 text-xs font-semibold text-warning-700 hover:bg-warning-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              המערכת עדיין מחשבת דלק לבד לפי הקילומטרים בכל עבודה. אם תרשמו כאן תדלוקים בלי
              לכבות את זה, אותו דלק יירד מהרווח פעמיים. להגדרות הרכב ←
            </span>
          </Link>
        )}

        {fills.length > 0 && (
          <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
            {fills.map((row) => {
              const mine = receipts.filter((x) => x.business_expense_id === row.id);
              return (
                <div key={row.id} className="flex items-center gap-2 px-3.5 py-2.5">
                  <span className="w-24 shrink-0 text-xs font-bold text-ink-400">
                    {formatDateHe(row.spent_on)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-ink-400">
                    {mine.length === 0 ? "לא צורפה תמונה" : ""}
                  </span>
                  <span className="shrink-0 text-sm font-bold text-ink-900">
                    {formatAgorot(row.amount_agorot)}
                  </span>
                  <ReceiptFiles
                    parent={{ kind: "expense", id: row.id }}
                    receipts={mine}
                    onChange={onChange}
                    open={askingFor === row.id ? true : undefined}
                    onOpenChange={(next) => {
                      if (!next && askingFor === row.id) setAskingFor(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => remove(row.id)}
                    className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-danger-600"
                    aria-label={`מחיקת התדלוק מ-${formatDateHe(row.spent_on)}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-[7rem] flex-1">
            <Label htmlFor="fuel-amount" required>
              כמה שילמתם (₪)
            </Label>
            <Input
              id="fuel-amount"
              type="number"
              min={0}
              step={10}
              inputMode="decimal"
              dir="ltr"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="₪"
              onKeyDown={(e) => e.key === "Enter" && add()}
            />
          </div>
          <div className="min-w-[9rem] flex-1">
            <Label htmlFor="fuel-date">תאריך</Label>
            <Input
              id="fuel-date"
              type="date"
              value={spentOn}
              onChange={(e) => setSpentOn(e.target.value)}
            />
          </div>
          <Button onClick={add} loading={saving} disabled={!(agorot > 0)}>
            <Plus className="h-4 w-4" /> שמירה וצילום
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
