"use client";

import { useEffect, useMemo, useState } from "react";
import { Trophy, Medal } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { Card, CardBody } from "@/components/ui/Card";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { EmptyState, PageSpinner } from "@/components/ui/Misc";
import { formatAgorot, formatPercent } from "@/lib/money";
import { getPeriodRange, isoRange, customDateRange, type PeriodKey } from "@/lib/dates";

interface Row {
  contractorId: string;
  jobsSent: number;
  jobsClosedSuccess: number;
  closeRate: number;
  revenue: number;
  avgPrice: number;
  avgCloseMinutes: number | null;
}

export default function LeaderboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const { contractors, professions, cities, jobTypes, jobStatuses } = useRefData();

  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const [professionId, setProfessionId] = useState("");
  const [cityId, setCityId] = useState("");
  const [jobTypeId, setJobTypeId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const range = period === "custom" ? customDateRange(customFrom, customTo) : getPeriodRange(period);
  const rangeIso = isoRange(range);

  useEffect(() => {
    async function load() {
      setLoading(true);
      let query = supabase
        .from("jobs")
        .select("contractor_id, is_closed, status_id, closed_at, opened_at, final_price_agorot, profession_id, city_id, job_type_id")
        .not("contractor_id", "is", null)
        .gte("opened_at", rangeIso.from)
        .lte("opened_at", rangeIso.to);
      if (professionId) query = query.eq("profession_id", professionId);
      if (cityId) query = query.eq("city_id", cityId);
      if (jobTypeId) query = query.eq("job_type_id", jobTypeId);

      const { data } = await query;
      const successIds = new Set(jobStatuses.filter((s) => s.is_success).map((s) => s.id));

      const map: Record<string, { sent: number; closed: number; revenue: number; priceSum: number; closeMinutesSum: number; closeMinutesCount: number }> = {};
      for (const job of data ?? []) {
        const id = job.contractor_id as string;
        if (!map[id]) map[id] = { sent: 0, closed: 0, revenue: 0, priceSum: 0, closeMinutesSum: 0, closeMinutesCount: 0 };
        map[id].sent += 1;
        if (job.is_closed && successIds.has(job.status_id)) {
          map[id].closed += 1;
          map[id].revenue += job.final_price_agorot ?? 0;
          map[id].priceSum += job.final_price_agorot ?? 0;
          if (job.closed_at && job.opened_at) {
            map[id].closeMinutesSum += (new Date(job.closed_at).getTime() - new Date(job.opened_at).getTime()) / 60000;
            map[id].closeMinutesCount += 1;
          }
        }
      }

      const result: Row[] = Object.entries(map).map(([contractorId, v]) => ({
        contractorId,
        jobsSent: v.sent,
        jobsClosedSuccess: v.closed,
        closeRate: v.sent > 0 ? (v.closed / v.sent) * 100 : 0,
        revenue: v.revenue,
        avgPrice: v.closed > 0 ? v.priceSum / v.closed : 0,
        avgCloseMinutes: v.closeMinutesCount > 0 ? v.closeMinutesSum / v.closeMinutesCount : null,
      }));

      result.sort((a, b) => b.closeRate - a.closeRate || b.jobsClosedSuccess - a.jobsClosedSuccess);
      setRows(result);
      setLoading(false);
    }
    if (jobStatuses.length) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo, professionId, cityId, jobTypeId, jobStatuses.length]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">דירוג קבלנים</h1>
        <p className="text-sm text-ink-500">מי הקבלן הכי טוב? מדורג לפי אחוז סגירה, לא רק כמות</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <PeriodPicker period={period} onChange={setPeriod} customFrom={customFrom} customTo={customTo} onCustomFromChange={setCustomFrom} onCustomToChange={setCustomTo} />
        <select className="input w-auto" value={professionId} onChange={(e) => setProfessionId(e.target.value)}>
          <option value="">כל התחומים</option>
          {professions.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        <select className="input w-auto" value={cityId} onChange={(e) => setCityId(e.target.value)}>
          <option value="">כל הערים</option>
          {cities.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="input w-auto" value={jobTypeId} onChange={(e) => setJobTypeId(e.target.value)}>
          <option value="">כל סוגי העבודה</option>
          {jobTypes.filter((jt) => !professionId || jt.profession_id === professionId).map((jt) => (
            <option key={jt.id} value={jt.id}>{jt.name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <PageSpinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={Trophy} title="אין נתונים מספיקים לדירוג בטווח שנבחר" />
      ) : (
        <div className="space-y-2.5">
          {rows.map((row, i) => {
            const contractor = contractors.find((c) => c.id === row.contractorId);
            return (
              <Card key={row.contractorId}>
                <CardBody className="flex items-center gap-4">
                  <div
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-sm font-extrabold ${
                      i === 0 ? "bg-warning-100 text-warning-700" : i === 1 ? "bg-ink-100 text-ink-600" : i === 2 ? "bg-orange-100 text-orange-700" : "bg-ink-50 text-ink-400"
                    }`}
                  >
                    {i < 3 ? <Medal className="h-5 w-5" /> : i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-bold text-ink-900">{contractor?.name ?? "לא ידוע"}</p>
                    <p className="text-xs text-ink-500">
                      {row.jobsClosedSuccess} מתוך {row.jobsSent} נסגרו · {formatAgorot(row.revenue)} מחזור
                    </p>
                  </div>
                  <div className="text-left">
                    <p className="text-lg font-extrabold text-success-600">{formatPercent(row.closeRate)}</p>
                    <p className="text-[10px] text-ink-400">אחוז סגירה</p>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
