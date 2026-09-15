"use client";

import { useState } from "react";
import { Receipt as ReceiptIcon, Share2, Download, Loader2, MessageCircle } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { formatAgorot } from "@/lib/money";
import { formatDateTimeHe } from "@/lib/dates";
import { buildWhatsappLink } from "@/lib/whatsapp";
import { deliverReceipt } from "@/lib/receipt/pdf";
import type { Receipt } from "@/lib/types";

/** True on a device whose share sheet accepts a file — phones, essentially. */
function canShareFiles() {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (typeof nav.share !== "function" || typeof nav.canShare !== "function") return false;
  try {
    return nav.canShare({ files: [new File([new Blob(["x"])], "x.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const shareable = canShareFiles();

  async function send() {
    setBusy(true);
    try {
      const how = await deliverReceipt(receipt);
      if (how === "downloaded") toast.success("הקבלה ירדה למכשיר — אפשר לצרף אותה לוואטסאפ");
      else if (how === "shared") toast.success("הקבלה נשלחה");
    } catch {
      toast.error("שגיאה ביצירת הקבלה. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  const wa = buildWhatsappLink(
    receipt.customer_phone,
    `שלום ${receipt.customer_name}, מצורפת הקבלה על סך ${formatAgorot(receipt.amount_agorot)} (קבלה מס׳ ${receipt.receipt_number}). תודה!`
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptIcon className="h-5 w-5 text-ink-400" /> קבלה מס׳ {receipt.receipt_number}
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-500">
          {formatAgorot(receipt.amount_agorot)} · {receipt.customer_name} · הופקה {formatDateTimeHe(receipt.issued_at)}
        </p>

        <button
          type="button"
          onClick={send}
          disabled={busy}
          className="btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : shareable ? <Share2 className="h-5 w-5" /> : <Download className="h-5 w-5" />}
          {shareable ? "שליחת הקבלה ללקוח" : "הורדת הקבלה (PDF)"}
        </button>

        {/* On a desktop the file can only be saved, so the message is opened
            separately and the PDF attached by hand — a browser cannot put a
            file into WhatsApp on its own. */}
        {!shareable && wa && (
          <a
            href={wa}
            target="_blank"
            rel="noreferrer"
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-success-100 bg-success-50 py-2.5 text-sm font-bold text-success-700 hover:bg-success-100/60"
          >
            <MessageCircle className="h-4 w-4" />
            פתיחת WhatsApp ללקוח (לצרף את הקובץ)
          </a>
        )}

        <p className="text-xs text-ink-400">
          {shareable
            ? "ייפתח חלון השיתוף של הטלפון — בוחרים WhatsApp ואת הלקוח, והקובץ נשלח."
            : "בטלפון אפשר לשלוח את הקבלה ישירות לוואטסאפ בלחיצה אחת."}
        </p>
      </CardBody>
    </Card>
  );
}
