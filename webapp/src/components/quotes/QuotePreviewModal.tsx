"use client";

import { useState } from "react";
import { Copy, Check, MessageCircle } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { buildWhatsappLink } from "@/lib/whatsapp";

/**
 * The quote exactly as the customer will receive it.
 *
 * Shown before anything is sent, because a price leaves the business the
 * moment the message does and there is no taking it back. The WhatsApp button
 * is a real link rather than a scripted window: a browser only opens a new tab
 * for a tap the person actually made, and a send that silently does nothing is
 * worse than one that asks for a tap.
 */
export function QuotePreviewModal({
  open,
  onClose,
  title,
  message,
  phone,
  onSent,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  message: string;
  phone: string | null;
  onSent: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const link = buildWhatsappLink(phone, message);

  async function copy() {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      <div className="space-y-3">
        <p className="text-sm text-ink-500">זה בדיוק הטקסט שיגיע ללקוח בוואטסאפ.</p>

        <pre className="max-h-[45vh] overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-ink-100 bg-ink-50 p-4 text-[13px] leading-relaxed text-ink-800">
          {message}
        </pre>

        <div className="flex flex-col gap-2 sm:flex-row">
          {link ? (
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onSent}
              className="btn-success flex-1 px-4 py-2.5 text-[15px]"
            >
              <MessageCircle className="h-4 w-4" /> פתיחת וואטסאפ ושליחה
            </a>
          ) : (
            <p className="flex-1 rounded-xl border border-warning-100 bg-warning-50 px-3.5 py-2.5 text-sm text-ink-700">
              ללקוח אין מספר טלפון תקין, אז אי אפשר לשלוח מכאן — אפשר להעתיק את הטקסט ולשלוח ידנית.
            </p>
          )}
          <Button variant="secondary" onClick={copy}>
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? "הועתק" : "העתקת הטקסט"}
          </Button>
        </div>

        <p className="text-xs text-ink-400">
          וואטסאפ ייפתח עם ההודעה מוכנה בשיחה עם הלקוח — נשאר רק ללחוץ שליחה.
        </p>
      </div>
    </Modal>
  );
}
