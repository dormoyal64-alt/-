"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Lightbulb, CalendarDays, Megaphone } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { DailyAdSpend } from "@/components/ads/DailyAdSpend";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { Input } from "@/components/ui/Input";
import { PageSpinner } from "@/components/ui/Misc";
import { formatAgorot, formatPercent, titheLabel } from "@/lib/money";
import { startOfDay, endOfDay, formatDateHe, last7Days, todayLocalDate, getPeriodRange, isoRange, type PeriodKey, type DateRange } from "@/lib/dates";
import type { CityStatsRow, ContractorStatsRow, ProfessionStatsRow } from "@/lib/types";

export interface DailyMoneyRow {
  jobs_opened: number;
  jobs_closed: number;
  revenue_agorot: number;
  contractor_paid_agorot: number;
  referral_agorot: number;
  fuel_agorot: number;
  helper_agorot: number;
  gross_agorot: number;
  ad_spend_agorot: number;
  net_agorot: number;
  cost_per_lead_agorot: number;
  expenses_agorot: number;
  tax_agorot: number;
  job_expenses_agorot: number;
  tithe_agorot: number;
  net_before_tithe_agorot: number;
}

interface ComboRow {
  professionName: string;
  cityName: string;
  count: number;
  closed: number;
}

export default function DailySummaryPage() {
  const supabase = useMemo(() => createClient(), []);
  const { professions, cities, contractors, jobStatuses, settings } = useRefData();

  const [period, setPeriod] = useState<PeriodKey>("today");
  const [date, setDate] = useState(todayLocalDate());
  const [customFrom, setCustomFrom] = useState(todayLocalDate());
  const [customTo, setCustomTo] = useState(todayLocalDate());
  const [byProfession, setByProfession] = useState<ProfessionStatsRow[]>([]);
  const [byCity, setByCity] = useState<CityStatsRow[]>([]);
  const [byContractor, setByContractor] = useState<ContractorStatsRow[]>([]);
  const [weekTopContractor, setWeekTopContractor] = useState<{ name: string; rate: number } | null>(null);
  const [combos, setCombos] = useState<ComboRow[]>([]);
  const [money, setMoney] = useState<DailyMoneyRow | null>(null);
  const [moneyKey, setMoneyKey] = useState(0);
  const [loading, setLoading] = useState(true);

  // "today" keeps its own date box so an earlier day can be looked at; the other
  // periods are worked out from the clock.
  const range: DateRange = useMemo(() => {
    if (period === "today") return { from: startOfDay(new Date(date)), to: endOfDay(new Date(date)) };
    if (period === "custom") {
      return { from: startOfDay(new Date(customFrom)), to: endOfDay(new Date(customTo)) };
    }
    return getPeriodRange(period);
  }, [period, date, customFrom, customTo]);

  const rangeIso = useMemo(() => isoRange(range), [range]);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const dayFrom = rangeIso.from;
      const dayTo = rangeIso.to;
      const weekFrom = last7Days().toISOString();
      const weekTo = new Date().toISOString();

      const [p, c, con, weekCon, comboJobs, moneyRes] = await Promise.all([
        supabase.rpc("stats_by_profession", { p_from: dayFrom, p_to: dayTo }),
        supabase.rpc("stats_by_city", { p_from: dayFrom, p_to: dayTo }),
        supabase.rpc("contractor_stats", { p_from: dayFrom, p_to: dayTo }),
        supabase.rpc("contractor_stats", { p_from: weekFrom, p_to: weekTo }),
        supabase.from("jobs").select("profession_id, city_id, status_id").gte("opened_at", dayFrom).lte("opened_at", dayTo),
        supabase.rpc("range_money", { p_from: dayFrom, p_to: dayTo }),
      ]);

      setMoney(((moneyRes.data as DailyMoneyRow[] | null) ?? [])[0] ?? null);

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
  }, [rangeIso.from, rangeIso.to, jobStatuses.length, moneyKey]);

  useAutoRefresh(() => setMoneyKey((k) => k + 1));

  const periodNoun =
    period === "today" ? "היום" :
    period === "week" ? "השבוע" :
    period === "month" ? "החודש" :
    period === "year" ? "השנה" : "בטווח";
  const periodTitle =
    period === "today" ? `סיכום יומי · ${formatDateHe(date)}` :
    period === "week" ? "סיכום שבועי" :
    period === "month" ? "סיכום חודשי" :
    period === "year" ? "סיכום שנתי" :
    `${formatDateHe(customFrom)} — ${formatDateHe(customTo)}`;
  const rangeSubtitle =
    period === "today" ? formatDateHe(date) : `${formatDateHe(range.from)} — ${formatDateHe(range.to)}`;

  const insights = useMemo(() => {
    const list: string[] = [];
    for (const combo of combos) {
      if (combo.count < 3) continue;
      const rate = (combo.closed / combo.count) * 100;
      if (rate >= 70) {
        list.push(`${periodNoun} תחום ${combo.professionName} ב${combo.cityName} קיבל ${combo.count} עבודות וסגר ${combo.closed} – ${rate.toFixed(0)}% סגירה. ביצועים מצוינים!`);
      } else if (rate <= 30) {
        list.push(`${combo.professionName} ב${combo.cityName} קיבלה ${combo.count} עבודות אבל סגרה רק ${combo.closed} – מומלץ לבדוק את איכות הלידים או הקבלנים באזור.`);
      }
    }
    if (weekTopContractor) {
      list.push(`${weekTopContractor.name} הוא הקבלן בעל אחוז הסגירה הגבוה ביותר השבוע (${weekTopContractor.rate.toFixed(0)}%).`);
    }
    if (money && money.ad_spend_agorot > 0 && money.jobs_opened > 0) {
      list.push(
        `הפרסום ${periodNoun} עלה ${formatAgorot(money.ad_spend_agorot)} והביא ${money.jobs_opened} פניות — ` +
          `${formatAgorot(money.cost_per_lead_agorot)} לפנייה.`
      );
      if (money.net_agorot < 0) {
        list.push(
          `אחרי הפרסום ${periodNoun} בהפסד של ${formatAgorot(Math.abs(money.net_agorot))}. ` +
            "שווה לבדוק אם הערוץ מחזיר את ההשקעה."
        );
      }
    }
    const totalJobs = byProfession.reduce((s, r) => s + r.jobs_count, 0);
    if (totalJobs === 0) {
      list.push(period === "today" ? "לא נפתחו עבודות ביום זה." : "לא נפתחו עבודות בתקופה זו.");
    }
    return list;
  }, [combos, weekTopContractor, byProfession, money, period, periodNoun]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">{periodTitle}</h1>
          <p className="text-sm text-ink-500">{rangeSubtitle}</p>
        </div>
        {period === "today" && (
          <div className="relative">
            <CalendarDays className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-auto pr-10" />
          </div>
        )}
      </div>

      <PeriodPicker
        period={period}
        onChange={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      {loading ? (
        <PageSpinner />
      ) : (
        <>
          {period === "today" ? (
            <DailyAdSpend day={date} onSaved={() => setMoneyKey((k) => k + 1)} />
          ) : (
            <p className="text-xs text-ink-400">
              סכום הפרסום מוזן ליום בודד. לפילוח לפי ערוצים ולעריכת ימים אחרים — מסך{" "}
              <Link href="/advertising" className="font-semibold text-brand-600 hover:underline">
                הוצאות פרסום
              </Link>
              .
            </p>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-ink-400" /> הכסף של {periodNoun}
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-1.5 text-sm">
              <MoneyRow label={`מחזור מ-${money?.jobs_closed ?? 0} עבודות שנסגרו`} value={formatAgorot(money?.revenue_agorot)} />
              <MoneyRow label="שולם לקבלנים" value={`-${formatAgorot(money?.contractor_paid_agorot)}`} negative />
              <MoneyRow label="עמלות לחברות מפנות" value={`-${formatAgorot(money?.referral_agorot)}`} negative />
              <MoneyRow label="דלק" value={`-${formatAgorot(money?.fuel_agorot)}`} negative />
              <MoneyRow label="עובדים" value={`-${formatAgorot(money?.helper_agorot)}`} negative />
              {!!money?.job_expenses_agorot && (
                <MoneyRow label="הוצאות על העבודות" value={`-${formatAgorot(money.job_expenses_agorot)}`} negative />
              )}
              <div className="border-t border-ink-100 pt-1.5">
                <MoneyRow label="לפני פרסום" value={formatAgorot(money?.gross_agorot)} />
              </div>
              <MoneyRow label="פרסום" value={`-${formatAgorot(money?.ad_spend_agorot)}`} negative />
              {!!money?.expenses_agorot && (
                <MoneyRow label="הוצאות קבועות" value={`-${formatAgorot(money.expenses_agorot)}`} negative />
              )}
              {!!money?.tax_agorot && (
                <MoneyRow label="מס" value={`-${formatAgorot(money.tax_agorot)}`} negative />
              )}
              {!!money?.tithe_agorot && (
                <>
                  <div className="border-t border-ink-100 pt-1.5">
                    <MoneyRow label="רווח לפני הפרשה" value={formatAgorot(money.net_before_tithe_agorot)} />
                  </div>
                  <MoneyRow
                    label={titheLabel(settings?.tithe_pct)}
                    value={`-${formatAgorot(money.tithe_agorot)}`}
                    negative
                  />
                </>
              )}
              <div className="border-t-2 border-ink-200 pt-2">
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-ink-900">הרווח האמיתי {periodNoun}</span>
                  <span
                    className={`text-lg font-extrabold ${
                      (money?.net_agorot ?? 0) < 0 ? "text-danger-600" : "text-success-600"
                    }`}
                  >
                    {formatAgorot(money?.net_agorot)}
                  </span>
                </div>
              </div>
              {!!money?.jobs_opened && (
                <p className="pt-1 text-xs text-ink-400">
                  {money.jobs_opened} פניות נפתחו {periodNoun} · {formatAgorot(money.cost_per_lead_agorot)} עלות פרסום לפנייה
                </p>
              )}
            </CardBody>
          </Card>

          <Card className="border-2 border-brand-100 bg-brand-50/40">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lightbulb className="h-5 w-5 text-brand-600" /> תובנות אוטומטיות
              </CardTitle>
            </CardHeader>
            <CardBody>
              {insights.length === 0 ? (
                <p className="text-sm text-ink-500">אין מספיק נתונים להפקת תובנות עבור התקופה שנבחרה.</p>
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

function MoneyRow({ label, value, negative }: { label: string; value: string; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-600">{label}</span>
      <span className={`font-bold ${negative ? "text-danger-600" : "text-ink-900"}`}>{value}</span>
    </div>
  );
}
