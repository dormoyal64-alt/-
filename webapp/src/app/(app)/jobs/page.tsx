"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, ChevronRight, ChevronLeft, Download, Plus, Briefcase, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { JOB_SELECT } from "@/lib/api/jobs";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState, PageSpinner } from "@/components/ui/Misc";
import { formatAgorot } from "@/lib/money";
import { formatDateHe, formatDateTimeHe } from "@/lib/dates";
import { buildCallLink } from "@/lib/whatsapp";
import { toCsv, downloadCsv } from "@/lib/csv";
import type { JobWithRelations } from "@/lib/types";

const PAGE_SIZE = 20;

export default function JobsPage() {
  // useSearchParams needs a boundary, and the dashboard links here with filters
  return (
    <Suspense fallback={<PageSpinner />}>
      <JobsList />
    </Suspense>
  );
}

function JobsList() {
  const router = useRouter();
  const params = useSearchParams();
  const supabase = useMemo(() => createClient(), []);
  const { professions, jobTypes, cities, contractors, paymentMethods, jobStatuses } = useRefData();

  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [professionId, setProfessionId] = useState(() => params.get("profession") ?? "");
  const [jobTypeId, setJobTypeId] = useState(() => params.get("jobType") ?? "");
  const [cityId, setCityId] = useState(() => params.get("city") ?? "");
  const [contractorId, setContractorId] = useState(() => params.get("contractor") ?? "");
  const [statusId, setStatusId] = useState(() => params.get("status") ?? "");
  const [paymentMethodId, setPaymentMethodId] = useState("");
  const [closedFilter, setClosedFilter] = useState<"" | "closed" | "open">(
    () => (params.get("closed") as "" | "closed" | "open" | null) ?? ""
  );
  // how a job ended, which is not the same question as whether it is closed
  const [result, setResult] = useState<"" | "success" | "failed">(
    () => (params.get("result") as "" | "success" | "failed" | null) ?? ""
  );
  // the dashboard counts closings by the day they were closed, not opened
  const [dateField, setDateField] = useState<"opened" | "closed">(
    () => (params.get("dateField") === "closed" ? "closed" : "opened")
  );
  const [dateFrom, setDateFrom] = useState(() => params.get("from") ?? "");
  const [dateTo, setDateTo] = useState(() => params.get("to") ?? "");
  const [showFilters, setShowFilters] = useState(false);

  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [jobs, setJobs] = useState<JobWithRelations[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => setPage(0), [search, professionId, jobTypeId, cityId, contractorId, statusId, paymentMethodId, closedFilter, result, dateField, dateFrom, dateTo]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      let query = supabase.from("jobs").select(JOB_SELECT, { count: "exact" });

      if (professionId) query = query.eq("profession_id", professionId);
      if (jobTypeId) query = query.eq("job_type_id", jobTypeId);
      if (cityId) query = query.eq("city_id", cityId);
      if (contractorId) query = query.eq("contractor_id", contractorId);
      if (statusId) query = query.eq("status_id", statusId);
      if (paymentMethodId) query = query.eq("payment_method_id", paymentMethodId);
      if (closedFilter === "closed") query = query.eq("is_closed", true);
      if (closedFilter === "open") query = query.eq("is_closed", false);
      if (result) {
        const ids = jobStatuses.filter((st) => (result === "success" ? st.is_success : !st.is_success)).map((st) => st.id);
        query = query.eq("is_closed", true).in("status_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
      }
      const dateColumn = dateField === "closed" ? "closed_at" : "opened_at";
      if (dateFrom) query = query.gte(dateColumn, new Date(dateFrom + "T00:00:00").toISOString());
      if (dateTo) query = query.lte(dateColumn, new Date(dateTo + "T23:59:59.999").toISOString());
      if (search.trim()) {
        const s = search.trim();
        query = query.or(
          `customer_name.ilike.%${s}%,customer_phone.ilike.%${s}%,address_full.ilike.%${s}%,job_number.ilike.%${s}%`
        );
      }

      query = query.order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

      const { data, count } = await query;
      if (!cancelled) {
        setJobs((data as unknown as JobWithRelations[]) ?? []);
        setTotal(count ?? 0);
        setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [supabase, jobStatuses, search, professionId, jobTypeId, cityId, contractorId, statusId, paymentMethodId, closedFilter, result, dateField, dateFrom, dateTo, page, reloadKey]);

  useAutoRefresh(() => setReloadKey((k) => k + 1));

  async function handleExport() {
    let query = supabase.from("jobs").select(JOB_SELECT).order("created_at", { ascending: false }).limit(10000);
    if (professionId) query = query.eq("profession_id", professionId);
    if (jobTypeId) query = query.eq("job_type_id", jobTypeId);
    if (cityId) query = query.eq("city_id", cityId);
    if (contractorId) query = query.eq("contractor_id", contractorId);
    if (statusId) query = query.eq("status_id", statusId);
    if (paymentMethodId) query = query.eq("payment_method_id", paymentMethodId);
    if (closedFilter === "closed") query = query.eq("is_closed", true);
    if (closedFilter === "open") query = query.eq("is_closed", false);
    if (result) {
      const ids = jobStatuses.filter((st) => (result === "success" ? st.is_success : !st.is_success)).map((st) => st.id);
      query = query.eq("is_closed", true).in("status_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]);
    }
    const dateColumn = dateField === "closed" ? "closed_at" : "opened_at";
    if (dateFrom) query = query.gte(dateColumn, new Date(dateFrom + "T00:00:00").toISOString());
    if (dateTo) query = query.lte(dateColumn, new Date(dateTo + "T23:59:59.999").toISOString());
    const { data } = await query;
    const rows = ((data as unknown as JobWithRelations[]) ?? []).map((j) => ({
      job_number: j.job_number,
      customer_name: j.customer_name,
      customer_phone: j.customer_phone,
      profession: j.profession?.name,
      job_type: j.job_type?.name,
      city: j.city?.name,
      address: j.address_full,
      contractor: j.contractor?.name,
      status: j.status?.name,
      quoted_price: j.quoted_price_agorot ? (j.quoted_price_agorot / 100).toFixed(2) : "",
      final_price: j.final_price_agorot ? (j.final_price_agorot / 100).toFixed(2) : "",
      contractor_share: j.contractor_share_agorot ? (j.contractor_share_agorot / 100).toFixed(2) : "",
      business_share: j.business_share_agorot ? (j.business_share_agorot / 100).toFixed(2) : "",
      opened_at: j.opened_at,
      closed_at: j.closed_at,
    }));
    downloadCsv(`jobs-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const anyFilter = !!(
    search || professionId || jobTypeId || cityId || contractorId || statusId ||
    paymentMethodId || closedFilter || result || dateFrom || dateTo
  );

  function clearFilters() {
    setSearch("");
    setProfessionId("");
    setJobTypeId("");
    setCityId("");
    setContractorId("");
    setStatusId("");
    setPaymentMethodId("");
    setClosedFilter("");
    setResult("");
    setDateField("opened");
    setDateFrom("");
    setDateTo("");
    router.replace("/jobs");
  }

  // a short line naming what the list is narrowed to, for when the dashboard sent you here
  const activeLabel = (() => {
    const parts: string[] = [];
    if (closedFilter === "open") parts.push("עבודות פתוחות");
    if (closedFilter === "closed" && !result) parts.push("עבודות סגורות");
    if (result === "success") parts.push("נסגרו בהצלחה");
    if (result === "failed") parts.push("לא נסגרו");
    const profession = professions.find((x) => x.id === professionId);
    if (profession) parts.push(profession.name);
    const city = cities.find((x) => x.id === cityId);
    if (city) parts.push(city.name);
    const contractor = contractors.find((x) => x.id === contractorId);
    if (contractor) parts.push(contractor.name);
    const status = jobStatuses.find((x) => x.id === statusId);
    if (status) parts.push(status.name);
    if (dateFrom || dateTo) {
      const when = dateField === "closed" ? "נסגרו" : "נפתחו";
      if (dateFrom && dateFrom === dateTo) parts.push(`ש${when} ב-${formatDateHe(dateFrom)}`);
      else if (dateFrom && dateTo) parts.push(`ש${when} בין ${formatDateHe(dateFrom)} ל-${formatDateHe(dateTo)}`);
      else if (dateFrom) parts.push(`ש${when} מ-${formatDateHe(dateFrom)}`);
      else parts.push(`ש${when} עד ${formatDateHe(dateTo)}`);
    }
    return parts.join(" · ");
  })();

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">עבודות</h1>
          <p className="text-sm text-ink-500">{anyFilter ? `נמצאו ${total} עבודות` : `${total} עבודות במערכת`}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}>
            <Download className="h-4 w-4" /> ייצוא CSV
          </Button>
          <Link href="/jobs/new" className="btn-primary px-4 py-2.5">
            <Plus className="h-4 w-4" /> עבודה חדשה
          </Link>
        </div>
      </div>

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="חיפוש: שם, טלפון, כתובת, מס' עבודה" className="pr-10" />
            </div>
            <button
              onClick={() => setShowFilters((s) => !s)}
              className="flex items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 text-sm font-semibold text-ink-600"
            >
              <SlidersHorizontal className="h-4 w-4" /> סינון
            </button>
            {anyFilter && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1.5 rounded-xl border border-ink-200 px-3.5 text-sm font-semibold text-ink-600"
              >
                <X className="h-4 w-4" /> נקה סינון
              </button>
            )}
          </div>

          {activeLabel && (
            <p className="text-sm font-bold text-brand-700">מוצג: {activeLabel}</p>
          )}

          {showFilters && (
            <div className="grid grid-cols-2 gap-2 border-t border-ink-100 pt-3 sm:grid-cols-3 lg:grid-cols-5">
              <select className="input" value={professionId} onChange={(e) => { setProfessionId(e.target.value); setJobTypeId(""); }}>
                <option value="">כל התחומים</option>
                {professions.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select className="input" value={jobTypeId} onChange={(e) => setJobTypeId(e.target.value)}>
                <option value="">כל סוגי העבודה</option>
                {jobTypes.filter((jt) => !professionId || jt.profession_id === professionId).map((jt) => (
                  <option key={jt.id} value={jt.id}>{jt.name}</option>
                ))}
              </select>
              <select className="input" value={cityId} onChange={(e) => setCityId(e.target.value)}>
                <option value="">כל הערים</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select className="input" value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
                <option value="">כל הקבלנים</option>
                {contractors.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <select className="input" value={statusId} onChange={(e) => setStatusId(e.target.value)}>
                <option value="">כל הסטטוסים</option>
                {jobStatuses.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <select className="input" value={paymentMethodId} onChange={(e) => setPaymentMethodId(e.target.value)}>
                <option value="">כל אמצעי התשלום</option>
                {paymentMethods.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <select className="input" value={closedFilter} onChange={(e) => setClosedFilter(e.target.value as any)}>
                <option value="">הכל</option>
                <option value="open">פתוחות בלבד</option>
                <option value="closed">סגורות בלבד</option>
              </select>
              <select className="input" value={result} onChange={(e) => setResult(e.target.value as any)}>
                <option value="">כל התוצאות</option>
                <option value="success">נסגרו בהצלחה</option>
                <option value="failed">לא נסגרו</option>
              </select>
              <select className="input" value={dateField} onChange={(e) => setDateField(e.target.value as any)}>
                <option value="opened">לפי תאריך פתיחה</option>
                <option value="closed">לפי תאריך סגירה</option>
              </select>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
          )}
        </CardBody>
      </Card>

      {loading ? (
        <PageSpinner />
      ) : jobs.length === 0 ? (
        <EmptyState icon={Briefcase} title="לא נמצאו עבודות" description="נסו לשנות את הסינון או צרו עבודה חדשה" />
      ) : (
        <>
          {/* Desktop table */}
          <Card className="hidden overflow-x-auto lg:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-right text-xs font-bold uppercase text-ink-400">
                  <th className="px-4 py-3">מס&apos; עבודה</th>
                  <th className="px-4 py-3">לקוח</th>
                  <th className="px-4 py-3">תחום / סוג</th>
                  <th className="px-4 py-3">עיר</th>
                  <th className="px-4 py-3">קבלן</th>
                  <th className="px-4 py-3">סטטוס</th>
                  <th className="px-4 py-3">מחיר</th>
                  <th className="px-4 py-3">תאריך</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr
                    key={job.id}
                    onClick={() => router.push(`/jobs/${job.id}`)}
                    className="cursor-pointer border-b border-ink-50 last:border-0 hover:bg-ink-50/60"
                  >
                    <td className="px-4 py-3 font-bold text-brand-700">{job.job_number}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink-900">{job.customer_name}</p>
                      {job.customer_phone ? (
                        <a
                          href={buildCallLink(job.customer_phone) ?? undefined}
                          dir="ltr"
                          onClick={(e) => e.stopPropagation()}
                          className="text-left text-xs font-semibold text-brand-700 hover:underline"
                        >
                          {job.customer_phone}
                        </a>
                      ) : (
                        <p className="text-left text-xs text-ink-400">—</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink-600">
                      {job.profession?.name} <br /> <span className="text-xs text-ink-400">{job.job_type?.name}</span>
                    </td>
                    <td className="px-4 py-3 text-ink-600">{job.city?.name}</td>
                    <td className="px-4 py-3 text-ink-600">{job.contractor?.name ?? "—"}</td>
                    <td className="px-4 py-3">{job.status && <StatusBadge name={job.status.name} color={job.status.color} />}</td>
                    <td className="px-4 py-3 font-semibold text-ink-800">
                      {job.is_closed ? formatAgorot(job.final_price_agorot) : formatAgorot(job.quoted_price_agorot)}
                    </td>
                    <td className="px-4 py-3 text-xs text-ink-400">{formatDateTimeHe(job.opened_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {/* Mobile cards */}
          <div className="space-y-2.5 lg:hidden">
            {jobs.map((job) => (
              <Link key={job.id} href={`/jobs/${job.id}`} className="card block p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-bold text-brand-700">{job.job_number}</p>
                    <p className="font-bold text-ink-900">{job.customer_name}</p>
                  </div>
                  {job.status && <StatusBadge name={job.status.name} color={job.status.color} />}
                </div>
                <p className="mt-1.5 text-xs text-ink-500">
                  {job.profession?.name} · {job.job_type?.name} · {job.city?.name}
                </p>
                <div className="mt-2.5 flex items-center justify-between border-t border-ink-50 pt-2.5 text-sm">
                  <span className="text-ink-500">{job.contractor?.name ?? "לא שויך"}</span>
                  <span className="font-extrabold text-ink-900">
                    {job.is_closed ? formatAgorot(job.final_price_agorot) : formatAgorot(job.quoted_price_agorot)}
                  </span>
                </div>
              </Link>
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-ink-400">
              עמוד {page + 1} מתוך {totalPages}
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronRight className="h-4 w-4" /> הקודם
              </Button>
              <Button variant="secondary" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((p) => p + 1)}>
                הבא <ChevronLeft className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
