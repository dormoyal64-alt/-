"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FileText,
  Plus,
  MessageCircle,
  Eye,
  Pencil,
  Trash2,
  ThumbsUp,
  ThumbsDown,
  Undo2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { useRefData } from "@/lib/refdata";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { QuoteFormModal } from "@/components/quotes/QuoteFormModal";
import { QuotePreviewModal } from "@/components/quotes/QuotePreviewModal";
import { formatAgorot } from "@/lib/money";
import { formatDateHe } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { buildWhatsappLink } from "@/lib/whatsapp";
import {
  buildQuoteWhatsappMessage,
  isExpired,
  plainDate,
  QUOTE_STATUS_LABELS,
} from "@/lib/quotes";
import {
  createQuote,
  deleteQuote,
  listQuotes,
  markQuoteSent,
  setQuoteStatus,
  supportsNameOverride,
  updateQuote,
  type QuoteDraft,
} from "@/lib/api/quotes";
import type { QuoteStatus, QuoteWithLines } from "@/lib/types";

/**
 * הצעות מחיר — the price, before the work.
 *
 * A quote written here is a document rather than a note: numbered, dated, with
 * a breakdown and an expiry, and sent to the customer's own WhatsApp carrying
 * the business's name and ע.פ. What that buys is an argument that ends — six
 * months later the customer has the message and the business has the same
 * text, down to the line.
 *
 * Nothing on this screen is income. A quote is a promise about work that has
 * not happened, so it never touches the receipt sequence or the yearly
 * turnover; only closing the job does that.
 */

const FILTERS: { key: "all" | QuoteStatus; label: string }[] = [
  { key: "all", label: "הכל" },
  { key: "sent", label: "ממתינות לתשובה" },
  { key: "accepted", label: "אושרו" },
  { key: "draft", label: "טיוטות" },
  { key: "declined", label: "נדחו" },
];

const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft: "bg-ink-100 text-ink-600",
  sent: "bg-brand-50 text-brand-700",
  accepted: "bg-success-50 text-success-700",
  declined: "bg-ink-100 text-ink-500",
  expired: "bg-warning-50 text-warning-700",
};

export default function QuotesPage() {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const { professions, jobTypes, settings } = useRefData();

  const [quotes, setQuotes] = useState<QuoteWithLines[]>([]);
  const [loading, setLoading] = useState(true);
  // null while unknown, false once the database answered without the table
  const [available, setAvailable] = useState(true);
  // the per-quote name arrived after the table did, so it is asked about
  // separately: the screen works either way
  const [canOverrideName, setCanOverrideName] = useState(false);
  const [filter, setFilter] = useState<"all" | QuoteStatus>("all");

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<QuoteWithLines | null>(null);
  const [previewing, setPreviewing] = useState<{ quote: QuoteWithLines; justSaved: boolean } | null>(null);
  const [deleting, setDeleting] = useState<QuoteWithLines | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const rows = await listQuotes(supabase);
    setAvailable(rows !== null);
    setQuotes(rows ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // asked once, not on every reload: the answer cannot change while the page
  // is open, and a probe that fails is a 400 in the console each time
  useEffect(() => {
    let alive = true;
    supportsNameOverride(supabase).then((ok) => {
      if (alive) setCanOverrideName(ok);
    });
    return () => {
      alive = false;
    };
  }, [supabase]);

  /** The quote's status as it should read today, expiry included. */
  const shownStatus = useCallback(
    (q: QuoteWithLines): QuoteStatus => (isExpired(q) ? "expired" : q.status),
    []
  );

  const messageFor = useCallback(
    (q: QuoteWithLines) =>
      buildQuoteWhatsappMessage(q, q.quote_lines ?? [], settings, {
        professionName: professions.find((p) => p.id === q.profession_id)?.name,
        jobTypeName: jobTypes.find((jt) => jt.id === q.job_type_id)?.name,
        profession: professions.find((p) => p.id === q.profession_id) ?? null,
      }),
    [settings, professions, jobTypes]
  );

  async function save(draft: QuoteDraft, send: boolean) {
    try {
      const saved = editing
        ? await updateQuote(supabase, editing.id, draft, canOverrideName)
        : await createQuote(supabase, draft, canOverrideName);
      setFormOpen(false);
      setEditing(null);
      await load();
      toast.success(editing ? "ההצעה עודכנה" : `הצעת מחיר ${saved.quote_number} נשמרה`);
      if (send) setPreviewing({ quote: saved, justSaved: true });
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לשמור את ההצעה"));
    }
  }

  /** Recorded the moment WhatsApp is opened — that is when it leaves. */
  async function recordSent(q: QuoteWithLines) {
    try {
      await markQuoteSent(supabase, q);
      await load();
    } catch {
      // the message is already on its way; a failed bookkeeping write must not
      // raise an error over it
    }
  }

  async function answer(q: QuoteWithLines, status: QuoteStatus) {
    setBusy(true);
    try {
      await setQuoteStatus(supabase, q.id, status);
      await load();
      toast.success(
        status === "accepted"
          ? "ההצעה סומנה כמאושרת"
          : status === "declined"
            ? "ההצעה סומנה כנדחתה"
            : "הסימון בוטל"
      );
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לעדכן את ההצעה"));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    setBusy(true);
    try {
      await deleteQuote(supabase, deleting.id);
      setDeleting(null);
      await load();
      toast.success("ההצעה נמחקה");
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו למחוק את ההצעה"));
    } finally {
      setBusy(false);
    }
  }

  const listed = quotes.filter((q) => filter === "all" || shownStatus(q) === filter);
  const waiting = quotes.filter((q) => shownStatus(q) === "sent");
  const waitingTotal = waiting.reduce((s, q) => s + q.total_agorot, 0);
  const acceptedTotal = quotes
    .filter((q) => q.status === "accepted")
    .reduce((s, q) => s + q.total_agorot, 0);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink-900">הצעות מחיר</h1>
          <p className="text-sm text-ink-500">
            ממלאים את הפרטים, וההצעה נשלחת ללקוח בוואטסאפ עם שם העסק והע.פ בתחתית. ההצעה אינה חשבונית
            ואינה נספרת במחזור — רק סגירת העבודה סופרת.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" /> הצעה חדשה
        </Button>
      </div>

      {!available && !loading && (
        <Card className="border-warning-200">
          <CardBody>
            <p className="text-sm font-bold text-ink-900">המסך מוכן, אבל מסד הנתונים עוד לא</p>
            <p className="mt-1 text-sm text-ink-500">
              צריך להריץ את סקריפט העדכון האחרון ב-Supabase, ואז לרענן את הדף.
            </p>
          </CardBody>
        </Card>
      )}

      {available && quotes.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card>
            <CardBody>
              <p className="text-xs font-bold text-ink-400">ממתינות לתשובה</p>
              <p className="text-xl font-extrabold text-ink-900">{waiting.length}</p>
              <p className="text-xs text-ink-500">{formatAgorot(waitingTotal)} על השולחן</p>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              <p className="text-xs font-bold text-ink-400">אושרו</p>
              <p className="text-xl font-extrabold text-success-700">
                {quotes.filter((q) => q.status === "accepted").length}
              </p>
              <p className="text-xs text-ink-500">{formatAgorot(acceptedTotal)}</p>
            </CardBody>
          </Card>
        </div>
      )}

      {available && quotes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                filter === f.key
                  ? "border-brand-600 bg-brand-600 text-white"
                  : "border-ink-200 text-ink-600 hover:bg-ink-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-brand-600" /> ההצעות שלי
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-ink-400">טוען...</p>
          ) : listed.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">
              {quotes.length === 0
                ? "עדיין לא נכתבה הצעת מחיר. כפתור ״הצעה חדשה״ למעלה."
                : "אין הצעות בסינון הזה."}
            </p>
          ) : (
            <div className="divide-y divide-ink-50">
              {listed.map((q) => {
                const status = shownStatus(q);
                const link = buildWhatsappLink(q.customer_phone, messageFor(q));
                return (
                  <div key={q.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-extrabold text-ink-400">{q.quote_number}</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-bold text-ink-900">
                        {q.customer_name}
                      </span>
                      <Badge className={STATUS_STYLE[status]}>{QUOTE_STATUS_LABELS[status]}</Badge>
                      <span className="shrink-0 font-extrabold text-ink-900">
                        {formatAgorot(q.total_agorot)}
                      </span>
                    </div>

                    <p className="mt-0.5 text-xs text-ink-500">
                      {q.title ||
                        [
                          professions.find((p) => p.id === q.profession_id)?.name,
                          jobTypes.find((jt) => jt.id === q.job_type_id)?.name,
                        ]
                          .filter(Boolean)
                          .join(" — ") ||
                        `${(q.quote_lines ?? []).length} שורות`}
                      {" · "}
                      {formatDateHe(q.created_at)}
                      {q.valid_until && status !== "accepted" && status !== "declined" && (
                        <>
                          {" · "}
                          <bdi className={status === "expired" ? "font-bold text-warning-700" : ""}>
                            {status === "expired" ? "פג ב־" : "בתוקף עד "}
                            {plainDate(q.valid_until)}
                          </bdi>
                        </>
                      )}
                      {q.sent_at && ` · נשלחה ${formatDateHe(q.sent_at)}`}
                    </p>

                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {link ? (
                        <a
                          href={link}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => recordSent(q)}
                          /* once the customer has answered, sending again is
                             a thing you can still do, not the thing to do */
                          className={`${
                            status === "accepted" || status === "declined"
                              ? "btn-secondary"
                              : "btn-success"
                          } px-3 py-1.5 text-sm`}
                        >
                          <MessageCircle className="h-4 w-4" />
                          {q.sent_at ? "שליחה שוב" : "שליחה בוואטסאפ"}
                        </a>
                      ) : (
                        <span className="text-xs font-semibold text-ink-400">אין טלפון לשליחה</span>
                      )}

                      <button
                        onClick={() => setPreviewing({ quote: q, justSaved: false })}
                        className="btn-ghost px-2.5 py-1.5 text-sm"
                        aria-label="תצוגה מקדימה"
                      >
                        <Eye className="h-4 w-4" /> תצוגה
                      </button>

                      {status !== "accepted" && status !== "declined" ? (
                        <>
                          <button
                            onClick={() => answer(q, "accepted")}
                            disabled={busy}
                            className="btn-ghost px-2.5 py-1.5 text-sm text-success-700 hover:bg-success-50"
                          >
                            <ThumbsUp className="h-4 w-4" /> אושרה
                          </button>
                          <button
                            onClick={() => answer(q, "declined")}
                            disabled={busy}
                            className="btn-ghost px-2.5 py-1.5 text-sm"
                          >
                            <ThumbsDown className="h-4 w-4" /> נדחתה
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => answer(q, q.sent_at ? "sent" : "draft")}
                          disabled={busy}
                          className="btn-ghost px-2.5 py-1.5 text-sm"
                        >
                          <Undo2 className="h-4 w-4" /> ביטול הסימון
                        </button>
                      )}

                      <span className="flex-1" />

                      <button
                        onClick={() => {
                          setEditing(q);
                          setFormOpen(true);
                        }}
                        className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-100 hover:text-ink-700"
                        aria-label="עריכת ההצעה"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleting(q)}
                        className="rounded-lg p-1.5 text-ink-300 hover:bg-ink-100 hover:text-danger-600"
                        aria-label="מחיקת ההצעה"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      <QuoteFormModal
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        editing={editing}
        professions={professions}
        jobTypes={jobTypes}
        settings={settings}
        canOverrideName={canOverrideName}
        onSubmit={save}
      />

      <QuotePreviewModal
        open={!!previewing}
        onClose={() => setPreviewing(null)}
        title={
          previewing?.justSaved
            ? `הצעת מחיר ${previewing.quote.quote_number} מוכנה לשליחה`
            : `הצעת מחיר ${previewing?.quote.quote_number ?? ""}`
        }
        message={previewing ? messageFor(previewing.quote) : ""}
        phone={previewing?.quote.customer_phone ?? null}
        onSent={() => {
          if (previewing) recordSent(previewing.quote);
          setPreviewing(null);
        }}
      />

      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        onConfirm={remove}
        loading={busy}
        title={`למחוק את הצעה ${deleting?.quote_number ?? ""}?`}
        description="ההצעה והפירוט שלה יימחקו. מה שכבר נשלח ללקוח בוואטסאפ נשאר אצלו."
        confirmLabel="מחיקה"
      />
    </div>
  );
}
