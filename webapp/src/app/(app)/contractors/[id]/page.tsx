"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowRight, Phone, MessageCircle, Trash2, Briefcase } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { PageSpinner, EmptyState } from "@/components/ui/Misc";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { ContractorForm } from "@/components/contractors/ContractorForm";
import { updateContractor } from "@/lib/api/contractors";
import { formatAgorot, formatPercent } from "@/lib/money";
import { buildCallLink, buildWhatsappLink } from "@/lib/whatsapp";
import { formatDateHe } from "@/lib/dates";
import { StatusBadge } from "@/components/ui/Badge";
import Link from "next/link";
import type { ContractorStatsRow, ContractorWithRelations, JobWithRelations } from "@/lib/types";

export default function ContractorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { contractors, refresh } = useRefData();
  const toast = useToast();

  const contractor = contractors.find((c) => c.id === id) as ContractorWithRelations | undefined;
  const [stats, setStats] = useState<ContractorStatsRow | null>(null);
  const [jobs, setJobs] = useState<JobWithRelations[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  useEffect(() => {
    if (!id) return;
    supabase.rpc("contractor_stats", { p_from: "2000-01-01", p_to: new Date().toISOString() }).then(({ data }) => {
      const row = (data as ContractorStatsRow[] | null)?.find((r) => r.contractor_id === id);
      setStats(row ?? null);
    });
    setLoadingJobs(true);
    supabase
      .from("jobs")
      .select(
        "*, profession:professions(id,name), job_type:job_types(id,name), city:cities(id,name), status:job_statuses(id,name,color,is_success,is_terminal)"
      )
      .eq("contractor_id", id)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setJobs((data as unknown as JobWithRelations[]) ?? []);
        setLoadingJobs(false);
      });
  }, [supabase, id]);

  async function handleUpdate(input: Parameters<typeof updateContractor>[2]) {
    setSaving(true);
    try {
      await updateContractor(supabase, id, input);
      await refresh();
      toast.success("פרטי הקבלן עודכנו");
      setEditing(false);
    } catch {
      toast.error("שגיאה בעדכון הקבלן");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate() {
    await supabase.from("contractors").update({ active: !contractor?.active }).eq("id", id);
    await refresh();
    setConfirmDeactivate(false);
    toast.success(contractor?.active ? "הקבלן סומן כלא פעיל" : "הקבלן סומן כפעיל");
  }

  if (!contractor) return <PageSpinner />;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <button onClick={() => router.push("/contractors")} className="flex items-center gap-1.5 text-sm font-semibold text-ink-500">
        <ArrowRight className="h-4 w-4" /> חזרה לרשימת קבלנים
      </button>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-extrabold text-ink-900">{contractor.name}</h1>
            <span className={`badge ${contractor.active ? "bg-success-50 text-success-700" : "bg-ink-100 text-ink-500"}`}>
              {contractor.active ? "פעיל" : "לא פעיל"}
            </span>
          </div>
          <p className="text-sm text-ink-500" dir="ltr">
            {contractor.phone}
          </p>
        </div>
        <div className="flex gap-2">
          <a href={buildCallLink(contractor.phone) ?? "#"} className="btn-secondary px-3.5 py-2.5">
            <Phone className="h-4 w-4" />
          </a>
          <a href={buildWhatsappLink(contractor.whatsapp || contractor.phone) ?? "#"} target="_blank" className="btn-success px-3.5 py-2.5">
            <MessageCircle className="h-4 w-4" />
          </a>
          <Button variant="secondary" onClick={() => setEditing((e) => !e)}>
            {editing ? "ביטול עריכה" : "עריכה"}
          </Button>
        </div>
      </div>

      {editing ? (
        <Card>
          <CardBody>
            <ContractorForm initial={contractor} onSubmit={handleUpdate} submitLabel="עדכון פרטי קבלן" loading={saving} />
          </CardBody>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="עבודות שנשלחו" value={String(stats?.jobs_sent ?? 0)} />
            <MiniStat label="עבודות שנסגרו" value={String(stats?.jobs_closed_success ?? 0)} />
            <MiniStat label="אחוז סגירה" value={formatPercent(stats?.close_rate ?? 0)} tone="success" />
            <MiniStat label="מחזור כולל" value={formatAgorot(stats?.total_revenue_agorot ?? 0)} />
            <MiniStat label="חלק הקבלן" value={formatAgorot(stats?.contractor_share_agorot ?? 0)} />
            <MiniStat label="החלק שלי" value={formatAgorot(stats?.business_share_agorot ?? 0)} />
            <MiniStat
              label="הקבלן חייב לי"
              value={formatAgorot(stats?.contractor_owes_business_agorot ?? 0)}
              tone={stats?.contractor_owes_business_agorot ? "danger" : undefined}
            />
            <MiniStat
              label="אני חייב לקבלן"
              value={formatAgorot(stats?.business_owes_contractor_agorot ?? 0)}
              tone={stats?.business_owes_contractor_agorot ? "warning" : undefined}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>פרטי שיוך</CardTitle>
            </CardHeader>
            <CardBody className="space-y-3">
              <AssignmentRow label="תחומים" ids={contractor.contractor_professions.map((p) => p.profession_id)} type="profession" />
              <AssignmentRow label="ערים" ids={contractor.contractor_cities.map((c) => c.city_id)} type="city" />
              <div>
                <p className="mb-1 text-xs font-bold text-ink-400">אחוז קבוע</p>
                <p className="text-sm font-bold text-ink-800">{formatPercent(contractor.default_commission_pct)}</p>
              </div>
              {contractor.notes && (
                <div>
                  <p className="mb-1 text-xs font-bold text-ink-400">הערות</p>
                  <p className="text-sm text-ink-700">{contractor.notes}</p>
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>עבודות אחרונות</CardTitle>
            </CardHeader>
            <CardBody>
              {loadingJobs ? (
                <PageSpinner />
              ) : jobs.length === 0 ? (
                <EmptyState icon={Briefcase} title="אין עבודות עדיין" />
              ) : (
                <div className="divide-y divide-ink-100">
                  {jobs.map((job) => (
                    <Link
                      key={job.id}
                      href={`/jobs/${job.id}`}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <div>
                        <p className="text-sm font-bold text-ink-900">
                          {job.job_number} · {job.customer_name}
                        </p>
                        <p className="text-xs text-ink-400">
                          {job.profession?.name} · {job.city?.name} · {formatDateHe(job.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {job.is_closed && job.final_price_agorot != null && (
                          <span className="text-sm font-bold text-ink-700">{formatAgorot(job.final_price_agorot)}</span>
                        )}
                        {job.status && <StatusBadge name={job.status.name} color={job.status.color} />}
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <button
            onClick={() => setConfirmDeactivate(true)}
            className="flex items-center gap-2 text-sm font-semibold text-danger-600"
          >
            <Trash2 className="h-4 w-4" />
            {contractor.active ? "סימון כלא פעיל (ארכיון)" : "החזרת קבלן לפעיל"}
          </button>
        </>
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={handleDeactivate}
        title={contractor.active ? "להעביר קבלן זה לארכיון?" : "להחזיר קבלן זה לפעיל?"}
        description="לא נמחק מידע — ניתן להחזיר את הסטטוס בכל עת. עבודות היסטוריות של הקבלן יישארו זמינות."
        confirmLabel={contractor.active ? "העברה לארכיון" : "החזרה לפעיל"}
        danger={contractor.active}
      />
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  const toneClass = tone === "success" ? "text-success-600" : tone === "warning" ? "text-warning-600" : tone === "danger" ? "text-danger-600" : "text-ink-900";
  return (
    <div className="card p-3.5 text-center">
      <p className={`text-lg font-extrabold ${toneClass}`}>{value}</p>
      <p className="mt-0.5 text-[11px] text-ink-400">{label}</p>
    </div>
  );
}

function AssignmentRow({ label, ids, type }: { label: string; ids: string[]; type: "profession" | "city" }) {
  const { professions, cities } = useRefData();
  const source = type === "profession" ? professions : cities;
  const names = ids.map((id) => source.find((x) => x.id === id)?.name).filter(Boolean);
  return (
    <div>
      <p className="mb-1.5 text-xs font-bold text-ink-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {names.map((n) => (
          <span key={n} className="badge bg-ink-100 text-ink-700">
            {n}
          </span>
        ))}
      </div>
    </div>
  );
}
