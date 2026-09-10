"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowRight,
  Phone,
  MessageCircle,
  MapPin,
  Pencil,
  RefreshCcw,
  CheckCircle2,
  Copy,
  StickyNote,
  Undo2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Misc";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { CloseJobModal } from "@/components/jobs/CloseJobModal";
import { StatusMenu } from "@/components/jobs/StatusMenu";
import { EditJobModal, type EditJobValues } from "@/components/jobs/EditJobModal";
import { Timeline, type TimelineEntry } from "@/components/jobs/Timeline";
import { fetchJob, changeJobStatus, closeJob, reopenJob, duplicateJob } from "@/lib/api/jobs";
import { buildCallLink, buildMapLink, buildNewJobWhatsappMessage, buildOnTheWayMessage, buildWhatsappLink } from "@/lib/whatsapp";
import { formatAgorot, formatPercent } from "@/lib/money";
import { formatDateTimeHe, formatDurationHe } from "@/lib/dates";
import { useRefData } from "@/lib/refdata";
import type { JobWithRelations } from "@/lib/types";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { jobStatuses, settings } = useRefData();

  const [job, setJob] = useState<JobWithRelations | null>(null);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [closeOpen, setCloseOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const j = await fetchJob(supabase, id);
    setJob(j);
    const { data } = await supabase
      .from("job_status_history")
      .select("id, changed_at, note, status:job_statuses(name, color)")
      .eq("job_id", id)
      .order("changed_at", { ascending: false });
    setTimeline(
      (data ?? []).map((row: any) => ({
        id: row.id,
        changed_at: row.changed_at,
        note: row.note,
        status_name: row.status?.name ?? null,
        status_color: row.status?.color ?? null,
      }))
    );
    setLoading(false);
  }

  useEffect(() => {
    if (id) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading || !job) return <PageSpinner />;

  async function handleStatusSelect(statusId: string) {
    setBusy(true);
    try {
      await changeJobStatus(supabase, job!.id, statusId);
      toast.success("הסטטוס עודכן");
      setStatusOpen(false);
      await load();
    } catch {
      toast.error("שגיאה בעדכון סטטוס");
    } finally {
      setBusy(false);
    }
  }

  async function handleClose(input: Parameters<typeof closeJob>[2]) {
    setBusy(true);
    try {
      await closeJob(supabase, job!.id, input);
      toast.success("העבודה נסגרה ועודכנה ההתחשבנות");
      setCloseOpen(false);
      await load();
    } catch {
      toast.error("שגיאה בסגירת העבודה");
    } finally {
      setBusy(false);
    }
  }

  async function handleReopen() {
    const openStatus = jobStatuses.find((s) => s.name === "בטיפול") ?? jobStatuses[0];
    setBusy(true);
    try {
      await reopenJob(supabase, job!.id, openStatus.id);
      toast.success("העבודה נפתחה מחדש");
      await load();
    } catch {
      toast.error("שגיאה בפתיחה מחדש");
    } finally {
      setBusy(false);
    }
  }

  async function handleDuplicate() {
    const newStatus = jobStatuses.find((s) => s.name === "חדשה");
    if (!newStatus) return;
    setBusy(true);
    try {
      const copy = await duplicateJob(supabase, job!, newStatus.id);
      toast.success(`נוצרה עבודה חדשה ${copy.job_number}`);
      router.push(`/jobs/${copy.id}`);
    } catch {
      toast.error("שגיאה בשכפול העבודה");
    } finally {
      setBusy(false);
    }
  }

  async function handleAddNote() {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      await supabase.from("job_status_history").insert({ job_id: job!.id, status_id: job!.status_id, note: noteText.trim() });
      setNoteText("");
      setNoteOpen(false);
      await load();
    } catch {
      toast.error("שגיאה בהוספת הערה");
    } finally {
      setBusy(false);
    }
  }

  async function handleEditSubmit(values: EditJobValues) {
    setBusy(true);
    try {
      const { error } = await supabase.from("jobs").update(values).eq("id", job!.id);
      if (error) throw error;
      toast.success("העבודה עודכנה");
      setEditOpen(false);
      await load();
    } catch {
      toast.error("שגיאה בעדכון העבודה");
    } finally {
      setBusy(false);
    }
  }

  const waCustomerLink = buildWhatsappLink(job.customer_phone);
  const technicianLabel = job.profession?.technician_label?.trim() || "הטכנאי";
  const onTheWayLink = buildWhatsappLink(
    job.customer_phone,
    buildOnTheWayMessage(job, settings?.on_the_way_template)
  );
  const waContractorLink = job.contractor
    ? buildWhatsappLink(job.contractor.whatsapp || job.contractor.phone, buildNewJobWhatsappMessage(job))
    : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-8">
      <button onClick={() => router.push("/jobs")} className="flex items-center gap-1.5 text-sm font-semibold text-ink-500">
        <ArrowRight className="h-4 w-4" /> חזרה לרשימת עבודות
      </button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-extrabold text-ink-900">{job.job_number}</h1>
            {job.status && <StatusBadge name={job.status.name} color={job.status.color} />}
          </div>
          <p className="mt-1 text-sm text-ink-500">
            {job.profession?.name} · {job.job_type?.name} · {job.city?.name}
          </p>
        </div>
        <button onClick={() => setEditOpen(true)} className="btn-secondary px-3.5 py-2">
          <Pencil className="h-4 w-4" /> עריכה
        </button>
      </div>

      {job.is_closed && (
        <Card className="border-2 border-success-100 bg-success-50/40">
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <SummaryStat label="מחיר סופי" value={formatAgorot(job.final_price_agorot)} />
            <SummaryStat label="חלק הקבלן" value={formatAgorot(job.contractor_share_agorot)} />
            <SummaryStat label="החלק שלי" value={formatAgorot(job.business_share_agorot)} />
            <SummaryStat label="מי קיבל תשלום" value={job.payment_received_by === "business" ? "העסק" : "הקבלן"} />
          </CardBody>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <ActionButton icon={Phone} label="התקשר ללקוח" href={buildCallLink(job.customer_phone)} />
        <ActionButton icon={MessageCircle} label="WhatsApp ללקוח" href={waCustomerLink} tone="success" external />
        <ActionButton icon={Phone} label="התקשר לקבלן" href={buildCallLink(job.contractor?.phone)} disabled={!job.contractor} />
        <ActionButton icon={MessageCircle} label="WhatsApp לקבלן" href={waContractorLink} tone="success" external disabled={!job.contractor} />
        <ActionButton icon={MapPin} label="פתח במפה" href={buildMapLink(job)} external />
        <ActionButton icon={RefreshCcw} label="שנה סטטוס" onClick={() => setStatusOpen(true)} />
        <ActionButton icon={Copy} label="שכפול עבודה" onClick={handleDuplicate} />
        <ActionButton icon={StickyNote} label="הוסף הערה" onClick={() => setNoteOpen(true)} />
      </div>

      {!job.is_closed && onTheWayLink && (
        <a
          href={onTheWayLink}
          target="_blank"
          rel="noreferrer"
          className="mb-3 flex w-full flex-col items-center gap-0.5 rounded-xl border border-success-100 bg-success-50 px-4 py-3 font-bold text-success-700 transition hover:bg-success-100/60 active:scale-[.99]"
        >
          <span className="flex items-center gap-2">
            <MessageCircle className="h-[18px] w-[18px]" />
            הודע ללקוח ש{technicianLabel} בדרך
          </span>
          <span className="text-xs font-semibold text-success-600/80">״{technicianLabel} כבר בדרך אליך״</span>
        </a>
      )}

      {!job.is_closed ? (
        <Button size="lg" fullWidth variant="success" onClick={() => setCloseOpen(true)}>
          <CheckCircle2 className="h-5 w-5" />
          סגירת עבודה
        </Button>
      ) : (
        <Button size="lg" fullWidth variant="secondary" onClick={handleReopen} loading={busy}>
          <Undo2 className="h-5 w-5" />
          פתיחת העבודה מחדש
        </Button>
      )}

      <Card>
        <CardHeader>
          <CardTitle>פרטי לקוח ועבודה</CardTitle>
        </CardHeader>
        <CardBody className="space-y-2 text-sm">
          <InfoRow label="לקוח" value={job.customer_name} />
          <InfoRow label="טלפון" value={job.customer_phone} dir="ltr" />
          <InfoRow label="כתובת" value={job.address_full ?? "—"} />
          <InfoRow label="קבלן מבצע" value={job.contractor?.name ?? "לא שויך"} />
          <InfoRow label="אחוז קבלן" value={job.commission_pct != null ? formatPercent(job.commission_pct) : "—"} />
          <InfoRow label="מחיר התחלתי" value={formatAgorot(job.quoted_price_agorot)} />
          <InfoRow label="אמצעי תשלום" value={job.payment_method?.name ?? "—"} />
          <InfoRow label="מקור ליד" value={job.lead_source?.name ?? "—"} />
          <InfoRow label="זמן פתיחה" value={formatDateTimeHe(job.opened_at)} />
          <InfoRow
            label={job.is_closed && job.closed_at ? "זמן ביצוע" : "פתוחה כבר"}
            value={
              job.is_closed && job.closed_at
                ? formatDurationHe(job.opened_at, job.closed_at)
                : formatDurationHe(job.opened_at)
            }
          />
          {job.notes && <InfoRow label="הערות" value={job.notes} />}
          {job.closing_notes && <InfoRow label="הערות סגירה" value={job.closing_notes} />}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ציר זמן</CardTitle>
        </CardHeader>
        <CardBody>
          <Timeline entries={timeline} />
        </CardBody>
      </Card>

      <CloseJobModal open={closeOpen} onClose={() => setCloseOpen(false)} job={job} onSubmit={handleClose} loading={busy} />
      <StatusMenu open={statusOpen} onClose={() => setStatusOpen(false)} currentStatusId={job.status_id} onSelect={handleStatusSelect} />
      <EditJobModal open={editOpen} onClose={() => setEditOpen(false)} job={job} onSubmit={handleEditSubmit} loading={busy} />

      <Modal open={noteOpen} onClose={() => setNoteOpen(false)} title="הוספת הערה">
        <div className="space-y-3">
          <Textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="כתבו הערה שתתווסף לציר הזמן..." />
          <Button fullWidth onClick={handleAddNote} loading={busy}>
            הוספה
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-lg font-extrabold text-ink-900">{value}</p>
      <p className="text-[11px] text-ink-500">{label}</p>
    </div>
  );
}

function InfoRow({ label, value, dir }: { label: string; value: string; dir?: "ltr" | "rtl" }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-ink-50 py-1.5 last:border-0">
      <span className="shrink-0 text-ink-400">{label}</span>
      <span className="text-left font-semibold text-ink-800" dir={dir}>
        {value}
      </span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  href,
  onClick,
  tone,
  external,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  href?: string | null;
  onClick?: () => void;
  tone?: "success";
  external?: boolean;
  disabled?: boolean;
}) {
  const classes = `flex flex-col items-center justify-center gap-1.5 rounded-2xl border p-3 text-center text-xs font-bold transition active:scale-[.97] ${
    disabled
      ? "border-ink-100 text-ink-300 pointer-events-none opacity-50"
      : tone === "success"
      ? "border-success-100 bg-success-50 text-success-700"
      : "border-ink-100 text-ink-700 hover:bg-ink-50"
  }`;

  if (href && !disabled) {
    return (
      <a href={href} target={external ? "_blank" : undefined} rel={external ? "noreferrer" : undefined} className={classes}>
        <Icon className="h-5 w-5" />
        {label}
      </a>
    );
  }
  return (
    <button onClick={onClick} disabled={disabled} className={classes}>
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}
