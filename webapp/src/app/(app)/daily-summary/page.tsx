"use client";

import { useEffect, useMemo, useState } from "react";
import { Lightbulb, CalendarDays } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Misc";
import { formatAgorot, formatPercent } from "@/lib/money";
import { startOfDay, endOfDay, formatDateHe, last7Days } from "@/lib/dates";
import type { CityStatsRow, ContractorStatsRow, ProfessionStatsRow } from "@/lib/types";

interface ComboRow {
  professionName: string;
  cityName: string;
  count: number;
  closed: number;
}

export default function DailySummaryPage() {
  const supabase = useMemo(() => createClient(), []);
  const { professions, cities, contractors, jobStatuses } = useRefData();

  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [byProfession, setByProfession] = useState<ProfessionStatsRow[]>([]);
  const [byCity, setByCity] = useState<CityStatsRow[]>([]);
  const [byContractor, setByContractor] = useState<ContractorStatsRow[]>([]);
  const [weekTopContractor, setWeekTopContractor] = useState<{ name: string; rate: number } | null>(null);
  const [combos, setCombos] = useState<ComboRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const dayFrom = startOfDay(new Date(date)).toISOString();
      const dayTo = endOfDay(new Date(date)).toISOString();
      const weekFrom = last7Days().toISOString();
      const weekTo = new Date().toISOString();

      const [p, c, con, weekCon, comboJobs] = await Promise.all([
        supabase.rpc("stats_by_profession", { p_from: dayFrom, p_to: dayTo }),
        supabase.rpc("stats_by_city", { p_from: dayFrom, p_to: dayTo }),
        supabase.rpc("contractor_stats", { p_from: dayFrom, p_to: dayTo }),
        supabase.rpc("contractor_stats", { p_from: weekFrom, p_to: weekTo }),
        supabase.from("jobs").select("profession_id, city_id, status_id").gte("opened_at", dayFrom).lte("opened_at", dayTo),
      ]);

      setByProfession(((p.data as ProfessionStatsRow[]) ?? []).filter((r) => r.jobs_count > 0));
      setByCity(((c.data as CityStatsRow[]) ?? []).filter((r) => r.jobs_count > 0));
      setByContractor(((con.data as ContractorStatsRow[]) ?? []).filter((r) => r.jobs_sent > 0));

      const successIds = new Set(jobStatuses.filter((s) => s.is_success).map((s) => s.id));
      const comboMap: Record<string, { count: number; closed: number }> = {};
      for (const job of (comboJobs.data as any[]) ?? []) {
        const key = `${job.profession_id}::${job.city_id}`;
        if (!comboMap[key]) comboMap[key] = { count: 0, closed: 0 };
        comboMap[key].count += 1;
        if (successIds.has(job.status_id)) comboMap[key].closed += 1;
      }
      const comboRows: ComboRow[] = Object.entries(comboMap).map(([key, v]) => {
        const [profId, cityId] = key.split("::");
        return {
          professionName: professions.find((x) => x.id === profId)?.name ?? "לא ידוע",
          cityName: cities.find((x) => x.id === cityId)?.name ?? "לא ידוע",
          count: v.count,
          closed: v.closed,
        };
      });
      setCombos(comboRows);

      const weekRows = ((weekCon.data as ContractorStatsRow[]) ?? []).filter((r) => r.jobs_sent >= 3);
      const top = weekRows.sort((a, b) => (b.close_rate ?? 0) - (a.close_rate ?? 0))[0];
      if (top) {
        setWeekTopContractor({ name: contractors.find((c) => c.id === top.contractor_id)?.name ?? "לא ידוע", rate: top.close_rate ?? 0 });
      } else {
        setWeekTopContractor(null);
      }

      setLoading(false);
    }
    if (jobStatuses.length) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, jobStatuses.length]);

  const insights = useMemo(() => {
    const list: string[] = [];
    for (const combo of combos) {
      if (combo.count < 3) continue;
      const rate = (combo.closed / combo.count) * 100;
      if (rate >= 70) {
        list.push(`היום תחום ${combo.professionName} ב${combo.cityName} קיבל ${combo.count} עבודות וסגר ${combo.closed} – ${rate.toFixed(0)}% סגירה. ביצועים מצוינים!`);
      } else if (rate <= 30) {
        list.push(`${combo.professionName} ב${combo.cityName} קיבלה ${combo.count} עבודות אבל סגרה רק ${combo.closed} – מומלץ לבדוק את איכות הלידים או הקבלנים באזור.`);
      }
    }
    if (weekTopContractor) {
      list.push(`${weekTopContractor.name} הוא הקבלן בעל אחוז הסגירה הגבוה ביותר השבוע (${weekTopContractor.rate.toFixed(0)}%).`);
    }
    const totalJobs = byProfession.reduce((s, r) => s + r.jobs_count, 0);
    if (totalJobs === 0) {
      list.push("לא נפתחו עבודות ביום זה.");
    }
    return list;
  }, [combos, weekTopContractor, byProfession]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">סיכום יומי</h1>
          <p className="text-sm text-ink-500">{formatDateHe(date)}</p>
        </div>
        <div className="relative">
          <CalendarDays className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto pr-10" />
        </div>
      </div>

      {loading ? (
        <PageSpinner />
      ) : (
        <>
          <Card className="border-2 border-brand-100 bg-brand-50/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-brand-600" /> תובנות אוטומטיות
              </CardTitle>
            </CardHeader>
            <CardBody>
              {insights.length === 0 ? (
                <p className="text-sm text-ink-500">אין מספיק נתונים להפקת תובנות עבור יום זה.</p>
              ) : (
                <ul className="space-y-2">
                  {insights.map((text, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink-700">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                      {text}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <SummaryTable
            title="לפי תחום"
            rows={byProfession.map((r) => ({
              label: r.profession_name,
              count: r.jobs_count,
              closed: r.closed_success,
              revenue: r.revenue_agorot,
              profit: r.profit_agorot,
            }))}
          />
          <SummaryTable
            title="לפי עיר"
            rows={byCity.map((r) => ({ label: r.city_name, count: r.jobs_count, closed: r.closed_success, revenue: r.revenue_agorot, profit: r.profit_agorot }))}
          />
          <SummaryTable
            title="לפי קבלן"
            rows={byContractor.map((r) => ({
              label: contractors.find((c) => c.id === r.contractor_id)?.name ?? "לא ידוע",
              count: r.jobs_sent,
              closed: r.jobs_closed_success,
              revenue: r.total_revenue_agorot,
              profit: r.business_share_agorot,
            }))}
          />
        </>
      )}
    </div>
  );
}

function SummaryTable({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; count: number; closed: number; revenue: number; profit: number }[];
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-ink-400">אין נתונים</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-right text-xs font-bold uppercase text-ink-400">
                <th className="py-2">שם</th>
                <th className="py-2">לידים</th>
                <th className="py-2">נסגרו</th>
                <th className="py-2">אחוז סגירה</th>
                <th className="py-2">מחזור</th>
                <th className="py-2">רווח</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-t border-ink-50">
                  <td className="py-2 font-semibold text-ink-800">{r.label}</td>
                  <td className="py-2">{r.count}</td>
                  <td className="py-2">{r.closed}</td>
                  <td className="py-2">{formatPercent(r.count > 0 ? (r.closed / r.count) * 100 : 0)}</td>
                  <td className="py-2">{formatAgorot(r.revenue)}</td>
                  <td className="py-2">{formatAgorot(r.profit)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
