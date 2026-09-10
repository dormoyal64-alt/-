"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Briefcase,
  CheckCircle2,
  XCircle,
  Percent,
  Wallet,
  TrendingUp,
  Users,
  Building2,
  ArrowLeft,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Misc";
import { formatAgorot, formatNumber, formatPercent } from "@/lib/money";
import { getPeriodRange, getPreviousPeriodRange, isoRange } from "@/lib/dates";
import type { CityStatsRow, ContractorStatsRow, PeriodTotalsRow, ProfessionStatsRow } from "@/lib/types";

export default function DashboardPage() {
  const supabase = useMemo(() => createClient(), []);
  const { contractors } = useRefData();

  const [today, setToday] = useState<PeriodTotalsRow | null>(null);
  const [yesterday, setYesterday] = useState<PeriodTotalsRow | null>(null);
  const [openJobs, setOpenJobs] = useState(0);
  const [byProfession, setByProfession] = useState<ProfessionStatsRow[]>([]);
  const [byCity, setByCity] = useState<CityStatsRow[]>([]);
  const [topContractor, setTopContractor] = useState<{ name: string; row: ContractorStatsRow } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const todayRange = getPeriodRange("today");
      const yesterdayRange = getPreviousPeriodRange("today", todayRange);
      const todayIso = isoRange(todayRange);
      const yesterdayIso = isoRange(yesterdayRange);

      const [todayRes, yesterdayRes, openRes, professionRes, cityRes, contractorRes] = await Promise.all([
        supabase.rpc("period_totals", { p_from: todayIso.from, p_to: todayIso.to }),
        supabase.rpc("period_totals", { p_from: yesterdayIso.from, p_to: yesterdayIso.to }),
        supabase.from("jobs").select("id", { count: "exact", head: true }).eq("is_closed", false),
        supabase.rpc("stats_by_profession", { p_from: todayIso.from, p_to: todayIso.to }),
        supabase.rpc("stats_by_city", { p_from: todayIso.from, p_to: todayIso.to }),
        supabase.rpc("contractor_stats", { p_from: todayIso.from, p_to: todayIso.to }),
      ]);

      setToday((todayRes.data as PeriodTotalsRow[] | null)?.[0] ?? null);
      setYesterday((yesterdayRes.data as PeriodTotalsRow[] | null)?.[0] ?? null);
      setOpenJobs(openRes.count ?? 0);
      setByProfession(((professionRes.data as ProfessionStatsRow[]) ?? []).filter((r) => r.jobs_count > 0));
      setByCity(((cityRes.data as CityStatsRow[]) ?? []).filter((r) => r.jobs_count > 0));

      const rows = (contractorRes.data as ContractorStatsRow[]) ?? [];
      const top = rows.sort((a, b) => b.jobs_closed_success - a.jobs_closed_success)[0];
      if (top && top.jobs_closed_success > 0) {
        const name = contractors.find((c) => c.id === top.contractor_id)?.name ?? "לא ידוע";
        setTopContractor({ name, row: top });
      } else {
        setTopContractor(null);
      }

      setLoading(false);
    }
    load();
  }, [supabase, contractors]);

  function pctChange(curr?: number | null, prev?: number | null) {
    if (curr === undefined || curr === null || prev === undefined || prev === null || prev === 0) return null;
    return ((curr - prev) / prev) * 100;
  }

  if (loading) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">שלום 👋</h1>
          <p className="text-sm text-ink-500">הנה מה שקורה בעסק היום</p>
        </div>
        <Link href="/jobs/new" className="btn-primary px-4 py-2.5">
          עבודה חדשה
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        <StatCard label="עבודות היום" value={formatNumber(today?.jobs_count)} icon={Briefcase} changePct={pctChange(today?.jobs_count, yesterday?.jobs_count)} />
        <StatCard label="עבודות פתוחות" value={formatNumber(openJobs)} icon={Building2} tone="warning" />
        <StatCard label="נסגרו בהצלחה" value={formatNumber(today?.jobs_closed_success)} icon={CheckCircle2} tone="success" changePct={pctChange(today?.jobs_closed_success, yesterday?.jobs_closed_success)} />
        <StatCard label="לא נסגרו" value={formatNumber(today?.jobs_closed_failed)} icon={XCircle} tone="danger" />
        <StatCard label="אחוז סגירה" value={formatPercent(today?.close_rate ?? 0)} icon={Percent} tone="success" changePct={pctChange(today?.close_rate, yesterday?.close_rate)} />
        <StatCard label="מחזור היום" value={formatAgorot(today?.revenue_agorot)} icon={Wallet} changePct={pctChange(today?.revenue_agorot, yesterday?.revenue_agorot)} />
        <StatCard label="הרווח שלי היום" value={formatAgorot(today?.profit_agorot)} icon={TrendingUp} tone="success" changePct={pctChange(today?.profit_agorot, yesterday?.profit_agorot)} />
        <StatCard label="ממוצע לעבודה" value={formatAgorot(today?.avg_price_agorot)} icon={Wallet} />
        <StatCard label="מגיע לקבלנים ממני" value={formatAgorot(today?.contractor_payable_agorot)} icon={Users} tone="warning" />
        <StatCard label="קבלנים חייבים לי" value={formatAgorot(today?.contractor_receivable_agorot)} icon={Users} tone="danger" />
      </div>

      {topContractor && (
        <Card className="border-2 border-brand-100 bg-brand-50/40">
          <CardBody className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-600 text-white">
              <Users className="h-6 w-6" />
            </div>
            <div>
              <p className="text-xs font-bold text-brand-700">קבלן מוביל היום</p>
              <p className="text-lg font-extrabold text-ink-900">{topContractor.name}</p>
              <p className="text-xs text-ink-500">
                {topContractor.row.jobs_closed_success} עבודות סגורות · {formatPercent(topContractor.row.close_rate ?? 0)} אחוז סגירה
              </p>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>עבודות היום לפי תחום</CardTitle>
          </CardHeader>
          <CardBody>
            {byProfession.length === 0 ? (
              <p className="text-sm text-ink-400">אין עדיין עבודות היום</p>
            ) : (
              <div className="space-y-3">
                {byProfession.map((row) => (
                  <BreakdownRow key={row.profession_id} label={row.profession_name} count={row.jobs_count} closed={row.closed_success} revenue={row.revenue_agorot} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>עבודות היום לפי עיר</CardTitle>
          </CardHeader>
          <CardBody>
            {byCity.length === 0 ? (
              <p className="text-sm text-ink-400">אין עדיין עבודות היום</p>
            ) : (
              <div className="space-y-3">
                {byCity.map((row) => (
                  <BreakdownRow key={row.city_id} label={row.city_name} count={row.jobs_count} closed={row.closed_success} revenue={row.revenue_agorot} />
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href="/analytics" className="card flex items-center justify-between p-4 hover:shadow-card-hover">
          <span className="font-bold text-ink-800">אנליטיקס מלא</span>
          <ArrowLeft className="h-4 w-4 text-ink-400" />
        </Link>
        <Link href="/leaderboard" className="card flex items-center justify-between p-4 hover:shadow-card-hover">
          <span className="font-bold text-ink-800">דירוג קבלנים</span>
          <ArrowLeft className="h-4 w-4 text-ink-400" />
        </Link>
        <Link href="/daily-summary" className="card flex items-center justify-between p-4 hover:shadow-card-hover">
          <span className="font-bold text-ink-800">סיכום יומי</span>
          <ArrowLeft className="h-4 w-4 text-ink-400" />
        </Link>
      </div>
    </div>
  );
}

function BreakdownRow({ label, count, closed, revenue }: { label: string; count: number; closed: number; revenue: number }) {
  const rate = count > 0 ? (closed / count) * 100 : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-ink-800">{label}</span>
        <span className="text-ink-500">
          {count} עבודות · {formatAgorot(revenue)}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-100">
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
    </div>
  );
}
