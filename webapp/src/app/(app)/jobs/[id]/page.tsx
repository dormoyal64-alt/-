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
  Trash2,
  AlertTriangle,
  Eye,
  EyeOff,
  BellOff,
  Send,
  Megaphone,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { PageSpinner } from "@/components/ui/Misc";
import { StatusBadge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { CloseJobModal } from "@/components/jobs/CloseJobModal";
import { StatusMenu } from "@/components/jobs/StatusMenu";
import { EditJobModal, type EditJobValues } from "@/components/jobs/EditJobModal";
import { Timeline, type TimelineEntry } from "@/components/jobs/Timeline";
import { fetchJob, changeJobStatus, closeJob, reopenJob, duplicateJob, deleteJob, deleteJobBlockedReason } from "@/lib/api/jobs";
import { buildCallLink, buildMapLink, buildNewJobWhatsappMessage, buildOnTheWayMessage, buildWhatsappLink, sendsCustomerPhone } from "@/lib/whatsapp";
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
  const [adShare, setAdShare] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  async function markContractorNotified() {
    if (!job) return;
    setJob({ ...job, notify_contractor: true });
    const { error } = await supabase.from("jobs").update({ notify_contractor: true }).eq("id", job.id);
    if (error) {
      setJob(job);
      toast.error("לא הצלחנו לשמור את השינוי. נסו שוב.");
      return;
    }
    const sent = jobStatuses.find((st) => st.name === "נשלחה לקבלן");
    if (sent && job.status_id !== sent.id && !job.is_closed) {
      await changeJobStatus(supabase, job.id, sent.id, "פרטי העבודה נשלחו לקבלן");
    }
    await load();
  }

  async function toggleSendPhone() {
    if (!job) return;
    const next = !sendsCustomerPhone(job, settings?.send_customer_phone_to_contractor);
    // optimistic: the WhatsApp link above has to change before the next tap
    setJob({ ...job, send_customer_phone: next });
    const { error } = await supabase.from("jobs").update({ send_customer_phone: next }).eq("id", job.id);
    if (error) {
      setJob(job);
      toast.error("לא הצלחנו לשמור את השינוי. נסו שוב.");
      return;
    }
    toast.success(next ? "טלפון הלקוח ייכלל בהודעה לקבלן" : "טלפון הלקוח לא ייכלל בהודעה לקבלן");
  }

  async function handleDelete() {
    if (!job) return;
    setBusy(true);
    try {
      await deleteJob(supabase, job);
      toast.success(`העבודה ${job.job_number} נמחקה`);
      router.push("/jobs");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "שגיאה במחיקת העבודה. נסו שוב.");
      setBusy(false);
    }
  }

  async function load() {
    setLoading(true);
    const j = await fetchJob(supabase, id);
    setJob(j);
    // what this job's lead cost in advertising, as a share of that day's spend
    const { data: share } = await supabase.rpc("job_ad_share", { p_job_id: id });
    setAdShare(typeof share === "number" ? share : null);
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
  const sendPhone = sendsCustomerPhone(job, settings?.send_customer_phone_to_contractor);
  const waContractorLink = job.contractor
    ? buildWhatsappLink(
        job.contractor.whatsapp || job.contractor.phone,
        buildNewJobWhatsappMessage(job, { includeCustomerPhone: sendPhone })
      )
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

      {job.is_closed && (() => {
        // business_share already has the contractor and the referral company out
        // of it; fuel and the helper are only ever set on a job I did myself.
        const beforeAds =
          (job.business_share_agorot ?? 0) - (job.fuel_cost_agorot ?? 0) - (job.helper_pay_agorot ?? 0);
        const ads = adShare ?? 0;
        const real = beforeAds - ads;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Megaphone className="h-5 w-5 text-ink-400" /> הרווח האמיתי מהעבודה
              </CardTitle>
            </CardHeader>
            <CardBody className="space-y-1.5 text-sm">
              <InfoRow label="מחיר סופי" value={formatAgorot(job.final_price_agorot)} />
              {!!job.contractor_share_agorot && (
                <InfoRow label={`לקבלן${job.contractor ? ` (${job.contractor.name})` : ""}`} value={`-${formatAgorot(job.contractor_share_agorot)}`} />
              )}
              {!!job.referral_fee_agorot && (
                <InfoRow label={`לחברה מפנה${job.referral_company ? ` (${job.referral_company.name})` : ""}`} value={`-${formatAgorot(job.referral_fee_agorot)}`} />
              )}
              {!!job.fuel_cost_agorot && <InfoRow label="דלק" value={`-${formatAgorot(job.fuel_cost_agorot)}`} />}
              {!!job.helper_pay_agorot && (
                <InfoRow label={`עובד${job.helper ? ` (${job.helper.name})` : ""}`} value={`-${formatAgorot(job.helper_pay_agorot)}`} />
              )}
              <InfoRow label="חלק יחסי בפרסום" value={`-${formatAgorot(ads)}`} />
              <div className="mt-1 flex items-center justify-between border-t-2 border-ink-200 pt-2">
                <span className="font-extrabold text-ink-900">נשאר לי</span>
                <span className={`text-lg font-extrabold ${real < 0 ? "text-danger-600" : "text-success-600"}`}>
                  {formatAgorot(real)}
                </span>
              </div>
              <p className="pt-1 text-xs text-ink-400">
                חלק הפרסום הוא הוצאות הפרסום של היום שבו נפתחה העבודה, מחולקות בכל הפניות שהתקבלו
                באותו יום — כולל אלה שלא נסגרו. אם לא רשמתם פרסום לאותו יום, הוא 0.
              </p>
            </CardBody>
          </Card>
        );
      })()}

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

      {job.contractor && !job.notify_contractor && !job.is_closed && waContractorLink && (
        /* assigned but never told — offer to tell them, and record that we did */
        <div className="flex flex-col gap-2.5 rounded-xl border border-warning-100 bg-warning-50 px-3.5 py-3 sm:flex-row sm:items-center">
          <BellOff className="h-[18px] w-[18px] shrink-0 text-warning-600" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-900">{job.contractor.name} עדיין לא קיבל הודעה</p>
            <p className="text-xs text-ink-500">העבודה שויכה אליו בלי לשלוח את הפרטים.</p>
          </div>
          <a
            href={waContractorLink}
            target="_blank"
            rel="noreferrer"
            onClick={markContractorNotified}
            className="btn-success flex shrink-0 items-center justify-center gap-2 px-4 py-2.5 text-sm"
          >
            <Send className="h-4 w-4" />
            שליחת הפרטים עכשיו
          </a>
        </div>
      )}

      {/* what the contractor's message will carry — the number itself never leaves the job */}
      <button
        type="button"
        onClick={toggleSendPhone}
        className={`flex w-full items-start gap-2.5 rounded-xl border px-3.5 py-3 text-right transition ${
          sendPhone ? "border-ink-100 bg-white hover:bg-ink-50" : "border-warning-100 bg-warning-50"
        }`}
      >
        {sendPhone ? (
          <Eye className="mt-0.5 h-[18px] w-[18px] shrink-0 text-ink-400" />
        ) : (
          <EyeOff className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warning-600" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink-900">
            {sendPhone ? "הקבלן מקבל את טלפון הלקוח" : "הקבלן לא מקבל את טלפון הלקוח"}
          </span>
          <span className="block text-xs text-ink-500">
            {sendPhone
              ? "המספר ייכלל בהודעת הוואטסאפ לקבלן. לחצו כדי להסתיר אותו."
              : "במקום המספר ייכתב ״לתיאום מול הלקוח — דברו איתי״."}
          </span>
        </span>
      </button>

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

      {/* kept away from the everyday actions, and phrased so the cost is plain */}
      <button
        type="button"
        onClick={() => {
          setDeleteConfirmText("");
          setDeleteOpen(true);
        }}
        className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-danger-100 py-3 text-sm font-semibold text-danger-600 transition hover:bg-danger-50"
      >
        <Trash2 className="h-4 w-4" />
        מחיקת העבודה מהמערכת
      </button>

      <CloseJobModal open={closeOpen} onClose={() => setCloseOpen(false)} job={job} onSubmit={handleClose} loading={busy} />
      <StatusMenu open={statusOpen} onClose={() => setStatusOpen(false)} currentStatusId={job.status_id} onSelect={handleStatusSelect} />
      <EditJobModal open={editOpen} onClose={() => setEditOpen(false)} job={job} onSubmit={handleEditSubmit} loading={busy} />

      <Modal open={deleteOpen} onClose={() => setDeleteOpen(false)} title="מחיקת עבודה">
        {(() => {
          const blocked = deleteJobBlockedReason(job);
          if (blocked) {
            return (
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 rounded-xl border border-warning-100 bg-warning-50 px-3.5 py-3">
                  <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-warning-600" />
                  <p className="text-sm font-semibold text-ink-800">{blocked}</p>
                </div>
                <Button fullWidth variant="secondary" onClick={() => setDeleteOpen(false)}>
                  סגירה
                </Button>
              </div>
            );
          }

          // A closed job is already counted in the money reports, so deleting it
          // changes numbers you may have acted on. Typing the number is the brake.
          const needsTyping = job.is_closed;
          const canDelete = !needsTyping || deleteConfirmText.trim() === job.job_number;

          return (
            <div className="space-y-3">
              <p className="text-sm text-ink-700">
                העבודה <span className="font-extrabold">{job.job_number}</span> של{" "}
                <span className="font-extrabold">{job.customer_name}</span> תימחק לצמיתות, יחד עם ציר הזמן
                וההתראות שלה. <span className="font-bold">אי אפשר לבטל את הפעולה.</span>
              </p>

              {needsTyping && (
                <>
                  <div className="flex items-start gap-2.5 rounded-xl border border-danger-100 bg-danger-50 px-3.5 py-3">
                    <AlertTriangle className="mt-0.5 h-[18px] w-[18px] shrink-0 text-danger-600" />
                    <p className="text-sm font-semibold text-ink-800">
                      זו עבודה סגורה על {formatAgorot(job.final_price_agorot)}. מחיקתה תשנה את הרווח הנקי,
                      את האנליטיקס ואת דירוג הקבלנים.
                    </p>
                  </div>
                  <div>
                    <p className="mb-1.5 text-sm font-semibold text-ink-700">
                      הקלידו {job.job_number} כדי לאשר
                    </p>
                    <Input
                      value={deleteConfirmText}
                      onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={job.job_number}
                      dir="ltr"
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2">
                <Button fullWidth variant="secondary" onClick={() => setDeleteOpen(false)}>
                  ביטול
                </Button>
                <Button fullWidth variant="danger" onClick={handleDelete} loading={busy} disabled={!canDelete}>
                  <Trash2 className="h-4 w-4" />
                  מחיקה לצמיתות
                </Button>
              </div>
            </div>
          );
        })()}
      </Modal>

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
