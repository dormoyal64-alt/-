"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Send, Trash2, Save } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Label, Select, Textarea } from "@/components/ui/Input";
import { formatAgorot, shekelsToAgorot, agorotToShekels } from "@/lib/money";
import { lineTotal, quoteTotal, validUntilFrom, VALIDITY_CHOICES } from "@/lib/quotes";
import type { QuoteDraft, QuoteLineDraft } from "@/lib/api/quotes";
import type { JobType, Profession, QuoteWithLines } from "@/lib/types";

/**
 * Writing a quote.
 *
 * Built as one screen rather than a wizard: a quote is usually written with the
 * customer still on the phone, and every field here is something they are
 * saying right now. The breakdown is the heart of it — a row per thing being
 * charged for, because that is how the conversation goes and how it will be
 * argued about later — and the total is added up as it is typed so nothing is
 * ever worked out on paper beside the screen.
 */

interface LineRow {
  key: string;
  description: string;
  /** kept as text while being typed, so an empty box is not silently a 1 */
  qty: string;
  price: string;
}

const newKey = () =>
  typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Math.random());

const emptyLine = (): LineRow => ({ key: newKey(), description: "", qty: "1", price: "" });

function toDraftLines(rows: LineRow[]): QuoteLineDraft[] {
  return rows
    .filter((r) => r.description.trim())
    .map((r) => ({
      description: r.description,
      qty: Math.max(parseFloat(r.qty) || 1, 0.01),
      unit_price_agorot: shekelsToAgorot(r.price || "0"),
    }));
}

export function QuoteFormModal({
  open,
  onClose,
  editing,
  professions,
  jobTypes,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  /** the quote being rewritten, or null for a new one */
  editing: QuoteWithLines | null;
  professions: Profession[];
  jobTypes: JobType[];
  onSubmit: (draft: QuoteDraft, send: boolean) => Promise<void>;
}) {
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [customerTaxId, setCustomerTaxId] = useState("");
  const [professionId, setProfessionId] = useState("");
  const [jobTypeId, setJobTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [validUntil, setValidUntil] = useState(validUntilFrom(14));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineRow[]>([emptyLine()]);
  const [busy, setBusy] = useState<"save" | "send" | null>(null);

  // reloaded whenever the dialog opens, so yesterday's quote is never sitting
  // in the boxes of today's
  useEffect(() => {
    if (!open) return;
    setCustomerName(editing?.customer_name ?? "");
    setCustomerPhone(editing?.customer_phone ?? "");
    setCustomerAddress(editing?.customer_address ?? "");
    setCustomerTaxId(editing?.customer_tax_id ?? "");
    setProfessionId(editing?.profession_id ?? "");
    setJobTypeId(editing?.job_type_id ?? "");
    setTitle(editing?.title ?? "");
    setValidUntil(editing?.valid_until ?? validUntilFrom(14));
    setNotes(editing?.notes ?? "");
    const existing = [...(editing?.quote_lines ?? [])].sort((a, b) => a.sort_order - b.sort_order);
    setLines(
      existing.length
        ? existing.map((l) => ({
            key: l.id,
            description: l.description,
            qty: String(Number(l.qty)),
            price: String(agorotToShekels(l.unit_price_agorot)),
          }))
        : [emptyLine()]
    );
    setBusy(null);
  }, [open, editing]);

  const relevantJobTypes = useMemo(
    () => jobTypes.filter((jt) => jt.is_active && (!professionId || jt.profession_id === professionId)),
    [jobTypes, professionId]
  );

  const draftLines = toDraftLines(lines);
  const total = quoteTotal(draftLines);
  const canSave = !!customerName.trim() && draftLines.length > 0 && total > 0;
  const canSend = canSave && !!customerPhone.trim();

  function patchLine(key: string, patch: Partial<LineRow>) {
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  async function submit(send: boolean) {
    setBusy(send ? "send" : "save");
    try {
      await onSubmit(
        {
          customer_name: customerName,
          customer_phone: customerPhone,
          customer_address: customerAddress,
          customer_tax_id: customerTaxId,
          profession_id: professionId || null,
          job_type_id: jobTypeId || null,
          title,
          valid_until: validUntil || null,
          notes,
          lines: draftLines,
        },
        send
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `עריכת הצעת מחיר ${editing.quote_number}` : "הצעת מחיר חדשה"}
      size="lg"
    >
      <div className="space-y-5">
        {/* ---- the customer ---- */}
        <section className="space-y-3">
          <h4 className="text-sm font-extrabold text-ink-900">למי ההצעה</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label required>שם הלקוח</Label>
              <Input
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="למשל: משה כהן / מועצה מקומית"
              />
            </div>
            <div>
              <Label required>טלפון</Label>
              <Input
                type="tel"
                inputMode="tel"
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                placeholder="050-0000000"
                dir="ltr"
                className="text-right"
              />
              <p className="mt-1 text-xs text-ink-400">לשם הזה נשלחת ההצעה בוואטסאפ.</p>
            </div>
            <div>
              <Label>כתובת</Label>
              <Input
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="רחוב, מספר, עיר"
              />
            </div>
            <div>
              <Label>ח.פ / ע.מ של הלקוח</Label>
              <Input
                value={customerTaxId}
                onChange={(e) => setCustomerTaxId(e.target.value)}
                placeholder="לחברות ולמוסדות"
                dir="ltr"
                className="text-right"
              />
            </div>
          </div>
        </section>

        {/* ---- what it is for ---- */}
        <section className="space-y-3 border-t border-ink-100 pt-4">
          <h4 className="text-sm font-extrabold text-ink-900">על מה ההצעה</h4>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label>תחום</Label>
              <Select
                value={professionId}
                onChange={(e) => {
                  setProfessionId(e.target.value);
                  setJobTypeId("");
                }}
              >
                <option value="">ללא</option>
                {professions
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </Select>
            </div>
            <div>
              <Label>סוג עבודה</Label>
              <Select value={jobTypeId} onChange={(e) => setJobTypeId(e.target.value)}>
                <option value="">ללא</option>
                {relevantJobTypes.map((jt) => (
                  <option key={jt.id} value={jt.id}>
                    {jt.name}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>כותרת ההצעה</Label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="למשל: שאיבת בור ספיגה ושטיפת קו ביוב"
            />
            <p className="mt-1 text-xs text-ink-400">
              מופיעה בראש ההצעה. אם תשאירו ריק, יופיעו התחום וסוג העבודה.
            </p>
          </div>
        </section>

        {/* ---- the breakdown ---- */}
        <section className="space-y-3 border-t border-ink-100 pt-4">
          <h4 className="text-sm font-extrabold text-ink-900">פירוט ומחירים</h4>
          <div className="space-y-2">
            {lines.map((line, i) => {
              const asDraft = {
                qty: Math.max(parseFloat(line.qty) || 1, 0.01),
                unit_price_agorot: shekelsToAgorot(line.price || "0"),
              };
              const rowTotal = lineTotal(asDraft);
              return (
                <div key={line.key} className="rounded-xl border border-ink-100 bg-ink-50/50 p-3">
                  <div className="flex items-start gap-2">
                    <span className="mt-2.5 w-4 shrink-0 text-xs font-bold text-ink-400">{i + 1}</span>
                    <div className="min-w-0 flex-1 space-y-2">
                      <Input
                        value={line.description}
                        onChange={(e) => patchLine(line.key, { description: e.target.value })}
                        placeholder="מה עושים — למשל: פתיחת סתימה בקו ראשי"
                        aria-label={`תיאור שורה ${i + 1}`}
                      />
                      <div className="flex items-center gap-2">
                        <div className="w-20 shrink-0">
                          <Input
                            type="number"
                            min={0}
                            step="0.5"
                            inputMode="decimal"
                            value={line.qty}
                            onChange={(e) => patchLine(line.key, { qty: e.target.value })}
                            placeholder="1"
                            aria-label={`כמות שורה ${i + 1}`}
                          />
                        </div>
                        <span className="shrink-0 text-xs font-bold text-ink-400">×</span>
                        <div className="min-w-0 flex-1">
                          <Input
                            type="number"
                            min={0}
                            inputMode="decimal"
                            value={line.price}
                            onChange={(e) => patchLine(line.key, { price: e.target.value })}
                            placeholder="מחיר ליחידה ₪"
                            aria-label={`מחיר שורה ${i + 1}`}
                          />
                        </div>
                        <span className="w-24 shrink-0 text-left text-sm font-extrabold text-ink-900">
                          {rowTotal > 0 ? formatAgorot(rowTotal) : "—"}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setLines((rows) =>
                          rows.length > 1 ? rows.filter((r) => r.key !== line.key) : [emptyLine()]
                        )
                      }
                      className="mt-1.5 rounded-lg p-1.5 text-ink-300 hover:bg-ink-100 hover:text-danger-600"
                      aria-label={`מחיקת שורה ${i + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <Button variant="secondary" size="sm" onClick={() => setLines((r) => [...r, emptyLine()])}>
            <Plus className="h-4 w-4" /> שורה נוספת
          </Button>

          <div className="flex items-center justify-between rounded-xl border border-brand-100 bg-brand-50/60 px-3.5 py-3">
            <span className="text-sm font-bold text-ink-900">סך הכל בהצעה</span>
            <span className="text-lg font-extrabold text-brand-700">{formatAgorot(total)}</span>
          </div>
        </section>

        {/* ---- how long it holds ---- */}
        <section className="space-y-3 border-t border-ink-100 pt-4">
          <h4 className="text-sm font-extrabold text-ink-900">תוקף והערות</h4>
          <div>
            <Label>ההצעה בתוקף עד</Label>
            <div className="mb-2 flex flex-wrap gap-2">
              {VALIDITY_CHOICES.map((days) => {
                const value = validUntilFrom(days);
                return (
                  <button
                    key={days}
                    type="button"
                    onClick={() => setValidUntil(value)}
                    className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                      validUntil === value
                        ? "border-brand-600 bg-brand-600 text-white"
                        : "border-ink-200 text-ink-600 hover:bg-ink-50"
                    }`}
                  >
                    {days} ימים
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setValidUntil("")}
                className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${
                  !validUntil
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-ink-200 text-ink-600 hover:bg-ink-50"
                }`}
              >
                בלי תוקף
              </button>
            </div>
            <Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />
          </div>
          <div>
            <Label>הערות ללקוח</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="למשל: המחיר אינו כולל פירוק ריצוף. התשלום במקום בסיום העבודה."
            />
            <p className="mt-1 text-xs text-ink-400">מופיעות בהצעה שהלקוח מקבל.</p>
          </div>
        </section>

        <div className="flex flex-col gap-2 border-t border-ink-100 pt-4 sm:flex-row">
          <Button
            fullWidth
            loading={busy === "send"}
            disabled={!canSend || busy === "save"}
            onClick={() => submit(true)}
          >
            <Send className="h-4 w-4" /> שמירה ושליחה בוואטסאפ
          </Button>
          <Button
            variant="secondary"
            fullWidth
            loading={busy === "save"}
            disabled={!canSave || busy === "send"}
            onClick={() => submit(false)}
          >
            <Save className="h-4 w-4" /> שמירה בלבד
          </Button>
        </div>
        {!canSave && (
          <p className="text-xs text-ink-400">
            כדי לשמור צריך שם לקוח ולפחות שורה אחת עם תיאור ומחיר.
          </p>
        )}
        {canSave && !canSend && (
          <p className="text-xs text-ink-400">כדי לשלוח בוואטסאפ צריך גם מספר טלפון.</p>
        )}
      </div>
    </Modal>
  );
}
