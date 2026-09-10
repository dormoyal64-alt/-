"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { useRefData } from "@/lib/refdata";
import { previewCommission } from "@/lib/calc";
import { formatAgorot, shekelsToAgorot } from "@/lib/money";
import type { JobWithRelations } from "@/lib/types";

export function CloseJobModal({
  open,
  onClose,
  job,
  onSubmit,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  job: JobWithRelations;
  onSubmit: (input: {
    closedSuccessfully: boolean;
    finalPriceAgorot: number;
    finalPaymentMethodId: string | null;
    paymentReceivedBy: "contractor" | "business";
    closingNotes: string | null;
    closedAt: string;
    commissionPct: number;
  }) => Promise<void>;
  loading?: boolean;
}) {
  const { paymentMethods } = useRefData();
  const [closedSuccessfully, setClosedSuccessfully] = useState(true);
  const [finalPrice, setFinalPrice] = useState(
    job.quoted_price_agorot ? String(job.quoted_price_agorot / 100) : ""
  );
  const [finalPaymentMethodId, setFinalPaymentMethodId] = useState(job.payment_method_id ?? "");
  const [paymentReceivedBy, setPaymentReceivedBy] = useState<"contractor" | "business">("contractor");
  const [closingNotes, setClosingNotes] = useState("");

  // the job's usual split, and the one being applied to this closing
  const defaultPct = job.commission_pct ?? 0;
  const [commissionPct, setCommissionPct] = useState<string>(String(defaultPct));

  const parsedPct = parseFloat(commissionPct);
  const pctValid = !isNaN(parsedPct) && parsedPct >= 0 && parsedPct <= 100;
  const effectivePct = pctValid ? parsedPct : 0;
  const pctChanged = pctValid && Math.abs(effectivePct - defaultPct) > 0.001;

  const finalPriceAgorot = finalPrice ? shekelsToAgorot(finalPrice) : 0;
  const preview = useMemo(
    () => previewCommission(finalPriceAgorot, effectivePct, paymentReceivedBy),
    [finalPriceAgorot, effectivePct, paymentReceivedBy]
  );

  async function handleSubmit() {
    await onSubmit({
      closedSuccessfully,
      finalPriceAgorot: closedSuccessfully ? finalPriceAgorot : 0,
      finalPaymentMethodId: closedSuccessfully ? finalPaymentMethodId || null : null,
      paymentReceivedBy,
      closingNotes: closingNotes || null,
      closedAt: new Date().toISOString(),
      commissionPct: effectivePct,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title="סגירת עבודה" size="md">
      <div className="space-y-4">
        <div>
          <Label required>האם העבודה נסגרה?</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setClosedSuccessfully(true)}
              className={`rounded-xl border py-3 text-sm font-bold ${
                closedSuccessfully ? "border-success-500 bg-success-50 text-success-700" : "border-ink-200 text-ink-500"
              }`}
            >
              נסגרה בהצלחה
            </button>
            <button
              type="button"
              onClick={() => setClosedSuccessfully(false)}
              className={`rounded-xl border py-3 text-sm font-bold ${
                !closedSuccessfully ? "border-danger-500 bg-danger-50 text-danger-700" : "border-ink-200 text-ink-500"
              }`}
            >
              לא נסגרה
            </button>
          </div>
        </div>

        {closedSuccessfully && (
          <>
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-ink-200 bg-ink-50 px-3.5 py-2.5 text-sm text-ink-500">
              <span>מחיר שנאמר ללקוח בטלפון</span>
              <span className="font-bold text-ink-700">
                {job.quoted_price_agorot ? formatAgorot(job.quoted_price_agorot) : "לא נרשם"}
              </span>
            </div>
            <div>
              <Label required>כמה העבודה נסגרה בפועל? (₪)</Label>
              <Input
                type="number"
                min={0}
                step={1}
                value={finalPrice}
                onChange={(e) => setFinalPrice(e.target.value)}
                placeholder="הקלידו את הסכום הסופי"
                inputMode="decimal"
                className="border-2 border-brand-500 py-3.5 text-center text-2xl font-extrabold"
              />
              {job.quoted_price_agorot && finalPriceAgorot > 0 && finalPriceAgorot !== job.quoted_price_agorot ? (
                <p
                  className={`mt-1.5 text-center text-xs font-bold ${
                    finalPriceAgorot > job.quoted_price_agorot ? "text-success-600" : "text-warning-600"
                  }`}
                >
                  {finalPriceAgorot > job.quoted_price_agorot ? "▲ גבוה ב-" : "▼ נמוך ב-"}
                  {formatAgorot(Math.abs(finalPriceAgorot - job.quoted_price_agorot))} מהמחיר בטלפון
                </p>
              ) : (
                <p className="mt-1.5 text-center text-xs text-ink-400">
                  אפשר לשנות — החישוב מתעדכן מיד לפי הסכום שתקלידו
                </p>
              )}
              {job.quoted_price_agorot != null && finalPriceAgorot !== job.quoted_price_agorot && (
                <button
                  type="button"
                  onClick={() => setFinalPrice(String(job.quoted_price_agorot! / 100))}
                  className="btn-secondary mt-2 w-full py-2 text-xs"
                >
                  השתמש במחיר מהטלפון ({formatAgorot(job.quoted_price_agorot)})
                </button>
              )}
            </div>
            <div>
              <Label>אמצעי תשלום סופי</Label>
              <select value={finalPaymentMethodId} onChange={(e) => setFinalPaymentMethodId(e.target.value)} className="input">
                <option value="">לא נבחר</option>
                {paymentMethods
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <Label required>חלוקה בינך לבין הקבלן</Label>
              <div className="rounded-2xl border border-ink-200 p-3.5">
                <div className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span className="font-bold text-ink-700">הקבלן</span>
                      <span className="font-bold text-ink-400">אני</span>
                    </div>
                    <div className="flex h-2.5 overflow-hidden rounded-full bg-ink-100">
                      <div className="bg-brand-500 transition-all" style={{ width: `${Math.min(Math.max(effectivePct, 0), 100)}%` }} />
                      <div className="flex-1 bg-success-500 transition-all" />
                    </div>
                    <div className="mt-1 flex items-baseline justify-between text-sm font-extrabold">
                      <span className="text-brand-700">{effectivePct}%</span>
                      <span className="text-success-700">{Math.round((100 - effectivePct) * 100) / 100}%</span>
                    </div>
                  </div>
                  <div className="w-24 shrink-0">
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      value={commissionPct}
                      onChange={(e) => setCommissionPct(e.target.value)}
                      className="py-2 text-center text-lg font-extrabold"
                      aria-label="אחוז הקבלן"
                    />
                  </div>
                </div>

                {!pctValid && <p className="mt-2 text-xs font-bold text-danger-600">יש להזין אחוז בין 0 ל-100</p>}

                {pctChanged && pctValid && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-2.5">
                    <span className="text-xs font-semibold text-warning-600">
                      אחוז מותאם לעבודה זו (הרגיל: {defaultPct}%)
                    </span>
                    <button
                      type="button"
                      onClick={() => setCommissionPct(String(defaultPct))}
                      className="btn-secondary px-2.5 py-1 text-xs"
                    >
                      חזרה ל-{defaultPct}%
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div>
              <Label required>מי קיבל את התשלום?</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setPaymentReceivedBy("contractor")}
                  className={`rounded-xl border py-3 text-sm font-bold ${
                    paymentReceivedBy === "contractor" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-500"
                  }`}
                >
                  הקבלן
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentReceivedBy("business")}
                  className={`rounded-xl border py-3 text-sm font-bold ${
                    paymentReceivedBy === "business" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-500"
                  }`}
                >
                  העסק / אני
                </button>
              </div>
            </div>

            {finalPriceAgorot > 0 && (
              <div className="space-y-1.5 rounded-2xl bg-ink-50 p-4 text-sm">
                <Row label={`חלק הקבלן (${effectivePct}%)`} value={formatAgorot(preview.contractorShareAgorot)} />
                <Row label="החלק שלי" value={formatAgorot(preview.businessShareAgorot)} />
                {preview.contractorOwesBusinessAgorot > 0 && (
                  <Row label="הקבלן צריך להעביר לי" value={formatAgorot(preview.contractorOwesBusinessAgorot)} bold />
                )}
                {preview.businessOwesContractorAgorot > 0 && (
                  <Row label="אני צריך להעביר לקבלן" value={formatAgorot(preview.businessOwesContractorAgorot)} bold />
                )}
              </div>
            )}
          </>
        )}

        <div>
          <Label>הערות לסגירה</Label>
          <Textarea value={closingNotes} onChange={(e) => setClosingNotes(e.target.value)} placeholder="פרטים נוספים..." />
        </div>

        <Button
          fullWidth
          size="lg"
          onClick={handleSubmit}
          loading={loading}
          disabled={closedSuccessfully && (finalPriceAgorot <= 0 || !pctValid)}
        >
          אישור סגירת עבודה
        </Button>
      </div>
    </Modal>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className={bold ? "font-extrabold text-ink-900" : "font-semibold text-ink-700"}>{value}</span>
    </div>
  );
}
