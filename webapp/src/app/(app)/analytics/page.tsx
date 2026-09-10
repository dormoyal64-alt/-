"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Download, TrendingUp, Wallet, Percent, Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { PageSpinner } from "@/components/ui/Misc";
import { formatAgorot, formatAgorotCompact, formatNumber, formatPercent } from "@/lib/money";
import { getPeriodRange, isoRange, customDateRange, type PeriodKey } from "@/lib/dates";
import { toCsv, downloadCsv } from "@/lib/csv";
import type {
  CityStatsRow,
  ContractorStatsRow,
  DayStatsRow,
  LeadSourceStatsRow,
  PeriodTotalsRow,
  ProfessionStatsRow,
} from "@/lib/types";

const COLORS = ["#4650e6", "#10b981", "#f59e0b", "#06b6d4", "#8b5cf6", "#ef4444", "#f97316", "#64748b"];

export default function AnalyticsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { contractors } = useRefData();

  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);

  const [totals, setTotals] = useState<PeriodTotalsRow | null>(null);
  const [byDay, setByDay] = useState<DayStatsRow[]>([]);
  const [byProfession, setByProfession] = useState<ProfessionStatsRow[]>([]);
  const [byCity, setByCity] = useState<CityStatsRow[]>([]);
  const [byLeadSource, setByLeadSource] = useState<LeadSourceStatsRow[]>([]);
  const [byContractor, setByContractor] = useState<ContractorStatsRow[]>([]);

  const range = period === "custom" ? customDateRange(customFrom, customTo) : getPeriodRange(period);
  const rangeIso = isoRange(range);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [t, d, p, c, ls, con] = await Promise.all([
        supabase.rpc("period_totals", { p_from: rangeIso.from, p_to: rangeIso.to }),
        supabase.rpc("stats_by_day", { p_from: rangeIso.from, p_to: rangeIso.to }),
        supabase.rpc("stats_by_profession", { p_from: rangeIso.from, p_to: rangeIso.to }),
        supabase.rpc("stats_by_city", { p_from: rangeIso.from, p_to: rangeIso.to }),
        supabase.rpc("stats_by_lead_source", { p_from: rangeIso.from, p_to: rangeIso.to }),
        supabase.rpc("contractor_stats", { p_from: rangeIso.from, p_to: rangeIso.to }),
      ]);
      setTotals((t.data as PeriodTotalsRow[] | null)?.[0] ?? null);
      setByDay((d.data as DayStatsRow[]) ?? []);
      setByProfession(((p.data as ProfessionStatsRow[]) ?? []).filter((r) => r.jobs_count > 0));
      setByCity(((c.data as CityStatsRow[]) ?? []).filter((r) => r.jobs_count > 0));
      setByLeadSource(((ls.data as LeadSourceStatsRow[]) ?? []).filter((r) => r.jobs_count > 0));
      setByContractor((((con.data as ContractorStatsRow[]) ?? []).filter((r) => r.jobs_sent > 0)));
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo]);

  function handleExport() {
    downloadCsv(
      `analytics-by-profession-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(
        byProfession.map((r) => ({
          profession: r.profession_name,
          jobs_count: r.jobs_count,
          closed_success: r.closed_success,
          revenue: (r.revenue_agorot / 100).toFixed(2),
          profit: (r.profit_agorot / 100).toFixed(2),
        }))
      )
    );
  }

  const contractorChartData = byContractor
    .map((r) => ({ name: contractors.find((c) => c.id === r.contractor_id)?.name ?? "?", jobs: r.jobs_sent, closed: r.jobs_closed_success }))
    .sort((a, b) => b.jobs - a.jobs)
    .slice(0, 8);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">אנליטיקס</h1>
          <p className="text-sm text-ink-500">ניתוח ביצועים מלא לפי תקופה</p>
        </div>
        <Button variant="secondary" onClick={handleExport}>
          <Download className="h-4 w-4" /> ייצוא CSV
        </Button>
      </div>

      <PeriodPicker period={period} onChange={setPeriod} customFrom={customFrom} customTo={customTo} onCustomFromChange={setCustomFrom} onCustomToChange={setCustomTo} />

      {loading ? (
        <PageSpinner />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="סה״כ עבודות" value={formatNumber(totals?.jobs_count)} icon={Receipt} />
            <StatCard label="אחוז סגירה" value={formatPercent(totals?.close_rate ?? 0)} icon={Percent} tone="success" />
            <StatCard label="מחזור כולל" value={formatAgorot(totals?.revenue_agorot)} icon={Wallet} />
            <StatCard label="רווח שלי" value={formatAgorot(totals?.profit_agorot)} icon={TrendingUp} tone="success" />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>מגמה לאורך זמן</CardTitle>
            </CardHeader>
            <CardBody className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={byDay} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4650e6" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="#4650e6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v) => v?.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(value: number, name: string) => (name === "revenue_agorot" ? formatAgorot(value) : value)}
                    labelFormatter={(l) => `תאריך: ${l}`}
                  />
                  <Area type="monotone" dataKey="jobs_count" name="עבודות" stroke="#4650e6" fill="url(#colorRevenue)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <ChartCard title="עבודות לפי תחום">
              <BarChart data={byProfession} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="profession_name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="jobs_count" name="עבודות" fill="#4650e6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="closed_success" name="נסגרו" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="עבודות לפי עיר">
              <BarChart data={byCity} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="city_name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="jobs_count" name="עבודות" fill="#06b6d4" radius={[6, 6, 0, 0]} />
                <Bar dataKey="closed_success" name="נסגרו" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="הכנסות לפי תחום">
              <BarChart data={byProfession} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="profession_name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatAgorotCompact(v)} width={46} />
                <Tooltip formatter={(v: number) => formatAgorot(v)} />
                <Bar dataKey="revenue_agorot" name="הכנסות" fill="#4650e6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="הכנסות לפי עיר">
              <BarChart data={byCity} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="city_name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatAgorotCompact(v)} width={46} />
                <Tooltip formatter={(v: number) => formatAgorot(v)} />
                <Bar dataKey="revenue_agorot" name="הכנסות" fill="#06b6d4" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartCard>

            <ChartCard title="עבודות לפי קבלן (טופ 8)">
              <BarChart data={contractorChartData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eef0f4" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="jobs" name="נשלחו" fill="#8b5cf6" radius={[6, 6, 0, 0]} />
                <Bar dataKey="closed" name="נסגרו" fill="#10b981" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ChartCard>

            <Card>
              <CardHeader>
                <CardTitle>מקורות ליד</CardTitle>
              </CardHeader>
              <CardBody className="h-72">
                {byLeadSource.length === 0 ? (
                  <p className="pt-8 text-center text-sm text-ink-400">אין נתוני מקור ליד בטווח זה</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={byLeadSource} dataKey="jobs_count" nameKey="lead_source_name" innerRadius={45} outerRadius={72} paddingAngle={2}>
                        {byLeadSource.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend
                        verticalAlign="bottom"
                        height={48}
                        iconType="circle"
                        iconSize={8}
                        formatter={(value: string) => <span className="text-xs text-ink-600">{value}</span>}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </CardBody>
    </Card>
  );
}
