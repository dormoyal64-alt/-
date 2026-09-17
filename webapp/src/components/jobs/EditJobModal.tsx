"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { AddressAutocomplete } from "@/components/jobs/AddressAutocomplete";
import { ContractorMatchList } from "@/components/jobs/ContractorMatchList";
import { useContractorMatch } from "@/hooks/useContractorMatch";
import { useRefData } from "@/lib/refdata";
import { formatAgorot, shekelsToAgorot } from "@/lib/money";
import type { AddressResult } from "@/hooks/useAddressAutocomplete";
import type { JobWithRelations, PerformedBy } from "@/lib/types";

export interface EditJobValues {
  customer_name: string;
  customer_phone: string;
  address_full: string | null;
  address_street: string | null;
  address_house_number: string | null;
  address_city: string | null;
  lat: number | null;
  lng: number | null;
  quoted_price_agorot: number | null;
  payment_method_id: string | null;
  lead_source_id: string | null;
  contractor_id: string | null;
  commission_pct: number | null;
  notes: string | null;
  scheduled_at: string | null;
  performed_by: PerformedBy;
}

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function EditJobModal({
  open,
  onClose,
  job,
  onSubmit,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  job: JobWithRelations;
  onSubmit: (values: EditJobValues) => Promise<void>;
  loading?: boolean;
}) {
  const { paymentMethods, leadSources } = useRefData();
  const [customerName, setCustomerName] = useState(job.customer_name);
  const [customerPhone, setCustomerPhone] = useState(job.customer_phone);
  const [addressQuery, setAddressQuery] = useState(job.address_full ?? "");
  const [addressResult, setAddressResult] = useState<AddressResult | null>(null);
  const [quotedPrice, setQuotedPrice] = useState(job.quoted_price_agorot ? String(job.quoted_price_agorot / 100) : "");
  const [paymentMethodId, setPaymentMethodId] = useState(job.payment_method_id ?? "");
  const [leadSourceId, setLeadSourceId] = useState(job.lead_source_id ?? "");
  const [contractorId, setContractorId] = useState(job.contractor_id);
  const [performedBy, setPerformedBy] = useState<PerformedBy>(job.performed_by ?? "contractor");
  // the trade filter is useful, but it must never be a dead end
  const [showAll, setShowAll] = useState(false);
  const [commissionPct, setCommissionPct] = useState(job.commission_pct != null ? String(job.commission_pct) : "");
  const [notes, setNotes] = useState(job.notes ?? "");
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(job.scheduled_at));

  // availability is judged against the appointment when the job has one
  const appointment = scheduledAt ? new Date(scheduledAt) : null;
  const when = appointment && !isNaN(appointment.getTime()) ? appointment : undefined;
  const inTrade = useContractorMatch(job.profession_id, job.job_type_id, job.city_id, when);
  const everyone = useContractorMatch(job.profession_id, job.job_type_id, job.city_id, when, true);
  // Nobody registered for this trade would otherwise leave an empty box with
  // no way out, and the contractor already on the job has to stay reachable
  // even when their trades were never filled in.
  const noneInTrade = inTrade.length === 0;
  const assignedIsListed = !job.contractor_id || inTrade.some((m) => m.id === job.contractor_id);
  const matches = showAll || noneInTrade || !assignedIsListed ? everyone : inTrade;
  const hiddenCount = everyone.length - inTrade.length;
  const selectedContractor = matches.find((m) => m.id === contractorId);
  const contractorDefaultPct = selectedContractor?.commissionPct ?? null;
  const parsedPct = parseFloat(commissionPct);
  const pctValid = commissionPct === "" || (!isNaN(parsedPct) && parsedPct >= 0 && parsedPct <= 100);

  async function handleSubmit() {
    await onSubmit({
      customer_name: customerName.trim(),
      customer_phone: customerPhone.trim(),
      address_full: addressResult?.displayName ?? addressQuery ?? null,
      address_street: addressResult?.street ?? job.address_street,
      address_house_number: addressResult?.houseNumber ?? job.address_house_number,
      address_city: addressResult?.city ?? job.address_city,
      lat: addressResult?.lat ?? job.lat,
      lng: addressResult?.lng ?? job.lng,
      quoted_price_agorot: quotedPrice ? shekelsToAgorot(quotedPrice) : null,
      payment_method_id: paymentMethodId || null,
      lead_source_id: leadSourceId || null,
      performed_by: performedBy,
      contractor_id: performedBy === "self" ? null : contractorId,
      // an explicit percentage wins; blank falls back to the contractor's usual rate
      commission_pct:
        performedBy === "self"
          ? 0
          : contractorId
            ? commissionPct !== "" && pctValid
              ? parsedPct
              : selectedContractor?.commissionPct ?? job.commission_pct
            : null,
      notes: notes || null,
      scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    });
  }

  return (
    <Modal open={open} onClose={onClose} title={`עריכת עבודה ${job.job_number}`} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label required>שם הלקוח</Label>
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
          </div>
          <div>
            <Label required>טלפון הלקוח</Label>
            <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} dir="ltr" />
          </div>
        </div>
        <div>
          <Label>כתובת</Label>
          <AddressAutocomplete
            value={addressQuery}
            onChange={(v) => {
              setAddressQuery(v);
              setAddressResult(null);
            }}
            onSelect={(r) => {
              setAddressResult(r);
              setAddressQuery(r.displayName);
            }}
            cityHint={job.city?.name}
            selected={addressResult}
            onClear={() => {
              setAddressResult(null);
              setAddressQuery("");
            }}
          />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>מחיר התחלתי (₪)</Label>
            <Input type="number" min={0} value={quotedPrice} onChange={(e) => setQuotedPrice(e.target.value)} inputMode="decimal" />
          </div>
          <div>
            <Label>אופן תשלום</Label>
            <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} className="input">
              <option value="">לא נבחר</option>
              {paymentMethods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>מקור ליד</Label>
            <select value={leadSourceId} onChange={(e) => setLeadSourceId(e.target.value)} className="input">
              <option value="">לא נבחר</option>
              {leadSources.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {job.is_closed && (
          <div
            className={`rounded-xl border px-3.5 py-3 text-xs font-semibold ${
              "border-warning-100 bg-warning-50 text-warning-700"
            }`}
          >
            {job.settlement_id ? (
              <>
                העבודה סגורה וכבר נכללה בהתחשבנות. החלפת המבצע תוציא אותה מאותה התחשבנות
                ותעדכן את הסכומים שלה אוטומטית, והעבודה תחזור להיות פתוחה להתחשבנות מול
                הקבלן החדש. המחיר ללקוח לא ישתנה.
              </>
            ) : (
              "העבודה סגורה. החלפת המבצע תחשב מחדש את חלוקת הכסף לפי המחיר שכבר נסגר — המחיר עצמו לא ישתנה."
            )}
          </div>
        )}

        <div>
          <Label>מי מבצע את העבודה?</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPerformedBy("self")}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                performedBy === "self" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-500"
              }`}
            >
              אני מבצע
            </button>
            <button
              type="button"
              onClick={() => {
                setPerformedBy("contractor");
                // a job that was mine carries a 0% split that belongs to nobody
                if (job.performed_by === "self") setCommissionPct("");
              }}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                performedBy === "contractor" ? "border-brand-600 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-500"
              }`}
            >
              קבלן
            </button>
          </div>
        </div>

        {performedBy === "contractor" && (
        <div>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <Label>קבלן מבצע</Label>
            <div className="flex gap-2">
              {contractorId && (
                <button
                  type="button"
                  onClick={() => {
                    setContractorId(null);
                    setCommissionPct("");
                  }}
                  className="rounded-full border border-ink-200 px-3 py-1 text-xs font-semibold text-ink-600 hover:bg-ink-50"
                >
                  בלי קבלן
                </button>
              )}
              {hiddenCount > 0 && !noneInTrade && assignedIsListed && (
                <button
                  type="button"
                  onClick={() => setShowAll((v) => !v)}
                  className="rounded-full border border-ink-200 px-3 py-1 text-xs font-semibold text-ink-600 hover:bg-ink-50"
                >
                  {showAll ? "רק קבלני התחום" : `הצג את כל הקבלנים (${hiddenCount} נוספים)`}
                </button>
              )}
            </div>
          </div>

          {noneInTrade && (
            <p className="mb-2 text-xs font-semibold text-warning-600">
              אף קבלן לא רשום לתחום של העבודה הזו, אז מוצגים כל הקבלנים. כדאי לשייך תחומים לקבלנים
              במסך ״קבלנים״ כדי שההתאמה תעבוד.
            </p>
          )}
          {!noneInTrade && !assignedIsListed && (
            <p className="mb-2 text-xs font-semibold text-warning-600">
              הקבלן שמשויך כרגע אינו רשום לתחום של העבודה, אז מוצגים כל הקבלנים.
            </p>
          )}

          <ContractorMatchList
            matches={matches}
            selectedId={contractorId}
            // A percentage typed for the previous contractor does not describe
            // the new one, so picking somebody falls back to their usual rate
            // until it is typed over again.
            onSelect={(id) => {
              setContractorId(id);
              if (id !== job.contractor_id) setCommissionPct("");
            }}
          />
        </div>
        )}

        {performedBy === "contractor" && contractorId && (
          <div>
            <Label>אחוז הקבלן בעבודה הזו</Label>
            <div className="flex items-center gap-3">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={commissionPct}
                onChange={(e) => setCommissionPct(e.target.value)}
                placeholder={contractorDefaultPct != null ? String(contractorDefaultPct) : "60"}
                className="w-28 text-center text-lg font-extrabold"
              />
              <p className="flex-1 text-xs text-ink-500">
                הקבלן {parsedPct >= 0 && parsedPct <= 100 && commissionPct !== "" ? parsedPct : contractorDefaultPct ?? 0}% ·
                אני {100 - (commissionPct !== "" && pctValid ? parsedPct : contractorDefaultPct ?? 0)}%
                {contractorDefaultPct != null && (
                  <span className="block text-ink-400">האחוז הרגיל של הקבלן: {contractorDefaultPct}%</span>
                )}
              </p>
            </div>
            {!pctValid && <p className="mt-1 text-xs font-bold text-danger-600">יש להזין אחוז בין 0 ל-100</p>}
            {job.is_closed && !!job.final_price_agorot && (() => {
              const pct = commissionPct !== "" && pctValid ? parsedPct : contractorDefaultPct ?? 0;
              const forContractor = Math.round((job.final_price_agorot! * pct) / 100);
              const forMe = job.final_price_agorot! - forContractor - (job.referral_fee_agorot ?? 0);
              return (
                <div className="mt-2 rounded-xl bg-ink-50 px-3.5 py-2.5 text-xs">
                  <p className="mb-1 font-bold text-ink-400">החלוקה אחרי השמירה</p>
                  <div className="flex justify-between py-0.5">
                    <span className="text-ink-500">לקבלן ({pct}%)</span>
                    <span className="font-bold">{formatAgorot(forContractor)}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-ink-500">נשאר לי</span>
                    <span className="font-bold text-success-700">{formatAgorot(forMe)}</span>
                  </div>
                </div>
              );
            })()}
          </div>
        )}

        <div>
          <Label>מועד מבוקש אצל הלקוח</Label>
          <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          <p className="mt-1 text-xs text-ink-400">
            {scheduledAt ? "רוקנו את השדה כדי להחזיר את העבודה ל״בהקדם האפשרי״." : "ריק = בהקדם האפשרי."}
          </p>
        </div>

        <div>
          <Label>הערות</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <Button fullWidth size="lg" onClick={handleSubmit} loading={loading} disabled={!pctValid}>
          שמירת שינויים
        </Button>
      </div>
    </Modal>
  );
}
