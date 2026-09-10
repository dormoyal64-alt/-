"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { AddressAutocomplete } from "@/components/jobs/AddressAutocomplete";
import { ContractorMatchList } from "@/components/jobs/ContractorMatchList";
import { useContractorMatch } from "@/hooks/useContractorMatch";
import { useRefData } from "@/lib/refdata";
import { shekelsToAgorot } from "@/lib/money";
import type { AddressResult } from "@/hooks/useAddressAutocomplete";
import type { JobWithRelations } from "@/lib/types";

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
  const [notes, setNotes] = useState(job.notes ?? "");

  const matches = useContractorMatch(job.profession_id, job.job_type_id, job.city_id);
  const selectedContractor = matches.find((m) => m.id === contractorId);

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
      contractor_id: contractorId,
      commission_pct: contractorId ? selectedContractor?.commissionPct ?? job.commission_pct : null,
      notes: notes || null,
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

        <div>
          <Label>קבלן מבצע</Label>
          <ContractorMatchList matches={matches} selectedId={contractorId} onSelect={setContractorId} />
        </div>

        <div>
          <Label>הערות</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        <Button fullWidth size="lg" onClick={handleSubmit} loading={loading}>
          שמירת שינויים
        </Button>
      </div>
    </Modal>
  );
}
