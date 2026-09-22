"use client";

import { useEffect, useMemo, useState } from "react";
import { Briefcase, Building2, Fuel, Megaphone, Users, Wrench } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { formatAgorot, titheLabel } from "@/lib/money";
import { useRefData } from "@/lib/refdata";
import { customDateRange, getPeriodRange, isoRange, type PeriodKey } from "@/lib/dates";
import type { AdPerformanceRow, ProfitReport } from "@/lib/types";

/** One line of a money breakdown. Costs are shown as what they take away. */
function Line({
  label,
  agorot,
  kind = "plain",
  hint,
}: {
  label: string;
  agorot: number;
  kind?: "plain" | "cost" | "total";
  hint?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 py-1.5 ${kind === "total" ? "border-t border-ink-100 pt-2.5" : ""}`}>
      <span className={kind === "total" ? "font-bold text-ink-800" : "text-sm text-ink-500"}>
        {label}
        {hint && <span className="block text-xs text-ink-400">{hint}</span>}
      </span>
      <span
        data-line={label}
        className={`whitespace-nowrap font-extrabold tabular-nums ${
          kind === "cost" ? "text-danger-600" : kind === "total" ? "text-success-700" : "text-ink-900"
        }`}
      >
        {kind === "cost" ? `-${formatAgorot(agorot)}` : formatAgorot(agorot)}
      </span>
    </div>
  );
}

export default function ProfitPage() {
  const { settings } = useRefData();
  const supabase = useMemo(() => createClient(), []);
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [channels, setChannels] = useState<AdPerformanceRow[]>([]);
  const [loading, setLoading] = useState(true);

  const range = period === "custom" ? customDateRange(customFrom, customTo) : getPeriodRange(period);
  const rangeIso = isoRange(range);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [p, a] = await Promise.all([
        supabase.rpc("profit_report", { p_from: rangeIso.from, p_to: rangeIso.to }),
        supabase.rpc("ad_performance", { p_from: rangeIso.from, p_to: rangeIso.to }),
      ]);
      setReport((p.data as ProfitReport[] | null)?.[0] ?? null);
      setChannels((a.data as AdPerformanceRow[]) ?? []);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeIso.from, rangeIso.to]);

  const r = report;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">רווח נקי</h1>
        <p className="text-sm text-ink-500">
          כמה נשאר בכיס אחרי דלק, עובדים ופרסום — בנפרד לעבודות שלכם ולעבודות של הקבלנים
        </p>
      </div>

      <PeriodPicker
        period={period}
        onChange={setPeriod}
        customFrom={customFrom}
        customTo={customTo}
        onCustomFromChange={setCustomFrom}
        onCustomToChange={setCustomTo}
      />

      {loading || !r ? (
        <Card>
          <CardBody className="text-sm text-ink-400">טוען...</CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Card>
              <CardBody className="text-center">
                <p className="text-xs font-bold text-ink-400">עבודות שביצעתי בעצמי</p>
                <p className="mt-1 text-2xl font-extrabold text-ink-900">{r.self_jobs}</p>
              </CardBody>
            </Card>
            <Card>
              <CardBody className="text-center">
                <p className="text-xs font-bold text-ink-400">עבודות שקבלנים ביצעו</p>
                <p className="mt-1 text-2xl font-extrabold text-ink-900">{r.contractor_jobs}</p>
              </CardBody>
            </Card>
            <Card className="border-success-100 bg-success-50">
              <CardBody className="text-center">
                <p className="text-xs font-bold text-success-700">רווח נקי בתקופה</p>
                <p className="mt-1 text-2xl font-extrabold text-success-700">{formatAgorot(r.net_profit_agorot)}</p>
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <Wrench className="h-4 w-4 text-brand-600" /> מה הרווחתי מהעבודות שלי
                  </span>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <Line label={`הכנסות מ-${r.self_jobs} עבודות`} agorot={r.self_revenue_agorot} />
                {r.self_referral_agorot > 0 && (
                  <Line label="לחברות שהפנו" agorot={r.self_referral_agorot} kind="cost" />
                )}
                <Line label="דלק" agorot={r.self_fuel_agorot} kind="cost" />
                <Line label="עובדים ששילמתי להם" agorot={r.self_helper_agorot} kind="cost" />
                {r.self_expenses_agorot > 0 && (
                  <Line label="הוצאות על העבודות" agorot={r.self_expenses_agorot} kind="cost" hint="חלקים, ציוד, חניה — מה שנרשם בתוך כל עבודה" />
                )}
                <Line
                  label="פרסום (חלק יחסי)"
                  agorot={r.ad_spend_self_agorot}
                  kind="cost"
                  hint="הפרסום מחולק בין שני הסוגים לפי מספר העבודות"
                />
                <Line label="נשאר לי" agorot={r.self_net_agorot} kind="total" />
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>
                  <span className="flex items-center gap-2">
                    <Briefcase className="h-4 w-4 text-brand-600" /> מה הרווחתי מהקבלנים
                  </span>
                </CardTitle>
              </CardHeader>
              <CardBody>
                <Line label={`מחזור מ-${r.contractor_jobs} עבודות`} agorot={r.contractor_revenue_agorot} />
                {r.contractor_referral_agorot > 0 && (
                  <Line label="לחברות שהפנו" agorot={r.contractor_referral_agorot} kind="cost" />
                )}
                <Line label="שולם לקבלנים" agorot={r.contractor_paid_agorot} kind="cost" />
                {r.contractor_expenses_agorot > 0 && (
                  <Line label="הוצאות על העבודות" agorot={r.contractor_expenses_agorot} kind="cost" />
                )}
                <Line
                  label="פרסום (חלק יחסי)"
                  agorot={r.ad_spend_contractor_agorot}
                  kind="cost"
                  hint="הפרסום מחולק בין שני הסוגים לפי מספר העבודות"
                />
                <Line label="נשאר לי" agorot={r.contractor_net_agorot} kind="total" />
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>סיכום התקופה</CardTitle>
            </CardHeader>
            <CardBody>
              <Line label="רווח מהעבודות שלי" agorot={r.self_net_agorot} />
              <Line label="רווח מהקבלנים" agorot={r.contractor_net_agorot} />
              {r.business_expenses_agorot > 0 && (
                <Line label="הוצאות קבועות" agorot={r.business_expenses_agorot} kind="cost" hint="רואה חשבון, ביטוח, שכירות — לפי החלק שנופל בתקופה" />
              )}
              {r.tax_agorot > 0 && (
                <Line label="מס (עבודות שנסגרו עם קבלה)" agorot={r.tax_agorot} kind="cost" />
              )}
              {r.tithe_agorot > 0 && (
                <>
                  <Line label="רווח לפני הפרשה" agorot={r.net_before_tithe_agorot} />
                  <Line label={titheLabel(settings?.tithe_pct)} agorot={r.tithe_agorot} kind="cost" />
                </>
              )}
              <Line label="רווח נקי" agorot={r.net_profit_agorot} kind="total" />
              <div className="mt-3 flex flex-wrap gap-4 border-t border-ink-100 pt-3 text-xs text-ink-400">
                <span className="flex items-center gap-1.5">
                  <Fuel className="h-3.5 w-3.5" /> דלק {formatAgorot(r.self_fuel_agorot)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" /> עובדים {formatAgorot(r.self_helper_agorot)}
                </span>
                <span className="flex items-center gap-1.5">
                  <Megaphone className="h-3.5 w-3.5" /> פרסום {formatAgorot(r.ad_spend_agorot)}
                </span>
                {r.referral_agorot > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5" /> לחברות {formatAgorot(r.referral_agorot)}
                  </span>
                )}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                <span className="flex items-center gap-2">
                  <Megaphone className="h-4 w-4 text-brand-600" /> האם הפרסום מחזיר את עצמו?
                </span>
              </CardTitle>
            </CardHeader>
            <CardBody className="p-0">
              {channels.length === 0 ? (
                <p className="p-4 text-sm text-ink-400">אין נתוני פרסום או עבודות בתקופה הזו</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-ink-100 text-xs font-bold text-ink-400">
                        <th className="p-3 text-start">ערוץ</th>
                        <th className="p-3 text-start">הוצאה</th>
                        <th className="p-3 text-start">עבודות</th>
                        <th className="p-3 text-start">נשאר לי</th>
                        <th className="p-3 text-start">רווח מהערוץ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {channels.map((c) => {
                        const net = c.business_share_agorot - c.spend_agorot;
                        return (
                          <tr key={c.lead_source_name} className="border-b border-ink-50 last:border-0">
                            <td className="p-3 font-bold text-ink-800">{c.lead_source_name}</td>
                            <td className="p-3 tabular-nums text-ink-600">{formatAgorot(c.spend_agorot)}</td>
                            <td className="p-3 tabular-nums text-ink-600">{c.jobs_closed}</td>
                            <td className="p-3 tabular-nums text-ink-600">{formatAgorot(c.business_share_agorot)}</td>
                            <td
                              className={`p-3 font-extrabold tabular-nums ${
                                net >= 0 ? "text-success-700" : "text-danger-600"
                              }`}
                            >
                              {formatAgorot(net)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
