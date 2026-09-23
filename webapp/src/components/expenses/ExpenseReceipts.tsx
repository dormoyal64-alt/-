"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { formatBytes } from "@/lib/images";
import { errorMessage } from "@/lib/errors";
import { uploadExpenseReceipt, deleteExpenseReceipt, receiptUrl } from "@/lib/api/expenseReceipts";
import type { ExpenseReceipt } from "@/lib/types";

/**
 * The paper receipt, photographed and kept with the expense it paid for.
 *
 * Meant to be used at the counter: the button opens the camera on a phone and
 * the file picker on a desktop, and what comes back is shrunk before it is
 * uploaded. Each photograph can be opened full size or removed.
 */
export function ExpenseReceipts({
  expenseId,
  receipts,
  onChange,
}: {
  expenseId: string;
  receipts: ExpenseReceipt[];
  onChange: () => void | Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<{ receipt: ExpenseReceipt; url: string } | null>(null);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await uploadExpenseReceipt(supabase, expenseId, file);
      }
      await onChange();
      toast.success(files.length > 1 ? `${files.length} קבלות צורפו` : "הקבלה צורפה");
    } catch (e) {
      toast.error(errorMessage(e, "שגיאה בהעלאת הקבלה"));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function view(receipt: ExpenseReceipt) {
    const url = await receiptUrl(supabase, receipt.storage_path);
    if (!url) return toast.error("לא הצלחנו לפתוח את הקבלה");
    setViewing({ receipt, url });
  }

  async function remove(receipt: ExpenseReceipt) {
    setBusy(true);
    try {
      await deleteExpenseReceipt(supabase, receipt);
      setViewing(null);
      await onChange();
      toast.success("הקבלה נמחקה");
    } catch (e) {
      toast.error(errorMessage(e, "שגיאה במחיקת הקבלה"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />

      <button
        type="button"
        onClick={() => (receipts.length > 0 ? setOpen(true) : input.current?.click())}
        disabled={busy}
        className={`flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold transition ${
          receipts.length > 0
            ? "bg-brand-50 text-brand-700 hover:bg-brand-100"
            : "text-ink-300 hover:bg-ink-100 hover:text-ink-700"
        }`}
        aria-label={receipts.length > 0 ? `${receipts.length} קבלות מצורפות` : "צילום קבלה"}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : receipts.length > 0 ? (
          <>
            <Paperclip className="h-3.5 w-3.5" /> {receipts.length}
          </>
        ) : (
          <Camera className="h-4 w-4" />
        )}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="קבלות מצורפות">
        <div className="space-y-3">
          <div className="divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100">
            {receipts.map((r) => (
              <div key={r.id} className="flex items-center gap-2 px-3.5 py-2.5">
                <button
                  type="button"
                  onClick={() => view(r)}
                  className="min-w-0 flex-1 truncate text-right text-sm font-semibold text-brand-700 hover:underline"
                >
                  {r.file_name || "קבלה"}
                </button>
                <span className="shrink-0 text-xs text-ink-400">{formatBytes(r.size_bytes)}</span>
                <button
                  type="button"
                  onClick={() => remove(r)}
                  disabled={busy}
                  className="shrink-0 rounded-lg p-1.5 text-ink-400 hover:bg-ink-100 hover:text-danger-600"
                  aria-label="מחיקת הקבלה"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className="btn-secondary flex w-full items-center justify-center gap-2 py-2.5"
          >
            <Camera className="h-4 w-4" /> צילום קבלה נוספת
          </button>
          <p className="text-xs text-ink-400">
            הקבלות האלה נשלחות מצורפות לרואה החשבון יחד עם הדוח החודשי.
          </p>
        </div>
      </Modal>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing?.receipt.file_name ?? "קבלה"}
        size="lg"
      >
        {viewing && (
          <div className="space-y-3">
            {viewing.receipt.content_type === "application/pdf" ? (
              <a
                href={viewing.url}
                target="_blank"
                rel="noreferrer"
                className="btn-primary flex w-full justify-center py-3"
              >
                פתיחת הקובץ
              </a>
            ) : (
              // a photograph of a receipt, at whatever size it was taken
              // eslint-disable-next-line @next/next/no-img-element
              <img src={viewing.url} alt="קבלה" className="max-h-[70vh] w-full rounded-xl object-contain" />
            )}
            <div className="flex gap-2">
              <button onClick={() => setViewing(null)} className="btn-secondary flex flex-1 items-center justify-center gap-2 py-2.5">
                <X className="h-4 w-4" /> סגירה
              </button>
              <button
                onClick={() => remove(viewing.receipt)}
                disabled={busy}
                className="btn-danger flex flex-1 items-center justify-center gap-2 py-2.5"
              >
                <Trash2 className="h-4 w-4" /> מחיקה
              </button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
