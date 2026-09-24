"use client";

import { useMemo, useState } from "react";
import { Receipt as ReceiptIcon } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { useRefData } from "@/lib/refdata";
import { HelperSelect } from "@/components/jobs/HelperSelect";
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
    referralPct: number | null;
    issueReceipt: boolean;
    withReceipt: boolean;
    setHelper: boolean;
    helperId: string | null;
    helperPayAgorot: number | null;
  }) => Promise<void>;
  loading?: boolean;
}) {
  const { paymentMethods, helpers, settings, isOwner } = useRefData();
  const [closedSuccessfully, setClosedSuccessfully] = useState(true);
  const [finalPrice, setFinalPrice] = useState(
    job.quoted_price_agorot ? String(job.quoted_price_agorot / 100) : ""
  );
  const [finalPaymentMethodId, setFinalPaymentMethodId] = useState(job.payment_method_id ?? "");
  const [paymentReceivedBy, setPaymentReceivedBy] = useState<"contractor" | "business">("contractor");
  const [closingNotes, setClosingNotes] = useState("");
  // starts from the standing preference in settings, changeable per closing
  const [issueReceipt, setIssueReceipt] = useState(settings?.auto_receipt ?? false);
  // whether this job was declared. Issuing a receipt implies it, but a job can
  // be declared without the system printing anything.
  const [withReceipt, setWithReceipt] = useState(settings?.auto_receipt ?? false);

  // What the worker was actually paid on this job. A worker of ours only goes
  // out on a job we do ourselves, and the figures are the owner's, so nobody
  // else is asked. It starts from whatever the job already carries — the
  // standing rate, filled in when the job was opened — and is corrected here,
  // where the real number is finally known.
  const asksAboutHelper = job.performed_by === "self" && isOwner;
  const [helperId, setHelperId] = useState(job.helper_id ?? "");
  const [helperPay, setHelperPay] = useState(
    job.helper_pay_agorot ? String(job.helper_pay_agorot / 100) : ""
  );
  const helperPayAgorot = helperPay.trim() ? shekelsToAgorot(helperPay) : 0;

  /** Picking a worker offers their usual rate, unless a figure is already in. */
  function chooseHelper(id: string, created?: { default_pay_agorot: number | null }) {
    setHelperId(id);
    if (helperPay.trim()) return;
    const rate = created?.default_pay_agorot ?? helpers.find((h) => h.id === id)?.default_pay_agorot;
    if (rate) setHelperPay(String(rate / 100));
  }

  // the job's usual split, and the one being applied to this closing
  const defaultPct = job.commission_pct ?? 0;
  const [commissionPct, setCommissionPct] = useState<string>(String(defaultPct));

  // the referring company's cut, if this job came from one
  const hasCompany = !!job.referral_company_id;
  const defaultReferralPct = job.referral_pct ?? 0;
  const [referralPct, setReferralPct] = useState<string>(String(defaultReferralPct));
  const parsedReferral = parseFloat(referralPct);
  const referralValid = !hasCompany || (!isNaN(parsedReferral) && parsedReferral >= 0 && parsedReferral <= 100);
  const effectiveReferralPct = hasCompany && referralValid ? parsedReferral : 0;
  const referralChanged =
    hasCompany && referralValid && Math.abs(effectiveReferralPct - defaultReferralPct) > 0.001;

  const parsedPct = parseFloat(commissionPct);
  const pctValid = !isNaN(parsedPct) && parsedPct >= 0 && parsedPct <= 100;
  const effectivePct = pctValid ? parsedPct : 0;
  const pctChanged = pctValid && Math.abs(effectivePct - defaultPct) > 0.001;

  const finalPriceAgorot = finalPrice ? shekelsToAgorot(finalPrice) : 0;
  const referralFeeAgorot = Math.round((finalPriceAgorot * effectiveReferralPct) / 100);
  const contractorFeeAgorot = Math.round((finalPriceAgorot * effectivePct) / 100);
  // both percentages come off the full price, so together they cannot pass 100%
  const splitTooBig = effectivePct + effectiveReferralPct > 100;
  const taxRate = settings?.tax_rate_pct ?? 18;
  const includesTax = settings?.prices_include_tax ?? true;
  const taxAgorot = withReceipt && finalPriceAgorot > 0
    ? Math.round(includesTax
        ? (finalPriceAgorot * taxRate) / (100 + taxRate)
        : (finalPriceAgorot * taxRate) / 100)
    : 0;
  const helperCost = asksAboutHelper ? helperPayAgorot : 0;
  const myShare = finalPriceAgorot - referralFeeAgorot - contractorFeeAgorot - taxAgorot - helperCost;
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
      referralPct: hasCompany ? effectiveReferralPct : null,
      issueReceipt: closedSuccessfully && issueReceipt,
      withReceipt: closedSuccessfully && withReceipt,
      setHelper: asksAboutHelper,
      helperId: helperId || null,
      helperPayAgorot: helperPayAgorot,
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
            {isOwner && (
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
            )}

            {isOwner && hasCompany && (
              <div>
                <Label required>העבודה הגיעה מ{job.referral_company?.name ?? "חברה"}</Label>
                <div className="rounded-2xl border border-ink-200 p-3.5">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <p className="text-xs font-bold text-ink-400">כמה החברה לוקחת מהעבודה הזו</p>
                      <p className="mt-1 text-lg font-extrabold text-brand-700">
                        {formatAgorot(referralFeeAgorot)}
                      </p>
                    </div>
                    <div className="w-24 shrink-0">
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        step={1}
                        value={referralPct}
                        onChange={(e) => setReferralPct(e.target.value)}
                        className="py-2 text-center text-lg font-extrabold"
                        aria-label="אחוז החברה"
                      />
                    </div>
                  </div>

                  {!referralValid && (
                    <p className="mt-2 text-xs font-bold text-danger-600">יש להזין אחוז בין 0 ל-100</p>
                  )}

                  {referralChanged && (
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 pt-2.5">
                      <span className="text-xs font-semibold text-warning-600">
                        אחוז מותאם לעבודה זו (הרגיל: {defaultReferralPct}%)
                      </span>
                      <button
                        type="button"
                        onClick={() => setReferralPct(String(defaultReferralPct))}
                        className="btn-secondary px-2.5 py-1 text-xs"
                      >
                        חזרה ל-{defaultReferralPct}%
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {asksAboutHelper && (
              <div className="space-y-2 rounded-2xl border border-ink-100 p-3.5">
                <HelperSelect value={helperId} onChange={chooseHelper} />
                {helperId && (
                  <div>
                    <Label htmlFor="close-helper-pay">כמה שילמתם לו על העבודה הזו? (₪)</Label>
                    <Input
                      id="close-helper-pay"
                      type="number"
                      min={0}
                      step={10}
                      inputMode="decimal"
                      dir="ltr"
                      value={helperPay}
                      onChange={(e) => setHelperPay(e.target.value)}
                      placeholder="₪"
                    />
                    <p className="mt-1 text-xs text-ink-400">
                      יורד מהרווח של העבודה ומכל הסיכומים. לא נשלח לרואה החשבון.
                    </p>
                  </div>
                )}
              </div>
            )}

            {isOwner && finalPriceAgorot > 0 && (
              <div className="rounded-2xl bg-ink-50 p-3.5 text-sm">
                <p className="mb-1.5 text-xs font-bold text-ink-400">איך מתחלק הכסף</p>
                <div className="flex justify-between py-0.5">
                  <span className="text-ink-500">מחיר העבודה</span>
                  <span className="font-bold">{formatAgorot(finalPriceAgorot)}</span>
                </div>
                {hasCompany && (
                  <div className="flex justify-between py-0.5">
                    <span className="text-ink-500">
                      {job.referral_company?.name} ({effectiveReferralPct}%)
                    </span>
                    <span className="font-bold text-danger-600">-{formatAgorot(referralFeeAgorot)}</span>
                  </div>
                )}
                {job.performed_by !== "self" && (
                  <div className="flex justify-between py-0.5">
                    <span className="text-ink-500">
                      {job.contractor?.name ?? "הקבלן"} ({effectivePct}%)
                    </span>
                    <span className="font-bold text-danger-600">-{formatAgorot(contractorFeeAgorot)}</span>
                  </div>
                )}
                {helperCost > 0 && (
                  <div className="flex justify-between py-0.5">
                    <span className="text-ink-500">
                      {helpers.find((h) => h.id === helperId)?.name ?? "עובד"}
                    </span>
                    <span className="font-bold text-danger-600">-{formatAgorot(helperCost)}</span>
                  </div>
                )}
                {taxAgorot > 0 && (
                  <div className="flex justify-between py-0.5">
                    <span className="text-ink-500">מס ({taxRate}%)</span>
                    <span className="font-bold text-danger-600">-{formatAgorot(taxAgorot)}</span>
                  </div>
                )}
                <div className="mt-1 flex justify-between border-t border-ink-200 pt-1.5">
                  <span className="font-bold text-ink-700">נשאר לי</span>
                  <span className="font-extrabold text-success-700">{formatAgorot(myShare)}</span>
                </div>
                {splitTooBig && (
                  <p className="mt-2 text-xs font-bold text-danger-600">
                    האחוזים יחד ({effectiveReferralPct}% + {effectivePct}%) עולים על 100% — לא ניתן לסגור
                  </p>
                )}
              </div>
            )}

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

            {isOwner && finalPriceAgorot > 0 && (
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

        {closedSuccessfully && (
          <button
            type="button"
            onClick={() => {
              const next = !withReceipt;
              setWithReceipt(next);
              // turning the declaration off makes printing one meaningless
              if (!next) setIssueReceipt(false);
            }}
            className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-right transition ${
              withReceipt ? "border-brand-100 bg-brand-50/60" : "border-ink-100 bg-white hover:bg-ink-50"
            }`}
          >
            <ReceiptIcon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${withReceipt ? "text-brand-600" : "text-ink-400"}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink-900">
                {withReceipt ? "העבודה נסגרה עם קבלה" : "העבודה נסגרה בלי קבלה"}
              </span>
              <span className="block text-xs text-ink-500">
                {!withReceipt
                  ? "לא יירשם מס על העבודה הזו"
                  : isOwner
                    ? `יירשם מס של ${formatAgorot(taxAgorot)} (${taxRate}%${includesTax ? ", כלול במחיר" : ", מעל המחיר"}) והוא ירד מהרווח`
                    : "העבודה תירשם כמוצהרת"}
              </span>
            </span>
          </button>
        )}

        {closedSuccessfully && withReceipt && (
          <button
            type="button"
            onClick={() => setIssueReceipt((v) => !v)}
            className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-right transition ${
              issueReceipt ? "border-success-100 bg-success-50" : "border-ink-100 bg-white hover:bg-ink-50"
            }`}
          >
            <ReceiptIcon className={`mt-0.5 h-[18px] w-[18px] shrink-0 ${issueReceipt ? "text-success-600" : "text-ink-400"}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold text-ink-900">
                {issueReceipt ? "להפיק קבלה ללקוח" : "בלי קבלה"}
              </span>
              <span className="block text-xs text-ink-500">
                {issueReceipt
                  ? "מיד אחרי הסגירה תיפתח הקבלה כ-PDF לשליחה ללקוח."
                  : "אפשר להפיק קבלה מאוחר יותר מתוך דף העבודה."}
              </span>
              {issueReceipt && !settings?.business_name && (
                <span className="mt-1 block text-[11px] font-semibold text-warning-600">
                  עדיין לא מילאתם את פרטי העסק — הקבלה תצא בלי שם וללא ע.פ (הגדרות ← פרטי העסק לקבלות)
                </span>
              )}
            </span>
          </button>
        )}

        <Button
          fullWidth
          size="lg"
          onClick={handleSubmit}
          loading={loading}
          disabled={
            closedSuccessfully && (finalPriceAgorot <= 0 || !pctValid || !referralValid || splitTooBig)
          }
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
