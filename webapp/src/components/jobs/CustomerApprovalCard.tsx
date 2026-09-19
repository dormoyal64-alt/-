"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, MessageCircle, Send, Undo2 } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import {
  buildCancellationNotice,
  buildOnTheWayMessage,
  buildOrderApprovedMessage,
  buildOrderConfirmationMessage,
  buildWhatsappLink,
  contactPhone,
} from "@/lib/whatsapp";
import { formatAgorot } from "@/lib/money";
import { formatDateTimeHe } from "@/lib/dates";
import type { AppSettings, JobWithRelations } from "@/lib/types";
import type { ConfirmationStep } from "@/lib/api/jobs";

/**
 * Getting the call-out fee agreed, in the three steps it actually takes.
 *
 * The order goes out, the customer confirms it in their own words, and only
 * then is the tradesperson released. Each step is stamped as it happens, so
 * the job carries the evidence rather than someone's memory of the call.
 */
export function CustomerApprovalCard({
  job,
  settings,
  onStamp,
}: {
  job: JobWithRelations;
  settings: AppSettings | null;
  onStamp: (step: ConfirmationStep, at: string | null) => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<"order" | "dispatch" | null>(null);

  const technician = job.profession?.technician_label?.trim() || "הטכנאי";
  const confirmed = !!job.customer_confirmed_at;

  const orderMessage = buildOrderConfirmationMessage(job, settings);
  const orderLink = buildWhatsappLink(job.customer_phone, orderMessage);
  // once they have agreed the message names the fee they agreed to; until then
  // it is the plain "on the way", which promises nothing about money
  const dispatchMessage = confirmed
    ? buildOrderApprovedMessage(job, settings)
    : buildOnTheWayMessage(job, settings?.on_the_way_template, buildCancellationNotice(settings));
  const dispatchLink = buildWhatsappLink(job.customer_phone, dispatchMessage);

  const fee = formatAgorot(settings?.visit_fee_agorot ?? 49900);
  const missingContact = !contactPhone(settings);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5 text-ink-400" /> הודעות ואישור מול הלקוח
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        {missingContact && (
          <p className="rounded-xl bg-warning-50 px-3 py-2 text-xs font-semibold text-warning-700">
            לא הוגדר מספר ליצירת קשר — כפתור האישור בלחיצה אחת לא ייכלל בהודעה. אפשר להגדיר אותו
            בהגדרות כלליות.
          </p>
        )}

        <Step
          index={1}
          title="שליחת פרטי ההזמנה לאישור"
          note={`כולל דמי ביקור ואבחון ${fee} וכפתור אישור בלחיצה אחת`}
          doneAt={job.confirmation_sent_at}
          doneLabel="נשלח"
          href={orderLink}
          onSend={() => onStamp("confirmation_sent_at", new Date().toISOString())}
          onPreview={() => setPreview(preview === "order" ? null : "order")}
          previewOpen={preview === "order"}
          message={orderMessage}
        />

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ink-100 px-3.5 py-3">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-extrabold text-ink-500">
            2
          </span>
          {confirmed ? (
            <>
              <CheckCircle2 className="h-[18px] w-[18px] shrink-0 text-success-600" />
              <span className="min-w-0 flex-1 text-sm font-bold text-ink-900">
                הלקוח אישר · {formatDateTimeHe(job.customer_confirmed_at!)}
              </span>
              <button
                type="button"
                onClick={() => onStamp("customer_confirmed_at", null)}
                className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-bold text-ink-400 hover:bg-ink-100 hover:text-ink-700"
              >
                <Undo2 className="h-3.5 w-3.5" /> ביטול הסימון
              </button>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1 text-sm font-semibold text-ink-600">
                כשהאישור חוזר בוואטסאפ — סמנו אותו כאן
              </span>
              <button
                type="button"
                onClick={() => onStamp("customer_confirmed_at", new Date().toISOString())}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-success-200 bg-success-50 px-3 py-2 text-sm font-bold text-success-700 hover:bg-success-100/70"
              >
                <CheckCircle2 className="h-4 w-4" /> הלקוח אישר
              </button>
            </>
          )}
        </div>

        <Step
          index={3}
          title={confirmed ? `ההזמנה אושרה — ${technician} יצא לדרך` : `הודעה ללקוח ש${technician} בדרך`}
          note={
            confirmed
              ? `ההודעה תציין שדמי הביקור שאושרו הם ${fee}`
              : "הלקוח עדיין לא אישר — תישלח ההודעה הקצרה, בלי אישור דמי הביקור"
          }
          doneAt={job.dispatch_sent_at}
          doneLabel="נשלח"
          href={dispatchLink}
          onSend={() => onStamp("dispatch_sent_at", new Date().toISOString())}
          onPreview={() => setPreview(preview === "dispatch" ? null : "dispatch")}
          previewOpen={preview === "dispatch"}
          message={dispatchMessage}
        />
      </CardBody>
    </Card>
  );
}

function Step({
  index,
  title,
  note,
  doneAt,
  doneLabel,
  href,
  onSend,
  onPreview,
  previewOpen,
  message,
}: {
  index: number;
  title: string;
  note: string;
  doneAt: string | null;
  doneLabel: string;
  href: string | null;
  onSend: () => void | Promise<void>;
  onPreview: () => void;
  previewOpen: boolean;
  message: string;
}) {
  return (
    <div className="rounded-xl border border-ink-100">
      <div className="flex flex-wrap items-center gap-2 px-3.5 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink-100 text-xs font-extrabold text-ink-500">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink-900">{title}</p>
          <p className="text-xs text-ink-500">{note}</p>
          {doneAt && (
            <p className="mt-0.5 flex items-center gap-1 text-xs font-bold text-success-600">
              <CheckCircle2 className="h-3.5 w-3.5" /> {doneLabel} · {formatDateTimeHe(doneAt)}
            </p>
          )}
        </div>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            onClick={onSend}
            className="btn-success flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-sm"
          >
            <Send className="h-4 w-4" />
            {doneAt ? "שליחה שוב" : "שליחה"}
          </a>
        ) : (
          <span className="shrink-0 text-xs font-semibold text-ink-400">אין טלפון ללקוח</span>
        )}
      </div>
      <button
        type="button"
        onClick={onPreview}
        className="flex w-full items-center justify-center gap-1 border-t border-ink-100 py-1.5 text-xs font-bold text-ink-400 hover:bg-ink-50 hover:text-ink-700"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition ${previewOpen ? "rotate-180" : ""}`} />
        {previewOpen ? "סגירת התצוגה" : "מה ייכתב ללקוח"}
      </button>
      {previewOpen && (
        <p className="whitespace-pre-line border-t border-ink-100 bg-ink-50 px-3.5 py-3 text-sm text-ink-700">
          {message}
        </p>
      )}
    </div>
  );
}
