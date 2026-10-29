"use client";

import { useState } from "react";
import { Copy, Check, MessageCircle, FileDown, Loader2, Share2 } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import { buildWhatsappLink } from "@/lib/whatsapp";
import { canShareFiles, deliverQuote } from "@/lib/quote/pdf";
import type { QuoteBusiness } from "@/lib/quote/render";
import type { Quote, QuoteLine } from "@/lib/types";

/**
 * The quote as the customer will receive it, and the two taps that send it.
 *
 * The chat comes first and the file second, which is the opposite of the
 * obvious order and the only one that works for a customer who is not in the
 * phone's address book: opening wa.me by number starts the conversation
 * whether or not they are saved, and once it exists they are in WhatsApp's
 * recent chats — so the share sheet that follows has somebody to send to.
 *
 * No browser can put a file into WhatsApp by itself. Two taps is the floor,
 * and this makes them the right two. On a desktop there is no share sheet at
 * all, so the PDF is saved and attached by hand.
 */
export function QuotePreviewModal({
  open,
  onClose,
  title,
  quote,
  lines,
  business,
  subject,
  message,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  quote: Quote | null;
  lines: QuoteLine[];
  business: QuoteBusiness;
  subject: string | null;
  /** the short covering note that opens the chat */
  message: string;
  onSent: () => void;
}) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [chatOpened, setChatOpened] = useState(false);
  const shareable = canShareFiles();
  const link = buildWhatsappLink(quote?.customer_phone, message);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  async function sendFile() {
    if (!quote) return;
    setBusy(true);
    try {
      const how = await deliverQuote(quote, lines, business, subject);
      if (how === "downloaded") toast.success("הקובץ ירד למכשיר — אפשר לצרף אותו לשיחה");
      else if (how === "shared") {
        toast.success("ההצעה נשלחה");
        onSent();
      }
    } catch {
      toast.error("שגיאה ביצירת הקובץ. נסו שוב.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-3">
        <p className="text-sm text-ink-500">
          {shareable
            ? "שני שלבים: פותחים את השיחה עם הלקוח, ואז שולחים לו את הקובץ."
            : "פותחים את השיחה עם הלקוח, מורידים את הקובץ ומצרפים אותו לשיחה."}
        </p>

        {/* 1 — the chat */}
        {link ? (
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => {
              setChatOpened(true);
              onSent();
            }}
            className={`${chatOpened ? "btn-secondary" : "btn-success"} w-full px-4 py-2.5 text-[15px]`}
          >
            {chatOpened ? <Check className="h-4 w-4" /> : <MessageCircle className="h-4 w-4" />}
            {chatOpened ? "השיחה נפתחה" : "1. פתיחת השיחה בוואטסאפ"}
          </a>
        ) : (
          <p className="rounded-xl border border-warning-100 bg-warning-50 px-3.5 py-2.5 text-sm text-ink-700">
            ללקוח אין מספר טלפון תקין, אז אי אפשר לפתוח שיחה מכאן — אפשר להוריד את הקובץ ולשלוח אותו
            איך שנוח.
          </p>
        )}

        {/* 2 — the file */}
        <Button
          fullWidth
          variant={chatOpened || !link ? "primary" : "secondary"}
          loading={busy}
          onClick={sendFile}
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : shareable ? (
            <Share2 className="h-4 w-4" />
          ) : (
            <FileDown className="h-4 w-4" />
          )}
          {link ? "2. " : ""}
          {shareable ? "שליחת הקובץ (PDF)" : "הורדת הקובץ (PDF)"}
        </Button>

        <details className="rounded-xl border border-ink-100">
          <summary className="cursor-pointer px-3.5 py-2.5 text-sm font-semibold text-ink-700">
            ההודעה שנפתחת בשיחה
          </summary>
          <div className="border-t border-ink-100 p-3">
            <pre className="max-h-[32vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-ink-50 p-3.5 text-[13px] leading-relaxed text-ink-800">
              {message}
            </pre>
            <Button variant="secondary" size="sm" className="mt-2" onClick={copy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "הועתק" : "העתקת הטקסט"}
            </Button>
          </div>
        </details>
      </div>
    </Modal>
  );
}
