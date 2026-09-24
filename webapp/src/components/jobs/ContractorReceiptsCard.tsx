"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { HardHat, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { ReceiptFiles } from "@/components/receipts/ReceiptFiles";
import { formatAgorot, shekelsToAgorot, agorotToShekels } from "@/lib/money";
import { formatDateHe, todayLocalDate } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import {
  listContractorReceipts,
  listContractorReceiptFiles,
  createContractorReceipt,
  deleteContractorReceipt,
} from "@/lib/api/contractorReceipts";
import type { ContractorReceipt, ExpenseReceipt } from "@/lib/types";

/**
 * The receipt the contractor handed over for this job.
 *
 * The system has always known what the contractor's share was; what it never
 * held was the paper behind it, and without the paper an accountant cannot
 * deduct the payment — so the share was money that left the business and could
 * not be proven.
 *
 * It is filed here rather than on the expenses screen because this is where the
 * paper changes hands, and the only place the contractor, the job and the
 * amount are all already known. The amount is filled in from the share this
 * job worked out, so the common case needs no arithmetic; it stays editable,
 * because what the contractor invoiced is their figure, not ours.
 *
 * Nothing here is subtracted from the profit. The share already is.
 */
export function ContractorReceiptsCard({
  jobId,
  contractorId,
  contractorName,
  shareAgorot,
  closedAt,
}: {
  jobId: string;
  contractorId: string | null;
  contractorName: string | null;
  /** the contractor's cut of this job, as the closing worked it out */
  shareAgorot: number | null;
  closedAt: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();

  const [rows, setRows] = useState<ContractorReceipt[]>([]);
  const [files, setFiles] = useState<ExpenseReceipt[]>([]);
  // the table arrives with a migration; until then the card stays out of the way
  const [supported, setSupported] = useState(true);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  // the row whose file dialog should open — set the moment a receipt is
  // recorded, because the person is holding the paper right then
  const [askingFor, setAskingFor] = useState<string | null>(null);

  const [name, setName] = useState(contractorName ?? "");
  const [amount, setAmount] = useState(shareAgorot ? String(agorotToShekels(shareAgorot)) : "");
  const [issuedOn, setIssuedOn] = useState(closedAt ? closedAt.slice(0, 10) : todayLocalDate());
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    try {
      const list = await listContractorReceipts(supabase, jobId);
      setRows(list);
      setFiles(await listContractorReceiptFiles(supabase, list.map((r) => r.id)).catch(() => []));
    } catch {
      setSupported(false);
    }
  }, [supabase, jobId]);

  useEffect(() => {
    load();
  }, [load]);

  const agorot = shekelsToAgorot(amount);
  const canSave = !!name.trim() && agorot > 0 && !!issuedOn;

  async function add() {
    if (!canSave) return;
    setSaving(true);
    try {
      const created = await createContractorReceipt(supabase, {
        job_id: jobId,
        // the name is stored on the row too, so it survives a rename
        contractor_id: name.trim() === (contractorName ?? "").trim() ? contractorId : null,
        contractor_name: name.trim(),
        amount_agorot: agorot,
        issued_on: issuedOn,
        reference: reference.trim() || null,
      });
      setReference("");
      setAdding(false);
      await load();
      // ask for the paper while it is still in their hand
      setAskingFor(created.id);
    } catch (e) {
      toast.error(errorMessage(e, "שגיאה בשמירת הקבלה"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(row: ContractorReceipt) {
    try {
      await deleteContractorReceipt(supabase, row.id);
      await load();
      toast.success("הקבלה נמחקה");
    } catch (e) {
      toast.error(errorMessage(e, "שגיאה במחיקת הקבלה"));
    }
  }

  if (!supported) return null;

  const total = rows.reduce((sum, r) => sum + r.amount_agorot, 0);
  const missingPaper = rows.filter((r) => !files.some((f) => f.contractor_receipt_id === r.id)).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <HardHat className="h-5 w-5 text-ink-400" /> קבלות מקבלנים
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-500">
          הקבלה שהקבלן נתן לכם על העבודה הזו. הסכום כבר ירד מהרווח לפי אחוז הקבלן — הקבלה עצמה
          היא ההוכחה בשביל רואה החשבון, והיא נשלחת אליו בסוף החודש יחד עם שאר הקבלות וההוצאות.
        </p>

        {rows.length > 0 && (
          <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
            {rows.map((row) => {
              const mine = files.filter((f) => f.contractor_receipt_id === row.id);
              return (
                <div key={row.id} className="flex items-center gap-2 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink-800">{row.contractor_name}</p>
                    <p className="truncate text-xs text-ink-400">
                      {formatDateHe(row.issued_on)}
                      {row.reference ? ` · קבלה ${row.reference}` : ""}
                      {mine.length === 0 ? " · לא צורפה תמונה" : ""}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-bold text-ink-900">{formatAgorot(row.amount_agorot)}</span>
                  <ReceiptFiles
                    parent={{ kind: "contractor", id: row.id }}
                    receipts={mine}
                    onChange={load}
                    open={askingFor === row.id ? true : undefined}
                    onOpenChange={(next) => {
                      if (!next && askingFor === row.id) setAskingFor(null);
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => remove(row)}
                    className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-danger-600"
                    aria-label={`מחיקת הקבלה מ${row.contractor_name}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-ink-50 px-3.5 py-2.5">
              <span className="text-sm font-extrabold text-ink-900">סה״כ קבלות מקבלנים</span>
              <span className="text-sm font-extrabold text-ink-900">{formatAgorot(total)}</span>
            </div>
          </div>
        )}

        {missingPaper > 0 && (
          <p className="rounded-xl bg-warning-50 px-3.5 py-2.5 text-xs font-semibold text-warning-700">
            {missingPaper === 1
              ? "לקבלה אחת עדיין לא צורפה תמונה — בלי התמונה רואה החשבון לא יכול להכיר בהוצאה."
              : `ל-${missingPaper} קבלות עדיין לא צורפה תמונה — בלי התמונה רואה החשבון לא יכול להכיר בהוצאה.`}
          </p>
        )}

        {adding ? (
          <div className="space-y-3 rounded-2xl border border-ink-100 bg-ink-50/60 p-3.5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="cr-name" required>
                  שם הקבלן
                </Label>
                <Input
                  id="cr-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="למשל: איברהים ביובית"
                />
              </div>
              <div>
                <Label htmlFor="cr-amount" required>
                  הסכום בקבלה (₪)
                </Label>
                <Input
                  id="cr-amount"
                  type="number"
                  min={0}
                  step={10}
                  inputMode="decimal"
                  dir="ltr"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="₪"
                />
                {!!shareAgorot && (
                  <p className="mt-1 text-xs text-ink-400">
                    חלק הקבלן בעבודה הזו: {formatAgorot(shareAgorot)}
                  </p>
                )}
              </div>
              <div>
                <Label htmlFor="cr-date" required>
                  התאריך שעל הקבלה
                </Label>
                <Input
                  id="cr-date"
                  type="date"
                  value={issuedOn}
                  onChange={(e) => setIssuedOn(e.target.value)}
                />
                <p className="mt-1 text-xs text-ink-400">לפי התאריך הזה הקבלה נכנסת לדוח החודשי</p>
              </div>
              <div>
                <Label htmlFor="cr-ref">מספר הקבלה שלו</Label>
                <Input
                  id="cr-ref"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="לא חייב"
                  dir="ltr"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={add} loading={saving} disabled={!canSave} className="flex-1">
                שמירה וצילום הקבלה
              </Button>
              <Button variant="secondary" onClick={() => setAdding(false)}>
                ביטול
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setAdding(true)} className="w-full">
            <Plus className="h-4 w-4" /> הוספת קבלה מקבלן
          </Button>
        )}
      </CardBody>
    </Card>
  );
}
