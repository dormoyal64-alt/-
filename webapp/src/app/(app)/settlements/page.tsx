"use client";

import { useEffect, useMemo, useState } from "react";
import { Wallet, CheckCircle2, Download, History } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PeriodPicker } from "@/components/ui/PeriodPicker";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { EmptyState, PageSpinner } from "@/components/ui/Misc";
import { formatAgorot } from "@/lib/money";
import { getPeriodRange, isoRange, customDateRange, formatDateHe, type PeriodKey } from "@/lib/dates";
import { fetchUnsettledByContractor, settleContractor, type UnsettledSummary } from "@/lib/api/settlements";
import { toCsv, downloadCsv } from "@/lib/csv";
import type { Settlement } from "@/lib/types";

export default function SettlementsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { contractors } = useRefData();
  const toast = useToast();

  const [period, setPeriod] = useState<PeriodKey>("month");
  const [customFrom, setCustomFrom] = useState(new Date().toISOString().slice(0, 10));
  const [customTo, setCustomTo] = useState(new Date().toISOString().slice(0, 10));
  const [tab, setTab] = useState<"open" | "history">("open");

  const [unsettled, setUnsettled] = useState<Record<string, UnsettledSummary>>({});
  const [history, setHistory] = useState<(Settlement & { contractor_name?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [settling, setSettling] = useState(false);

  const range = period === "custom" ? customDateRange(customFrom, customTo) : getPeriodRange(period);
  const rangeIso = isoRange(range);

  async function load() {
    setLoading(true);
    const [unsettledMap, historyRes] = await Promise.all([
      fetchUnsettledByContractor(supabase, rangeIso.from, rangeIso.to),
      supabase
        .from("settlements")
        .select("*, contractor:contractors(name)")
        .order("created_at", { ascending: false })
        .limit(100),
    ]);
    setUnsettled(unsettledMap);
    setHistory(
      ((historyRes.data as any[]) ?? []).map((s) => ({ ...s, contractor_name: s.contractor?.name }))
    );
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, customFrom, customTo]);

  async function handleSettle(contractorId: string) {
    setSettling(true);
    try {
      await settleContractor(supabase, contractorId, rangeIso.from, rangeIso.to);
      toast.success("ההתחשבנות סומנה כשולמה");
      setConfirmId(null);
      await load();
    } catch (e: any) {
      toast.error(e?.message?.includes("אין עבודות") ? e.message : "שגיאה בביצוע ההתחשבנות");
    } finally {
      setSettling(false);
    }
  }

  function handleExport() {
    const rows = contractors.map((c) => {
      const s = unsettled[c.id];
      return {
        contractor: c.name,
        jobs_count: s?.jobsCount ?? 0,
        total_revenue: formatAgorot(s?.totalRevenueAgorot ?? 0),
        contractor_share: formatAgorot(s?.contractorShareAgorot ?? 0),
        business_share: formatAgorot(s?.businessShareAgorot ?? 0),
        contractor_owes_business: formatAgorot(s?.contractorOwesBusinessAgorot ?? 0),
        business_owes_contractor: formatAgorot(s?.businessOwesContractorAgorot ?? 0),
      };
    });
    downloadCsv(`settlements-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  }

  const rows = contractors
    .map((c) => ({ contractor: c, summary: unsettled[c.id] }))
    .filter((r) => r.summary && r.summary.jobsCount > 0);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">התחשבנות</h1>
          <p className="text-sm text-ink-500">ניהול חובות והתחשבנויות מול קבלנים</p>
        </div>
        <Button variant="secondary" onClick={handleExport}>
          <Download className="h-4 w-4" /> ייצוא CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodPicker period={period} onChange={setPeriod} customFrom={customFrom} customTo={customTo} onCustomFromChange={setCustomFrom} onCustomToChange={setCustomTo} />
        <div className="flex overflow-hidden rounded-xl border border-ink-200">
          <button onClick={() => setTab("open")} className={`px-4 py-2 text-sm font-bold ${tab === "open" ? "bg-brand-600 text-white" : "text-ink-600"}`}>
            יתרות פתוחות
          </button>
          <button onClick={() => setTab("history")} className={`px-4 py-2 text-sm font-bold ${tab === "history" ? "bg-brand-600 text-white" : "text-ink-600"}`}>
            <History className="ml-1 inline h-3.5 w-3.5" /> היסטוריה
          </button>
        </div>
      </div>

      {loading ? (
        <PageSpinner />
      ) : tab === "open" ? (
        rows.length === 0 ? (
          <EmptyState icon={Wallet} title="אין יתרות פתוחות בטווח שנבחר" />
        ) : (
          <div className="space-y-3">
            {rows.map(({ contractor, summary }) => (
              <Card key={contractor.id}>
                <CardBody className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="font-bold text-ink-900">{contractor.name}</p>
                    <span className="badge bg-ink-100 text-ink-600">{summary!.jobsCount} עבודות</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Mini label="מחזור" value={formatAgorot(summary!.totalRevenueAgorot)} />
                    <Mini label="חלק הקבלן" value={formatAgorot(summary!.contractorShareAgorot)} />
                    <Mini label="החלק שלי" value={formatAgorot(summary!.businessShareAgorot)} />
                    <Mini
                      label={summary!.contractorOwesBusinessAgorot > 0 ? "הקבלן חייב לי" : "אני חייב לקבלן"}
                      value={formatAgorot(
                        summary!.contractorOwesBusinessAgorot > 0
                          ? summary!.contractorOwesBusinessAgorot
                          : summary!.businessOwesContractorAgorot
                      )}
                      tone={summary!.contractorOwesBusinessAgorot > 0 ? "danger" : "warning"}
                    />
                  </div>
                  <Button size="sm" variant="success" onClick={() => setConfirmId(contractor.id)}>
                    <CheckCircle2 className="h-4 w-4" /> סימון כשולם / חוסל
                  </Button>
                </CardBody>
              </Card>
            ))}
          </div>
        )
      ) : history.length === 0 ? (
        <EmptyState icon={History} title="אין עדיין היסטוריית התחשבנויות" />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-100 text-right text-xs font-bold uppercase text-ink-400">
                <th className="px-4 py-3">קבלן</th>
                <th className="px-4 py-3">תקופה</th>
                <th className="px-4 py-3">עבודות</th>
                <th className="px-4 py-3">מחזור</th>
                <th className="px-4 py-3">יתרה נטו</th>
                <th className="px-4 py-3">תאריך סילוק</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="border-b border-ink-50 last:border-0">
                  <td className="px-4 py-3 font-semibold text-ink-800">{s.contractor_name}</td>
                  <td className="px-4 py-3 text-xs text-ink-500">
                    {formatDateHe(s.period_start)} - {formatDateHe(s.period_end)}
                  </td>
                  <td className="px-4 py-3">{s.total_jobs}</td>
                  <td className="px-4 py-3">{formatAgorot(s.total_revenue_agorot)}</td>
                  <td className={`px-4 py-3 font-bold ${s.net_agorot >= 0 ? "text-warning-600" : "text-danger-600"}`}>
                    {formatAgorot(Math.abs(s.net_agorot))} {s.net_agorot >= 0 ? "(אני חייב)" : "(הקבלן חייב)"}
                  </td>
                  <td className="px-4 py-3 text-xs text-ink-400">{s.settled_at ? formatDateHe(s.settled_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <ConfirmDialog
        open={!!confirmId}
        onClose={() => setConfirmId(null)}
        onConfirm={() => confirmId && handleSettle(confirmId)}
        title="לסמן את ההתחשבנות כשולמה?"
        description="פעולה זו תשייך את כל העבודות הסגורות שלא הוסדרו בטווח שנבחר לרשומת התחשבנות חדשה בהיסטוריה."
        confirmLabel="כן, סמן כשולם"
        danger={false}
        loading={settling}
      />
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: string; tone?: "danger" | "warning" }) {
  const cls = tone === "danger" ? "text-danger-600" : tone === "warning" ? "text-warning-600" : "text-ink-900";
  return (
    <div className="rounded-xl bg-ink-50 p-2.5 text-center">
      <p className={`text-sm font-extrabold ${cls}`}>{value}</p>
      <p className="text-[10px] text-ink-400">{label}</p>
    </div>
  );
}
