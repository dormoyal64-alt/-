"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageCircle, ArrowLeft, Briefcase } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { AddressAutocomplete } from "@/components/jobs/AddressAutocomplete";
import { ContractorMatchList } from "@/components/jobs/ContractorMatchList";
import { CityPicker } from "@/components/ui/CityPicker";
import { useContractorMatch } from "@/hooks/useContractorMatch";
import { createJob } from "@/lib/api/jobs";
import { shekelsToAgorot } from "@/lib/money";
import { buildNewJobWhatsappMessage, buildWhatsappLink } from "@/lib/whatsapp";
import type { AddressResult } from "@/hooks/useAddressAutocomplete";
import type { JobWithRelations } from "@/lib/types";

function nowForInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function NewJobPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const toast = useToast();
  const { professions, jobTypes, cities, paymentMethods, leadSources, jobStatuses } = useRefData();

  const [professionId, setProfessionId] = useState<string | null>(null);
  const [jobTypeId, setJobTypeId] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [skipContractor, setSkipContractor] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResult, setAddressResult] = useState<AddressResult | null>(null);
  const [quotedPrice, setQuotedPrice] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [leadSourceId, setLeadSourceId] = useState("");
  const [notes, setNotes] = useState("");
  const [openedAt, setOpenedAt] = useState(nowForInput());

  const [saving, setSaving] = useState(false);
  const [createdJob, setCreatedJob] = useState<JobWithRelations | null>(null);

  const activeProfessions = professions.filter((p) => p.is_active);
  const relevantJobTypes = jobTypes.filter((jt) => jt.profession_id === professionId && jt.is_active);
  const activeCities = cities.filter((c) => c.is_active);

  const matches = useContractorMatch(professionId, jobTypeId, cityId);
  const selectedContractor = matches.find((m) => m.id === contractorId);

  function selectProfession(id: string) {
    setProfessionId(id);
    setJobTypeId(null);
    setCityId(null);
    setContractorId(null);
  }
  function selectJobType(id: string) {
    setJobTypeId(id);
    setContractorId(null);
  }
  function selectCity(id: string) {
    setCityId(id);
    setContractorId(null);
  }

  function handleAddressSelect(r: AddressResult) {
    setAddressResult(r);
    setAddressQuery(r.displayName);
  }

  const canSave = professionId && jobTypeId && cityId && customerName.trim() && customerPhone.trim();

  async function handleSave() {
    if (!canSave) {
      toast.error("נא למלא תחום, סוג עבודה, עיר, שם לקוח וטלפון");
      return;
    }
    setSaving(true);
    try {
      const initialStatus = contractorId
        ? jobStatuses.find((s) => s.name === "נשלחה לקבלן")
        : jobStatuses.find((s) => s.name === "חדשה");
      if (!initialStatus) throw new Error("missing status");

      const job = await createJob(supabase, {
        profession_id: professionId!,
        job_type_id: jobTypeId!,
        city_id: cityId!,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        address_full: addressResult?.displayName ?? addressQuery ?? null,
        address_street: addressResult?.street ?? null,
        address_house_number: addressResult?.houseNumber ?? null,
        address_city: addressResult?.city ?? null,
        lat: addressResult?.lat ?? null,
        lng: addressResult?.lng ?? null,
        quoted_price_agorot: quotedPrice ? shekelsToAgorot(quotedPrice) : null,
        payment_method_id: paymentMethodId || null,
        contractor_id: contractorId,
        commission_pct: selectedContractor?.commissionPct ?? null,
        lead_source_id: leadSourceId || null,
        notes: notes || null,
        status_id: initialStatus.id,
        opened_at: new Date(openedAt).toISOString(),
      });
      setCreatedJob(job);
      toast.success(`העבודה ${job.job_number} נשמרה בהצלחה`);
    } catch (e) {
      toast.error("שגיאה בשמירת העבודה. נסו שוב.");
    } finally {
      setSaving(false);
    }
  }

  function resetForm() {
    setProfessionId(null);
    setJobTypeId(null);
    setCityId(null);
    setContractorId(null);
    setCustomerName("");
    setCustomerPhone("");
    setAddressQuery("");
    setAddressResult(null);
    setQuotedPrice("");
    setPaymentMethodId("");
    setLeadSourceId("");
    setNotes("");
    setOpenedAt(nowForInput());
    setCreatedJob(null);
  }

  if (createdJob) {
    const waLink = createdJob.contractor
      ? buildWhatsappLink(createdJob.contractor.whatsapp || createdJob.contractor.phone, buildNewJobWhatsappMessage(createdJob))
      : null;
    return (
      <div className="mx-auto max-w-lg space-y-5">
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-success-50 text-success-600">
            <CheckCircle2 className="h-9 w-9" />
          </div>
          <h1 className="text-xl font-extrabold text-ink-900">העבודה {createdJob.job_number} נשמרה!</h1>
          <p className="text-sm text-ink-500">
            {createdJob.customer_name} · {createdJob.city?.name} · {createdJob.job_type?.name}
          </p>
        </div>

        {waLink ? (
          <a
            href={waLink}
            target="_blank"
            className="btn-success flex w-full items-center justify-center gap-2 py-4 text-lg shadow-lg shadow-success-600/20"
          >
            <MessageCircle className="h-5 w-5" />
            שליחה לקבלן ב-WhatsApp
          </a>
        ) : (
          <Card>
            <CardBody className="text-center text-sm text-ink-500">
              לא נבחר קבלן לעבודה זו, או שאין מספר WhatsApp שמור לקבלן. ניתן לשייך קבלן מתוך דף העבודה.
            </CardBody>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={() => router.push(`/jobs/${createdJob.id}`)}>
            צפייה בעבודה
          </Button>
          <Button variant="primary" onClick={resetForm}>
            עבודה חדשה נוספת
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5 pb-8">
      <div className="flex items-center gap-2">
        <button onClick={() => router.back()} className="text-ink-400 hover:text-ink-700">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-2xl font-extrabold text-ink-900">עבודה חדשה</h1>
      </div>

      <Section title="1. תחום" done={!!professionId}>
        <ChipGrid
          items={activeProfessions.map((p) => ({ id: p.id, label: p.name }))}
          selectedId={professionId}
          onSelect={selectProfession}
        />
      </Section>

      {professionId && (
        <Section title="2. סוג העבודה" done={!!jobTypeId}>
          {relevantJobTypes.length === 0 ? (
            <p className="text-sm text-ink-400">אין סוגי עבודה מוגדרים לתחום זה. ניתן להוסיף בהגדרות.</p>
          ) : (
            <ChipGrid items={relevantJobTypes.map((jt) => ({ id: jt.id, label: jt.name }))} selectedId={jobTypeId} onSelect={selectJobType} />
          )}
        </Section>
      )}

      {jobTypeId && (
        <Section title="3. עיר" done={!!cityId}>
          {activeCities.length > 8 ? (
            <CityPicker
              cities={activeCities}
              selectedIds={cityId ? [cityId] : []}
              onToggle={selectCity}
              emptyHint="לא נמצאה עיר פעילה בשם הזה. אפשר להפעיל עוד ערים במסך ״ערים״."
            />
          ) : (
            <ChipGrid items={activeCities.map((c) => ({ id: c.id, label: c.name }))} selectedId={cityId} onSelect={selectCity} />
          )}
        </Section>
      )}

      {cityId && (
        <Section title="4. קבלן מתאים" done={!!contractorId || skipContractor}>
          <ContractorMatchList matches={matches} selectedId={contractorId} onSelect={(id) => { setContractorId(id); setSkipContractor(false); }} />
          {matches.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setContractorId(null);
                setSkipContractor(true);
              }}
              className={`mt-2 w-full rounded-xl border py-2.5 text-sm font-semibold ${
                skipContractor ? "border-brand-600 bg-brand-50 text-brand-700" : "border-dashed border-ink-200 text-ink-400"
              }`}
            >
              המשך בלי לשייך קבלן כרגע
            </button>
          )}
        </Section>
      )}

      {cityId && (
        <Section title="5. פרטי לקוח ועבודה" done={!!(customerName && customerPhone)}>
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label required>שם הלקוח</Label>
                <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="שם מלא" />
              </div>
              <div>
                <Label required>טלפון הלקוח</Label>
                <Input value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="050-1234567" dir="ltr" />
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
                onSelect={handleAddressSelect}
                cityHint={cities.find((c) => c.id === cityId)?.name}
                selected={addressResult}
                onClear={() => {
                  setAddressResult(null);
                  setAddressQuery("");
                }}
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>מחיר התחלתי שנאמר בטלפון (₪)</Label>
                <Input
                  type="number"
                  min={0}
                  value={quotedPrice}
                  onChange={(e) => setQuotedPrice(e.target.value)}
                  placeholder="350"
                  inputMode="decimal"
                />
              </div>
              <div>
                <Label>אופן תשלום</Label>
                <select value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)} className="input">
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
                <Label>מקור ליד (אופציונלי)</Label>
                <select value={leadSourceId} onChange={(e) => setLeadSourceId(e.target.value)} className="input">
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
                <Label>זמן פתיחת העבודה</Label>
                <Input type="datetime-local" value={openedAt} onChange={(e) => setOpenedAt(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>הערות</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="פרטים נוספים לגבי העבודה..." />
            </div>
          </div>
        </Section>
      )}

      {cityId && (
        // Opaque fade behind the bar so form fields never show through the
        // (semi-transparent) disabled button while scrolling.
        <div className="sticky bottom-20 z-20 -mx-4 bg-gradient-to-t from-ink-50 via-ink-50 to-transparent px-4 pb-2 pt-6 lg:bottom-2 lg:-mx-8 lg:px-8">
          <Button size="lg" fullWidth loading={saving} disabled={!canSave} onClick={handleSave} className="shadow-xl">
            שמירה ושליחה לקבלן
          </Button>
        </div>
      )}
    </div>
  );
}

function Section({ title, done, children }: { title: string; done: boolean; children: React.ReactNode }) {
  return (
    <Card className="animate-slide-up">
      <CardBody>
        <div className="mb-3 flex items-center gap-2">
          <div
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
              done ? "bg-success-500 text-white" : "bg-ink-100 text-ink-400"
            }`}
          >
            {done ? <CheckCircle2 className="h-4 w-4" /> : ""}
          </div>
          <h2 className="font-bold text-ink-800">{title}</h2>
        </div>
        {children}
      </CardBody>
    </Card>
  );
}

function ChipGrid({
  items,
  selectedId,
  onSelect,
}: {
  items: { id: string; label: string }[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-400">
        <Briefcase className="h-4 w-4" /> אין פריטים פעילים. ניתן להוסיף בהגדרות.
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          type="button"
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`rounded-xl border px-4 py-2.5 text-sm font-semibold transition active:scale-[.97] ${
            selectedId === item.id ? "border-brand-600 bg-brand-600 text-white shadow-sm" : "border-ink-200 text-ink-700 hover:bg-ink-50"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
