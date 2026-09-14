"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, MessageCircle, ArrowLeft, Briefcase, Eye, EyeOff, Send, BellOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { AddressAutocomplete, formatAddressLine } from "@/components/jobs/AddressAutocomplete";
import { ContractorMatchList } from "@/components/jobs/ContractorMatchList";
import { CityPicker } from "@/components/ui/CityPicker";
import { useContractorMatch } from "@/hooks/useContractorMatch";
import { createJob } from "@/lib/api/jobs";
import { agorotToShekels, formatAgorot, shekelsToAgorot } from "@/lib/money";
import { buildNewJobWhatsappMessage, buildWhatsappLink, sendsCustomerPhone } from "@/lib/whatsapp";
import type { AddressResult } from "@/hooks/useAddressAutocomplete";
import type { JobWithRelations, PerformedBy } from "@/lib/types";

function nowForInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function NewJobPage() {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const toast = useToast();
  const { professions, jobTypes, cities, paymentMethods, leadSources, jobStatuses, helpers, settings, referralCompanies, refresh } = useRefData();

  const [professionId, setProfessionId] = useState<string | null>(null);
  const [jobTypeId, setJobTypeId] = useState<string | null>(null);
  const [cityId, setCityId] = useState<string | null>(null);
  const [contractorId, setContractorId] = useState<string | null>(null);
  const [skipContractor, setSkipContractor] = useState(false);

  // where the job came from: a customer of mine, or a company that refers work
  const [referralCompanyId, setReferralCompanyId] = useState("");
  const [referralPct, setReferralPct] = useState("");

  // who does the work, and what it costs me when it is me
  const [performedBy, setPerformedBy] = useState<PerformedBy>("contractor");
  const [originCityId, setOriginCityId] = useState<string | null>(null);
  const [travelKm, setTravelKm] = useState("");
  const [roundTrip, setRoundTrip] = useState(true);
  const [helperId, setHelperId] = useState("");
  const [helperPay, setHelperPay] = useState("");

  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [addressQuery, setAddressQuery] = useState("");
  const [addressResult, setAddressResult] = useState<AddressResult | null>(null);
  const [quotedPrice, setQuotedPrice] = useState("");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [leadSourceId, setLeadSourceId] = useState("");
  const [notes, setNotes] = useState("");
  const [openedAt, setOpenedAt] = useState(nowForInput());

  const [notifyContractor, setNotifyContractor] = useState(true);
  // null until touched, so the job follows the standing policy unless overridden
  const [sendPhone, setSendPhone] = useState<boolean | null>(null);
  const effectiveSendPhone = sendPhone ?? settings?.send_customer_phone_to_contractor ?? true;

  const [saving, setSaving] = useState(false);
  const [createdJob, setCreatedJob] = useState<JobWithRelations | null>(null);

  const activeProfessions = professions.filter((p) => p.is_active);
  const relevantJobTypes = jobTypes.filter((jt) => jt.profession_id === professionId && jt.is_active);
  const selectedJobType = relevantJobTypes.find((jt) => jt.id === jobTypeId) ?? null;
  // Every locality in the country is offered here. The is_active flag now only
  // orders the list — the places you already work float to the top — instead of
  // hiding a city you have simply never opened a job in before.
  const orderedCities = [...cities].sort(
    (a, b) => Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name, "he")
  );
  const activeHelpers = helpers.filter((h) => h.active);
  const activeCompanies = referralCompanies.filter((c) => c.active);
  const selectedCompany = activeCompanies.find((c) => c.id === referralCompanyId) ?? null;
  const parsedReferralPct = referralPct.trim() === "" ? null : parseFloat(referralPct);
  const referralPctValid =
    parsedReferralPct === null || (Number.isFinite(parsedReferralPct) && parsedReferralPct >= 0 && parsedReferralPct <= 100);
  const effectiveReferralPct = selectedCompany
    ? parsedReferralPct ?? selectedCompany.default_commission_pct
    : 0;
  const originId = originCityId ?? settings?.home_city_id ?? null;

  // one leg typed in, doubled when you drive back
  const oneWayKm = parseFloat(travelKm);
  const totalKm = Number.isFinite(oneWayKm) && oneWayKm > 0 ? (roundTrip ? oneWayKm * 2 : oneWayKm) : 0;
  const fuelAgorot =
    settings && totalKm > 0
      ? Math.round((totalKm / Number(settings.km_per_liter)) * settings.fuel_price_per_liter_agorot)
      : 0;
  const helperPayAgorot = helperPay.trim() === "" ? 0 : shekelsToAgorot(helperPay);
  const quotedAgorot = quotedPrice.trim() === "" ? 0 : shekelsToAgorot(quotedPrice);

  const matches = useContractorMatch(professionId, jobTypeId, cityId);
  const selectedContractor = matches.find((m) => m.id === contractorId);
  const contractorPct = performedBy === "self" ? 0 : selectedContractor?.commissionPct ?? 0;
  // both cuts come off the full price, so together they cannot pass 100%
  const splitTooBig = effectiveReferralPct + contractorPct > 100;
  const referralFeeAgorot = Math.round((quotedAgorot * effectiveReferralPct) / 100);
  const contractorFeeAgorot = Math.round((quotedAgorot * contractorPct) / 100);
  // a job I do myself: the price, less the company, the fuel and the helper
  const myTakeHome = quotedAgorot - referralFeeAgorot - fuelAgorot - helperPayAgorot;

  function selectProfession(id: string) {
    setProfessionId(id);
    setJobTypeId(null);
    setCityId(null);
    setContractorId(null);
  }
  function selectJobType(id: string) {
    const previous = relevantJobTypes.find((jt) => jt.id === jobTypeId) ?? null;
    const next = relevantJobTypes.find((jt) => jt.id === id) ?? null;
    setJobTypeId(id);
    setContractorId(null);

    // Fill in the standard price for this kind of job, but never overwrite a
    // number that was typed by hand: only an empty box, or one still holding
    // the previous job type's standard price, gets replaced.
    const priceWasUntouched =
      quotedPrice.trim() === "" ||
      (previous?.base_price_agorot != null &&
        quotedPrice.trim() === String(agorotToShekels(previous.base_price_agorot)));
    if (priceWasUntouched) {
      setQuotedPrice(next?.base_price_agorot != null ? String(agorotToShekels(next.base_price_agorot)) : "");
    }
  }
  function selectCity(id: string) {
    setCityId(id);
    setContractorId(null);
    // first job in a city marks it as one you work in, so it leads the list next time
    const city = cities.find((c) => c.id === id);
    if (city && !city.is_active) {
      supabase
        .from("cities")
        .update({ is_active: true })
        .eq("id", id)
        .then(() => refresh());
    }
  }

  function selectCompany(id: string) {
    setReferralCompanyId(id);
    // start from this company's usual cut; it stays editable for this job
    const c = activeCompanies.find((x) => x.id === id);
    setReferralPct(c ? String(c.default_commission_pct) : "");
  }

  function selectHelper(id: string) {
    setHelperId(id);
    const h = activeHelpers.find((x) => x.id === id);
    // fill in what this worker usually gets, unless a figure was already typed
    if (h?.default_pay_agorot != null && helperPay.trim() === "") {
      setHelperPay(String(agorotToShekels(h.default_pay_agorot)));
    }
  }

  function handleAddressSelect(r: AddressResult) {
    setAddressResult(r);
    // keep the tidy "street number" line, not Nominatim's long display_name
    setAddressQuery(formatAddressLine(r));
  }

  const canSave =
    professionId &&
    jobTypeId &&
    cityId &&
    customerName.trim() &&
    customerPhone.trim() &&
    referralPctValid &&
    !splitTooBig;

  async function handleSave() {
    if (!referralPctValid) {
      toast.error("אחוז החברה חייב להיות בין 0 ל-100");
      return;
    }
    if (splitTooBig) {
      toast.error("אחוז החברה ואחוז הקבלן יחד עולים על 100%");
      return;
    }
    if (!canSave) {
      toast.error("נא למלא תחום, סוג עבודה, עיר, שם לקוח וטלפון");
      return;
    }
    setSaving(true);
    try {
      // A job I take myself starts in progress; one actually sent out waits for
      // the contractor. A job assigned but deliberately not sent stays "חדשה" —
      // calling it "נשלחה לקבלן" when nothing was sent would make the reminder
      // and the timeline lie about what happened.
      const initialStatus =
        performedBy === "self"
          ? jobStatuses.find((s) => s.name === "בטיפול") ?? jobStatuses.find((s) => s.name === "חדשה")
          : contractorId && notifyContractor
            ? jobStatuses.find((s) => s.name === "נשלחה לקבלן")
            : jobStatuses.find((s) => s.name === "חדשה");
      if (!initialStatus) throw new Error("missing status");

      const job = await createJob(supabase, {
        profession_id: professionId!,
        job_type_id: jobTypeId!,
        city_id: cityId!,
        customer_name: customerName.trim(),
        customer_phone: customerPhone.trim(),
        send_customer_phone: sendPhone,
        notify_contractor: performedBy === "self" ? true : notifyContractor,
        address_full: addressResult
          ? [formatAddressLine(addressResult), addressResult.city].filter(Boolean).join(", ")
          : addressQuery.trim() || null,
        address_street: addressResult?.street ?? null,
        address_house_number: addressResult?.houseNumber ?? null,
        address_city: addressResult?.city ?? null,
        lat: addressResult?.lat ?? null,
        lng: addressResult?.lng ?? null,
        quoted_price_agorot: quotedPrice ? shekelsToAgorot(quotedPrice) : null,
        payment_method_id: paymentMethodId || null,
        referral_company_id: referralCompanyId || null,
        referral_pct: referralCompanyId ? effectiveReferralPct : null,
        performed_by: performedBy,
        contractor_id: performedBy === "self" ? null : contractorId,
        commission_pct: performedBy === "self" ? 0 : selectedContractor?.commissionPct ?? null,
        origin_city_id: performedBy === "self" ? originId : null,
        travel_km: performedBy === "self" && totalKm > 0 ? totalKm : null,
        helper_id: performedBy === "self" && helperId ? helperId : null,
        helper_pay_agorot: performedBy === "self" && helperPayAgorot > 0 ? helperPayAgorot : null,
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
    setSkipContractor(false);
    setReferralCompanyId("");
    setReferralPct("");
    setPerformedBy("contractor");
    setOriginCityId(null);
    setTravelKm("");
    setRoundTrip(true);
    setHelperId("");
    setHelperPay("");
    setCustomerName("");
    setCustomerPhone("");
    setSendPhone(null);
    setNotifyContractor(true);
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
    const waLink = createdJob.contractor && createdJob.notify_contractor
      ? buildWhatsappLink(
          createdJob.contractor.whatsapp || createdJob.contractor.phone,
          buildNewJobWhatsappMessage(createdJob, {
            includeCustomerPhone: sendsCustomerPhone(createdJob, settings?.send_customer_phone_to_contractor),
          })
        )
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
        ) : createdJob.performed_by === "self" ? (
          <Card>
            <CardBody className="space-y-1.5 text-center text-sm">
              <p className="font-bold text-ink-700">העבודה רשומה עליכם 🔧</p>
              <p className="text-ink-500">
                {createdJob.travel_km ? `${createdJob.travel_km} ק״מ נסיעה` : "בלי נסיעה רשומה"}
                {createdJob.helper ? ` · עם ${createdJob.helper.name}` : ""}
              </p>
              <p className="text-xs text-ink-400">
                הדלק וההוצאות ייכנסו לחישוב הרווח כשתסגרו את העבודה.
              </p>
            </CardBody>
          </Card>
        ) : createdJob.contractor && !createdJob.notify_contractor ? (
          <Card>
            <CardBody className="space-y-1.5 text-center text-sm">
              <p className="font-bold text-ink-700">
                העבודה שויכה ל{createdJob.contractor.name} בלי לשלוח הודעה 🤫
              </p>
              <p className="text-ink-500">
                הסטטוס נשאר ״חדשה״ ולא ״נשלחה לקבלן״, כי עדיין לא נשלח כלום.
              </p>
              <p className="text-xs text-ink-400">
                אפשר לשלוח את פרטי העבודה בכל רגע מתוך דף העבודה.
              </p>
            </CardBody>
          </Card>
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
            <ChipGrid
              items={relevantJobTypes.map((jt) => ({
                id: jt.id,
                label: jt.name,
                note: jt.base_price_agorot != null ? formatAgorot(jt.base_price_agorot) : undefined,
              }))}
              selectedId={jobTypeId}
              onSelect={selectJobType}
            />
          )}
        </Section>
      )}

      {jobTypeId && (
        <Section title="3. עיר" done={!!cityId}>
          <CityPicker
            cities={orderedCities}
            selectedIds={cityId ? [cityId] : []}
            onToggle={selectCity}
            emptyHint="לא נמצא יישוב בשם הזה. אפשר להוסיף יישוב חדש במסך ״הגדרות ← ערים״."
          />
        </Section>
      )}

      {cityId && (
        <Section title="4. מאיפה הגיעה העבודה?" done={true}>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setReferralCompanyId("");
                setReferralPct("");
              }}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                !referralCompanyId
                  ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                  : "border-ink-200 text-ink-700 hover:bg-ink-50"
              }`}
            >
              לקוח שלי
            </button>
            <button
              type="button"
              onClick={() => {
                if (activeCompanies[0]) selectCompany(activeCompanies[0].id);
              }}
              disabled={activeCompanies.length === 0}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition disabled:opacity-50 ${
                referralCompanyId
                  ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                  : "border-ink-200 text-ink-700 hover:bg-ink-50"
              }`}
            >
              הגיעה מחברה
            </button>
          </div>

          {activeCompanies.length === 0 && (
            <p className="mt-2 text-xs text-ink-400">
              עדיין לא הוספתם חברות. אפשר להוסיף במסך ״חברות מפנות״.
            </p>
          )}

          {referralCompanyId && (
            <div className="mt-4 space-y-3 rounded-2xl border border-ink-100 bg-ink-50/50 p-3.5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label required>איזו חברה</Label>
                  <select
                    value={referralCompanyId}
                    onChange={(e) => selectCompany(e.target.value)}
                    className="input"
                  >
                    {activeCompanies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label required>כמה אחוז היא לוקחת</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step={0.5}
                    inputMode="decimal"
                    value={referralPct}
                    onChange={(e) => setReferralPct(e.target.value)}
                    placeholder={String(selectedCompany?.default_commission_pct ?? 20)}
                  />
                  {selectedCompany &&
                    parsedReferralPct !== null &&
                    parsedReferralPct !== selectedCompany.default_commission_pct && (
                      <p className="mt-1 text-xs font-semibold text-warning-600">
                        אחוז מותאם לעבודה הזו (הרגיל: {selectedCompany.default_commission_pct}%)
                      </p>
                    )}
                </div>
              </div>
              {!referralPctValid && (
                <p className="text-xs font-bold text-danger-600">אחוז חייב להיות בין 0 ל-100</p>
              )}
            </div>
          )}
        </Section>
      )}

      {cityId && (
        <Section title="5. מי מבצע את העבודה?" done={performedBy === "self" || !!contractorId || skipContractor}>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setPerformedBy("self")}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                performedBy === "self"
                  ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                  : "border-ink-200 text-ink-700 hover:bg-ink-50"
              }`}
            >
              אני מבצע
            </button>
            <button
              type="button"
              onClick={() => setPerformedBy("contractor")}
              className={`rounded-xl border px-4 py-3 text-sm font-bold transition ${
                performedBy === "contractor"
                  ? "border-brand-600 bg-brand-600 text-white shadow-sm"
                  : "border-ink-200 text-ink-700 hover:bg-ink-50"
              }`}
            >
              קבלן מבצע
            </button>
          </div>

          {performedBy === "self" && (
            <div className="mt-4 space-y-4 rounded-2xl border border-ink-100 bg-ink-50/50 p-3.5">
              <div>
                <Label>מאיפה אתם יוצאים?</Label>
                <select
                  value={originId ?? ""}
                  onChange={(e) => setOriginCityId(e.target.value || null)}
                  className="input"
                >
                  <option value="">לא נבחר</option>
                  {orderedCities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <Label>כמה ק״מ לכיוון אחד?</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    inputMode="decimal"
                    value={travelKm}
                    onChange={(e) => setTravelKm(e.target.value)}
                    placeholder="למשל 25"
                    className="w-32"
                  />
                  <button
                    type="button"
                    onClick={() => setRoundTrip((r) => !r)}
                    className={`rounded-xl border px-3 py-2 text-sm font-bold ${
                      roundTrip ? "border-brand-600 bg-brand-50 text-brand-700" : "border-ink-200 text-ink-500"
                    }`}
                  >
                    {roundTrip ? "כולל חזרה ✓" : "בלי חזרה"}
                  </button>
                  {totalKm > 0 && (
                    <span className="text-sm font-bold text-ink-600">
                      {totalKm} ק״מ · דלק {formatAgorot(fuelAgorot)}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-ink-400">
                  {settings
                    ? `לפי ${settings.km_per_liter} ק״מ לליטר ו-${formatAgorot(settings.fuel_price_per_liter_agorot)} לליטר — אפשר לעדכן בהגדרות`
                    : "הגדירו צריכת דלק ומחיר לליטר בהגדרות"}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label>לקחתם עובד?</Label>
                  <select value={helperId} onChange={(e) => selectHelper(e.target.value)} className="input">
                    <option value="">לא, עבדתי לבד</option>
                    {activeHelpers.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                </div>
                {helperId && (
                  <div>
                    <Label>כמה שילמתם לו? (₪)</Label>
                    <Input
                      type="number"
                      min={0}
                      inputMode="decimal"
                      value={helperPay}
                      onChange={(e) => setHelperPay(e.target.value)}
                      placeholder="150"
                    />
                  </div>
                )}
              </div>

              {quotedAgorot > 0 && (
                <div className="rounded-xl bg-white p-3 text-sm">
                  <div className="flex justify-between py-0.5">
                    <span className="text-ink-500">מחיר העבודה</span>
                    <span className="font-bold">{formatAgorot(quotedAgorot)}</span>
                  </div>
                  {referralFeeAgorot > 0 && (
                    <div className="flex justify-between py-0.5">
                      <span className="text-ink-500">
                        פחות {selectedCompany?.name} ({effectiveReferralPct}%)
                      </span>
                      <span className="font-bold text-danger-600">-{formatAgorot(referralFeeAgorot)}</span>
                    </div>
                  )}
                  {fuelAgorot > 0 && (
                    <div className="flex justify-between py-0.5">
                      <span className="text-ink-500">פחות דלק</span>
                      <span className="font-bold text-danger-600">-{formatAgorot(fuelAgorot)}</span>
                    </div>
                  )}
                  {helperPayAgorot > 0 && (
                    <div className="flex justify-between py-0.5">
                      <span className="text-ink-500">פחות עובד</span>
                      <span className="font-bold text-danger-600">-{formatAgorot(helperPayAgorot)}</span>
                    </div>
                  )}
                  <div className="mt-1 flex justify-between border-t border-ink-100 pt-1.5">
                    <span className="font-bold text-ink-700">נשאר לי מהעבודה</span>
                    <span className="font-extrabold text-success-700">{formatAgorot(myTakeHome)}</span>
                  </div>
                  <p className="mt-1.5 text-xs text-ink-400">
                    חישוב לפי המחיר שנאמר בטלפון. המספר הסופי ייקבע בסגירת העבודה.
                  </p>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {cityId && performedBy === "contractor" && quotedAgorot > 0 && (contractorId || referralCompanyId) && (
        <Card className="border-ink-100">
          <CardBody className="text-sm">
            <p className="mb-2 text-xs font-bold text-ink-400">איך מתחלק הכסף בעבודה הזו</p>
            <div className="flex justify-between py-0.5">
              <span className="text-ink-500">מחיר העבודה</span>
              <span className="font-bold">{formatAgorot(quotedAgorot)}</span>
            </div>
            {referralFeeAgorot > 0 && (
              <div className="flex justify-between py-0.5">
                <span className="text-ink-500">
                  {selectedCompany?.name} ({effectiveReferralPct}%)
                </span>
                <span className="font-bold text-danger-600">-{formatAgorot(referralFeeAgorot)}</span>
              </div>
            )}
            {contractorFeeAgorot > 0 && (
              <div className="flex justify-between py-0.5">
                <span className="text-ink-500">
                  {selectedContractor?.name} ({contractorPct}%)
                </span>
                <span className="font-bold text-danger-600">-{formatAgorot(contractorFeeAgorot)}</span>
              </div>
            )}
            <div className="mt-1 flex justify-between border-t border-ink-100 pt-1.5">
              <span className="font-bold text-ink-700">נשאר לי</span>
              <span className="font-extrabold text-success-700">
                {formatAgorot(quotedAgorot - referralFeeAgorot - contractorFeeAgorot)}
              </span>
            </div>
            {splitTooBig && (
              <p className="mt-2 text-xs font-bold text-danger-600">
                האחוזים יחד ({effectiveReferralPct}% + {contractorPct}%) עולים על 100% — לא ניתן לשמור
              </p>
            )}
            <p className="mt-1.5 text-xs text-ink-400">
              שני האחוזים מחושבים מהמחיר המלא. הסכום הסופי ייקבע בסגירת העבודה.
            </p>
          </CardBody>
        </Card>
      )}

      {cityId && performedBy === "contractor" && (
        <Section title="6. קבלן מתאים" done={!!contractorId || skipContractor}>
          <ContractorMatchList matches={matches} selectedId={contractorId} onSelect={(id) => { setContractorId(id); setSkipContractor(false); }} />
          {/* offered even with nobody on the list — a job still has to be opened */}
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

          {contractorId && (
            /* assigning the job and telling the contractor are two separate decisions */
            <button
              type="button"
              onClick={() => setNotifyContractor((v) => !v)}
              className={`mt-3 flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-right transition ${
                notifyContractor ? "border-ink-100 bg-white hover:bg-ink-50" : "border-warning-100 bg-warning-50"
              }`}
            >
              {notifyContractor ? (
                <Send className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-400" />
              ) : (
                <BellOff className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warning-600" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink-900">
                  {notifyContractor ? "לשלוח לקבלן את פרטי העבודה" : "לא לשלוח לקבלן הודעה"}
                </span>
                <span className="block text-xs text-ink-500">
                  {notifyContractor
                    ? "אחרי השמירה יוצע לכם לשלוח את הפרטים ב-WhatsApp, והסטטוס יהיה ״נשלחה לקבלן״."
                    : "העבודה תישמר על שם הקבלן, בלי הודעה. הסטטוס יישאר ״חדשה״ ואפשר לשלוח מאוחר יותר."}
                </span>
              </span>
            </button>
          )}
        </Section>
      )}

      {cityId && (
        <Section title="7. פרטי לקוח ועבודה" done={!!(customerName && customerPhone)}>
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

            {/* the number is stored either way — this only decides what leaves the system */}
            <button
              type="button"
              onClick={() => setSendPhone(!effectiveSendPhone)}
              className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-right transition ${
                effectiveSendPhone ? "border-ink-100 bg-white hover:bg-ink-50" : "border-warning-100 bg-warning-50"
              }`}
            >
              {effectiveSendPhone ? (
                <Eye className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-400" />
              ) : (
                <EyeOff className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warning-600" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink-900">
                  {effectiveSendPhone ? "הקבלן יקבל את טלפון הלקוח" : "הקבלן לא יקבל את טלפון הלקוח"}
                </span>
                <span className="block text-xs text-ink-500">
                  {effectiveSendPhone
                    ? "המספר ייכלל בהודעת הוואטסאפ לקבלן. לחצו כדי להסתיר אותו."
                    : "במקום המספר ייכתב ״לתיאום מול הלקוח — דברו איתי״. המספר נשמר במערכת כרגיל."}
                </span>
                {sendPhone == null && (
                  <span className="mt-1 block text-[11px] text-ink-400">לפי ברירת המחדל שבהגדרות</span>
                )}
              </span>
            </button>
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
                {selectedJobType?.base_price_agorot != null && (
                  <p className="mt-1 text-xs text-ink-400">
                    המחיר הקבוע ל״{selectedJobType.name}״ הוא {formatAgorot(selectedJobType.base_price_agorot)} — אפשר לשנות לעבודה הזו
                  </p>
                )}
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
  items: { id: string; label: string; note?: string }[];
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
          {item.note && (
            <span
              className={`mr-1.5 text-xs font-bold ${
                selectedId === item.id ? "text-white/75" : "text-ink-400"
              }`}
            >
              {item.note}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
