"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Plus, Search, Phone, MessageCircle, ChevronLeft, Users, Download } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { EmptyState, PageSpinner } from "@/components/ui/Misc";
import { ContractorForm } from "@/components/contractors/ContractorForm";
import { createContractor } from "@/lib/api/contractors";
import { formatAgorot, formatPercent } from "@/lib/money";
import { buildCallLink, buildWhatsappLink } from "@/lib/whatsapp";
import { toCsv, downloadCsv } from "@/lib/csv";
import type { ContractorStatsRow } from "@/lib/types";

export default function ContractorsPage() {
  const supabase = useMemo(() => createClient(), []);
  const { contractors, professions, cities, refresh, loading } = useRefData();
  const toast = useToast();

  const [stats, setStats] = useState<Record<string, ContractorStatsRow>>({});
  const [search, setSearch] = useState("");
  const [professionFilter, setProfessionFilter] = useState("");
  const [cityFilter, setCityFilter] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase
      .rpc("contractor_stats", { p_from: "2000-01-01", p_to: new Date().toISOString() })
      .then(({ data }) => {
        const map: Record<string, ContractorStatsRow> = {};
        (data as ContractorStatsRow[] | null)?.forEach((row) => (map[row.contractor_id] = row));
        setStats(map);
      });
  }, [supabase, contractors.length]);

  const filtered = contractors.filter((c) => {
    if (!showInactive && !c.active) return false;
    if (search && !`${c.name} ${c.phone ?? ""}`.includes(search)) return false;
    if (professionFilter && !c.contractor_professions.some((p) => p.profession_id === professionFilter)) return false;
    if (cityFilter && !c.contractor_cities.some((ci) => ci.city_id === cityFilter)) return false;
    return true;
  });

  async function handleCreate(input: Parameters<typeof createContractor>[1]) {
    setSaving(true);
    try {
      await createContractor(supabase, input);
      await refresh();
      toast.success("הקבלן נוסף בהצלחה");
      setCreateOpen(false);
    } catch (e) {
      toast.error("שגיאה בשמירת הקבלן");
    } finally {
      setSaving(false);
    }
  }

  function handleExport() {
    const rows = contractors.map((c) => {
      const s = stats[c.id];
      return {
        name: c.name,
        phone: c.phone,
        active: c.active ? "פעיל" : "לא פעיל",
        default_commission_pct: c.default_commission_pct,
        jobs_sent: s?.jobs_sent ?? 0,
        jobs_closed_success: s?.jobs_closed_success ?? 0,
        close_rate: s?.close_rate ?? 0,
        total_revenue: s ? (s.total_revenue_agorot / 100).toFixed(2) : "0",
        contractor_share: s ? (s.contractor_share_agorot / 100).toFixed(2) : "0",
        business_share: s ? (s.business_share_agorot / 100).toFixed(2) : "0",
      };
    });
    downloadCsv(`contractors-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(rows));
  }

  if (loading) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">קבלנים</h1>
          <p className="text-sm text-ink-500">ניהול קבלני הביצוע, ביצועים והתחשבנות</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handleExport}>
            <Download className="h-4 w-4" /> ייצוא CSV
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            קבלן חדש
          </Button>
        </div>
      </div>

      <Card>
        <CardBody className="flex flex-wrap gap-3">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="חיפוש לפי שם או טלפון..."
              className="pr-10"
            />
          </div>
          <select value={professionFilter} onChange={(e) => setProfessionFilter(e.target.value)} className="input w-auto min-w-[140px]">
            <option value="">כל התחומים</option>
            {professions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <select value={cityFilter} onChange={(e) => setCityFilter(e.target.value)} className="input w-auto min-w-[140px]">
            <option value="">כל הערים</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-xl border border-ink-200 px-3 text-sm font-semibold text-ink-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            הצג לא פעילים
          </label>
        </CardBody>
      </Card>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="לא נמצאו קבלנים" description="נסו לשנות את הסינון או הוסיפו קבלן חדש" />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => {
            const s = stats[c.id];
            const closeRate = s?.close_rate ?? 0;
            return (
              <Link href={`/contractors/${c.id}`} key={c.id} className="card block p-4 transition hover:shadow-card-hover">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-bold text-ink-900">{c.name}</p>
                    <p className="text-xs text-ink-400" dir="ltr">
                      {c.phone}
                    </p>
                  </div>
                  <span
                    className={`badge ${c.active ? "bg-success-50 text-success-700" : "bg-ink-100 text-ink-500"}`}
                  >
                    {c.active ? "פעיל" : "לא פעיל"}
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-ink-50 py-2">
                    <p className="text-sm font-extrabold text-ink-900">{s?.jobs_sent ?? 0}</p>
                    <p className="text-[10px] text-ink-400">עבודות</p>
                  </div>
                  <div className="rounded-xl bg-ink-50 py-2">
                    <p className="text-sm font-extrabold text-success-600">{formatPercent(closeRate)}</p>
                    <p className="text-[10px] text-ink-400">אחוז סגירה</p>
                  </div>
                  <div className="rounded-xl bg-ink-50 py-2">
                    <p className="text-sm font-extrabold text-ink-900">{formatAgorot(s?.total_revenue_agorot ?? 0)}</p>
                    <p className="text-[10px] text-ink-400">מחזור</p>
                  </div>
                </div>

                <div className="mt-3 flex items-center gap-2">
                  <a
                    href={buildCallLink(c.phone) ?? "#"}
                    onClick={(e) => e.stopPropagation()}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink-100 py-2 text-xs font-bold text-ink-700"
                  >
                    <Phone className="h-3.5 w-3.5" /> התקשרות
                  </a>
                  <a
                    href={buildWhatsappLink(c.whatsapp || c.phone) ?? "#"}
                    onClick={(e) => e.stopPropagation()}
                    target="_blank"
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-success-50 py-2 text-xs font-bold text-success-700"
                  >
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                  </a>
                  <ChevronLeft className="h-4 w-4 text-ink-300" />
                </div>
              </Link>
            );
          })}
        </div>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="קבלן חדש" size="lg">
        <ContractorForm onSubmit={handleCreate} submitLabel="הוספת קבלן" loading={saving} />
      </Modal>
    </div>
  );
}
