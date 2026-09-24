"use client";

import { useMemo, useRef, useState } from "react";
import { Camera, ImagePlus, Loader2, Paperclip, Trash2, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Modal } from "@/components/ui/Modal";
import { formatBytes } from "@/lib/images";
import { errorMessage } from "@/lib/errors";
import { uploadReceiptFile, deleteReceiptFile, receiptUrl, type ReceiptParent } from "@/lib/api/expenseReceipts";
import type { ExpenseReceipt } from "@/lib/types";

/**
 * The paper, photographed and kept with the record it proves.
 *
 * Meant to be used where the paper is handed over: the button opens the camera
 * on a phone and the file picker on a desktop, and what comes back is shrunk
 * before it is uploaded. Each photograph can be opened full size or removed.
 *
 * It serves a purchase the business made and a receipt a contractor handed
 * over alike — the two differ only in which record they hang off and what the
 * empty state should call them, so both go through here rather than through
 * two screens that would drift apart.
 */
export function ReceiptFiles({
  parent,
  receipts,
  onChange,
  open: openProp,
  onOpenChange,
}: {
  parent: ReceiptParent;
  receipts: ExpenseReceipt[];
  onChange: () => void | Promise<void>;
  /** leave unset to let the button manage the dialog; set it to open it from outside */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  // two inputs, because a phone treats them differently: one opens the camera,
  // the other the photo library. A single input cannot offer both.
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  // a caller can drive the dialog — a record created for a receipt someone is
  // holding should ask for it at once, rather than waiting to be clicked again
  const [openSelf, setOpenSelf] = useState(false);
  const open = openProp ?? openSelf;
  const setOpen = (next: boolean) => {
    setOpenSelf(next);
    onOpenChange?.(next);
  };
  const [viewing, setViewing] = useState<{ receipt: ExpenseReceipt; url: string } | null>(null);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      for (const file of Array.from(files)) {
        await uploadReceiptFile(supabase, parent, file);
      }
      await onChange();
      toast.success(files.length > 1 ? `${files.length} קבלות צורפו` : "הקבלה צורפה");
    } catch (e) {
      toast.error(errorMessage(e, "שגיאה בהעלאת הקבלה"));
    } finally {
      setBusy(false);
      // clearing lets the same file be chosen twice in a row
      if (camera.current) camera.current.value = "";
      if (gallery.current) gallery.current.value = "";
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
      await deleteReceiptFile(supabase, receipt);
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
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />
      <input
        ref={gallery}
        type="file"
        accept="image/*,application/pdf"
        multiple
        className="hidden"
        onChange={(e) => add(e.target.files)}
      />

      <button
        type="button"
        onClick={() => setOpen(true)}
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
          {receipts.length === 0 && (
            <p className="text-sm text-ink-500">
              {parent.kind === "contractor"
                ? "עדיין לא צורפה הקבלה מהקבלן. אפשר לצלם אותה עכשיו, או לבחור תמונה שכבר שמורה בטלפון."
                : "עדיין לא צורפה קבלה להוצאה הזו. אפשר לצלם אותה עכשיו, או לבחור תמונה שכבר שמורה בטלפון."}
            </p>
          )}

          <div
            className={`divide-y divide-ink-100 overflow-hidden rounded-2xl border border-ink-100 ${
              receipts.length === 0 ? "hidden" : ""
            }`}
          >
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
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => camera.current?.click()}
              disabled={busy}
              className="btn-primary flex items-center justify-center gap-2 py-2.5"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
              צילום קבלה
            </button>
            <button
              type="button"
              onClick={() => gallery.current?.click()}
              disabled={busy}
              className="btn-secondary flex items-center justify-center gap-2 py-2.5"
            >
              <ImagePlus className="h-4 w-4" /> בחירה מהגלריה
            </button>
          </div>
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
