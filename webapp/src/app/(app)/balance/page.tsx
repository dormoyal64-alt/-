"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendingDown, TrendingUp, Scale, Receipt as ReceiptIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { PageSpinner } from "@/components/ui/Misc";
import { useAutoRefresh } from "@/hooks/useAutoRefresh";
import { formatAgorot, titheLabel } from "@/lib/money";
import { useRefData } from "@/lib/refdata";
import { customDateRange, getPeriodRange, isoRange, formatDateHe, todayLocalDate, type PeriodKey } from "@/lib/dates";
import type { MoneyReport } from "@/lib/types";

function Row({ label, agorot, hint, tone = "plain" }: {
  label: string;
  agorot: number;
  hint?: string;
  tone?: "plain" | "cost";
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="text-sm text-ink-600">
        {label}
        {hint && <span className="block text-xs text-ink-400">{hint}</span>}
      </span>
      <span className={`whitespace-nowrap font-bold tabular-nums ${tone === "cost" ? "text-danger-600" : "text-ink-900"}`}>
        {tone === "cost" ? `-${formatAgorot(agorot)}` : formatAgorot(agorot)}
      </span>
    </div>
  );
}

export default function BalancePage() {
  const { settings } = useRefData();
  const supabase = useMemo(() => createClient(), []);
  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState(todayLocalDate());
  const [customTo, setCustomTo] = useState(todayLocalDate());
  const [report, setReport] = useState<MoneyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const range = period === "custom" ? customDateRange(customFrom, customTo) : getPeriodRange(period);
  const rangeIso = isoRange(range);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data } = await supabase.rpc("money_report", { p_from: rangeIso.from, p_to: rangeIso.to });
      setReport(((data as MoneyReport[] | null) ?? [])[0] ?? null);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeIso.from, rangeIso.to, reloadKey]);

  useAutoRefresh(() => setReloadKey((k) => k + 1));

  const r = report;
  const net = r?.net_agorot ?? 0;
  const noReceipt = (r?.revenue_agorot ?? 0) - (r?.revenue_with_receipt_agorot ?? 0);

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">מאזן</h1>
        <p className="text-sm text-ink-500">
          {formatDateHe(range.from)} — {formatDateHe(range.to)}
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

      {loading ? (
        <PageSpinner />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Card className="border-2 border-success-100 bg-success-50/40">
              <CardBody>
                <p className="flex items-center gap-1.5 text-sm font-bold text-success-700">
                  <TrendingUp className="h-4 w-4" /> נכנס
                </p>
                <p className="mt-1 text-3xl font-extrabold text-ink-900">{formatAgorot(r?.revenue_agorot)}</p>
                <p className="mt-0.5 text-xs text-ink-500">{r?.jobs_closed ?? 0} עבודות שנסגרו בהצלחה</p>
              </CardBody>
            </Card>
            <Card className="border-2 border-danger-100 bg-danger-50/40">
              <CardBody>
                <p className="flex items-center gap-1.5 text-sm font-bold text-danger-600">
                  <TrendingDown className="h-4 w-4" /> יצא
                </p>
                <p className="mt-1 text-3xl font-extrabold text-ink-900">{formatAgorot(r?.total_costs_agorot)}</p>
                <p className="mt-0.5 text-xs text-ink-500">כולל מס, פרסום והוצאות קבועות</p>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-ink-400" /> פירוט מלא
              </CardTitle>
            </CardHeader>
            <CardBody className="text-sm">
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-400">נכנס</p>
              <Row label="מחזור מעבודות שנסגרו" agorot={r?.revenue_agorot ?? 0} />

              <p className="mb-1 mt-4 text-xs font-bold uppercase tracking-wide text-ink-400">יצא</p>
              <Row label="שולם לקבלנים" agorot={r?.contractor_paid_agorot ?? 0} tone="cost" />
              <Row label="עמלות לחברות מפנות" agorot={r?.referral_agorot ?? 0} tone="cost" />
              <Row label="דלק" agorot={r?.fuel_agorot ?? 0} tone="cost" />
              <Row label="עובדים" agorot={r?.helper_agorot ?? 0} tone="cost" />
              <Row
                label="הוצאות על העבודות"
                agorot={r?.job_expenses_agorot ?? 0}
                tone="cost"
                hint="חלקים, ציוד, חניה — מה שנרשם בתוך כל עבודה"
              />
              <Row label="פרסום" agorot={r?.ad_spend_agorot ?? 0} tone="cost" hint="החלק היחסי לתקופה שנבחרה" />
              <Row
                label="הוצאות קבועות"
                agorot={r?.business_expenses_agorot ?? 0}
                tone="cost"
                hint="רואה חשבון, ביטוח, שכירות וכו׳"
              />
              <Row
                label="מס"
                agorot={r?.tax_agorot ?? 0}
                tone="cost"
                hint={`רק על ${r?.jobs_with_receipt ?? 0} עבודות שנסגרו עם קבלה`}
              />

              {!!r?.tithe_agorot && (
                <>
                  <div className="mt-2 flex items-center justify-between border-t border-ink-100 pt-2">
                    <span className="font-bold text-ink-700">רווח לפני הפרשה</span>
                    <span className="font-extrabold tabular-nums text-ink-900">
                      {formatAgorot(r.net_before_tithe_agorot)}
                    </span>
                  </div>
                  <Row
                    label={titheLabel(settings?.tithe_pct)}
                    agorot={r.tithe_agorot}
                    tone="cost"
                    hint={
                      settings?.tithe_basis === "revenue"
                        ? "מחושב מתוך המחזור"
                        : "מחושב מתוך הרווח, אחרי כל ההוצאות"
                    }
                  />
                </>
              )}

              <div className="mt-2 flex items-center justify-between border-t border-ink-100 pt-2">
                <span className="font-bold text-ink-700">סך ההוצאות</span>
                <span className="font-extrabold tabular-nums text-danger-600">
                  -{formatAgorot(r?.total_costs_agorot)}
                </span>
              </div>

              <div className="mt-3 flex items-center justify-between rounded-xl bg-ink-50 px-4 py-3">
                <span className="text-base font-extrabold text-ink-900">נשאר לחברה</span>
                <span
                  className={`text-2xl font-extrabold tabular-nums ${net < 0 ? "text-danger-600" : "text-success-600"}`}
                >
                  {formatAgorot(net)}
                </span>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ReceiptIcon className="h-5 w-5 text-ink-400" /> קבלות ומס
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-1.5 text-sm">
              <Row
                label={`${r?.jobs_with_receipt ?? 0} עבודות נסגרו עם קבלה`}
                agorot={r?.revenue_with_receipt_agorot ?? 0}
              />
              <Row
                label={`${(r?.jobs_closed ?? 0) - (r?.jobs_with_receipt ?? 0)} עבודות נסגרו בלי קבלה`}
                agorot={noReceipt}
              />
              <p className="pt-1.5 text-xs text-ink-400">
                המס מחושב רק על עבודות שנסגרו עם קבלה, ונשמר על כל עבודה במחיר שהיה בזמן הסגירה.
                חישוב לניהול פנימי — לא דיווח רשמי.
              </p>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  );
}
