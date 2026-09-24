"use client";

import { useState } from "react";
import Link from "next/link";
import { Receipt as ReceiptIcon, Share2, Download, Loader2, MessageCircle, Check, AlertTriangle } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import { useRefData } from "@/lib/refdata";
import { formatAgorot, formatAgorotPlain } from "@/lib/money";
import { formatDateTimeHe } from "@/lib/dates";
import { buildWhatsappLink } from "@/lib/whatsapp";
import { deliverReceipt } from "@/lib/receipt/pdf";
import { businessOnReceipt } from "@/lib/receipt/render";
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

/**
 * Getting the receipt into the customer's hand.
 *
 * The chat comes first and the file second, which is the opposite of the
 * obvious order and the only one that works for a customer who is not in the
 * phone's address book: opening wa.me by number starts the conversation
 * whether or not they are saved, and once it exists they are in WhatsApp's
 * recent chats — so the share sheet that follows has somebody to send to.
 *
 * No browser can put a file into WhatsApp by itself. Two taps is the floor,
 * and this card makes them the right two.
 */
export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const toast = useToast();
  const { settings } = useRefData();
  const [busy, setBusy] = useState(false);
  const [chatOpened, setChatOpened] = useState(false);
  const shareable = canShareFiles();

  // what will actually head the receipt: what it captured, and the details in
  // force now wherever it captured nothing
  const biz = businessOnReceipt(receipt, settings);
  const unsigned = !biz.business_name || !biz.business_number;

  // the name and number go in the message too, so the customer can see who it
  // is from before they open anything — an unsaved number shows only digits
  const signature = [biz.business_name, biz.business_number ? `ע.פ ${biz.business_number}` : null]
    .filter(Boolean)
    .join(" · ");
  const wa = buildWhatsappLink(
    receipt.customer_phone,
    [
      `שלום ${receipt.customer_name}, מצורפת הקבלה על סך ${formatAgorotPlain(receipt.amount_agorot)} (קבלה מס׳ ${receipt.receipt_number}).`,
      signature || null,
      "תודה!",
    ]
      .filter(Boolean)
      .join("\n")
  );

  function openChat() {
    if (!wa) return;
    // opened straight from the tap, so the browser treats it as wanted
    window.open(wa, "_blank", "noopener");
    setChatOpened(true);
  }

  async function sendFile() {
    setBusy(true);
    try {
      const how = await deliverReceipt(receipt, settings);
      if (how === "downloaded") toast.success("הקבלה ירדה למכשיר — אפשר לצרף אותה לשיחה");
      else if (how === "shared") toast.success("הקבלה נשלחה");
    } catch {
      toast.error("שגיאה ביצירת הקבלה. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ReceiptIcon className="h-5 w-5 text-ink-400" /> קבלה מס׳ {receipt.receipt_number}
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-ink-500">
          {formatAgorot(receipt.amount_agorot)} · {receipt.customer_name} · הופקה{" "}
          {formatDateTimeHe(receipt.issued_at)}
        </p>

        {unsigned ? (
          // a receipt with no business on it is not a receipt, and nothing in
          // the flow would otherwise say so until the customer asked
          <Link
            href="/settings"
            className="flex items-start gap-2 rounded-xl bg-warning-50 px-3.5 py-3 text-xs font-semibold text-warning-700 hover:bg-warning-100"
          >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {!biz.business_name && !biz.business_number
                ? "בקבלה לא מופיעים שם העסק ומספר העוסק. "
                : !biz.business_name
                  ? "בקבלה לא מופיע שם העסק. "
                  : "בקבלה לא מופיע מספר העוסק. "}
              אפשר למלא אותם בהגדרות ← ״פרטי העסק לקבלות״, והם יופיעו גם בקבלות שכבר הופקו.
            </span>
          </Link>
        ) : (
          <p className="text-xs text-ink-400">
            הקבלה תצא על שם {biz.business_name}
            {biz.business_number ? ` · ע.פ ${biz.business_number}` : ""}
          </p>
        )}

        {wa ? (
          <>
            <button
              type="button"
              onClick={openChat}
              className="btn-success flex w-full flex-col items-center gap-0.5 py-3"
            >
              <span className="flex items-center gap-2 text-base">
                {chatOpened ? <Check className="h-5 w-5" /> : <MessageCircle className="h-5 w-5" />}
                {chatOpened ? "פתיחת השיחה שוב" : `שליחת הקבלה ל${receipt.customer_name} ב-WhatsApp`}
              </span>
              <span className="text-xs font-semibold text-white/85" dir="ltr">
                {receipt.customer_phone}
              </span>
            </button>

            <button
              type="button"
              onClick={sendFile}
              disabled={busy}
              className={`flex w-full items-center justify-center gap-2 py-3 disabled:opacity-60 ${
                chatOpened ? "btn-primary" : "btn-secondary"
              }`}
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : shareable ? (
                <Share2 className="h-5 w-5" />
              ) : (
                <Download className="h-5 w-5" />
              )}
              {shareable ? "צירוף הקבלה לשיחה" : "הורדת הקבלה (PDF)"}
            </button>

            <p className="text-xs text-ink-400">
              {chatOpened
                ? shareable
                  ? "השיחה נפתחה. עכשיו לחצו כאן, בחרו WhatsApp ואת השיחה עם הלקוח — הקובץ יישלח."
                  : "השיחה נפתחה. הורידו את הקבלה וגררו אותה לתוך השיחה."
                : "הכפתור הירוק פותח את השיחה לפי המספר — הלקוח לא חייב להיות שמור אצלכם באנשי הקשר. אחרי שהיא נפתחת, שולחים את הקובץ."}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={sendFile}
              disabled={busy}
              className="btn-primary flex w-full items-center justify-center gap-2 py-3 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
              הורדת הקבלה (PDF)
            </button>
            <p className="text-xs text-ink-400">
              לא נשמר מספר טלפון ללקוח הזה, אז אי אפשר לפתוח שיחה. אפשר להוריד את הקבלה ולשלוח
              אותה בכל דרך אחרת.
            </p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
