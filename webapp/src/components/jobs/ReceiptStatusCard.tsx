"use client";

import { useMemo, useState } from "react";
import { FileCheck, FileX, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { markJobWithoutReceipt, markJobWithReceipt } from "@/lib/api/jobs";
import { errorMessage } from "@/lib/errors";
import type { JobWithRelations, Receipt } from "@/lib/types";

/**
 * Whether this job counts as declared income, changeable after the closing.
 *
 * The tick goes on in a hurry at closing time and is sometimes wrong — the
 * customer asked for a receipt and then paid cash without one. Leaving it wrong
 * means the month's report to the accountant is wrong, so it has to be
 * correctable afterwards, in the one place the job already is.
 *
 * Two quite different things hide behind the same tick, and the card does not
 * pretend otherwise. If nothing was ever issued, this is a note being
 * corrected. If a numbered receipt exists, it is a tax document: it can be
 * cancelled but not unhappened, its number stays in the sequence, and the card
 * says so before it asks.
 */
export function ReceiptStatusCard({
  job,
  receipt,
  onChanged,
}: {
  job: JobWithRelations;
  /** the receipt the job carries, live or cancelled; null when none was issued */
  receipt: Receipt | null;
  onChanged: () => void | Promise<void>;
}) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [asking, setAsking] = useState<"remove" | "restore" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  // the database carries the column only after the migration; until then the
  // action cannot work, so it is not offered
  const supported = !receipt || "cancelled_at" in receipt;
  const live = receipt && !receipt.cancelled_at ? receipt : null;
  const counted = job.closed_with_receipt || !!live;

  async function apply(next: "remove" | "restore") {
    setBusy(true);
    try {
      if (next === "remove") {
        await markJobWithoutReceipt(supabase, job.id, {
          // the dialog has already said, in as many words, what this cancels
          cancelIssued: !!live,
          reason,
        });
        toast.success(live ? `קבלה ${live.receipt_number} בוטלה` : "העבודה סומנה כנסגרה ללא קבלה");
      } else {
        await markJobWithReceipt(supabase, job.id);
        toast.success("העבודה סומנה כנסגרה עם קבלה");
      }
      setAsking(null);
      setReason("");
      await onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "שגיאה בעדכון"));
    } finally {
      setBusy(false);
    }
  }

  if (!supported) return null;

  return (
    <>
      <Card>
        <CardBody className="flex flex-wrap items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              counted ? "bg-success-50 text-success-600" : "bg-ink-100 text-ink-400"
            }`}
          >
            {counted ? <FileCheck className="h-5 w-5" /> : <FileX className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-900">
              {counted ? "נסגרה עם קבלה" : "נסגרה ללא קבלה"}
            </p>
            <p className="text-xs text-ink-500">
              {counted
                ? "נכללת בדוח החודשי לרואה החשבון"
                : receipt?.cancelled_at
                  ? `קבלה ${receipt.receipt_number} בוטלה — העבודה לא נכללת בדוח לרואה החשבון`
                  : "לא נכללת בדוח החודשי לרואה החשבון"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setAsking(counted ? "remove" : "restore")}
            disabled={busy}
            className="shrink-0 rounded-xl border border-ink-200 px-3.5 py-2 text-sm font-bold text-ink-600 transition hover:bg-ink-50 disabled:opacity-60"
          >
            {counted ? "שינוי ל״ללא קבלה״" : "סימון כנסגרה עם קבלה"}
          </button>
        </CardBody>
      </Card>

      <Modal
        open={asking === "remove"}
        onClose={() => !busy && setAsking(null)}
        title={live ? `לבטל את קבלה מספר ${live.receipt_number}?` : "לסמן שהעבודה נסגרה ללא קבלה?"}
      >
        <div className="space-y-3">
          {live ? (
            <>
              <p className="text-sm text-ink-600">
                הופקה לעבודה הזו קבלה ממוספרת. אי אפשר למחוק קבלה — אפשר לבטל אותה, וזה מה שיקרה:
              </p>
              <ul className="space-y-1.5 rounded-xl bg-ink-50 px-4 py-3 text-sm text-ink-600">
                <li>• הקבלה תסומן כמבוטלת, <b>והמספר {live.receipt_number} יישאר תפוס</b> — כדי שלא יהיה חור ברצף המספרים.</li>
                <li>• העבודה תצא מהדוח החודשי לרואה החשבון.</li>
                <li>• אם כבר שלחת את הקבלה ללקוח — היא אצלו. כדאי לעדכן אותו.</li>
                <li>• תמיד אפשר להפיק קבלה חדשה לעבודה הזו; היא תקבל מספר חדש.</li>
              </ul>
            </>
          ) : (
            <p className="text-sm text-ink-600">
              לא הופקה קבלה ממוספרת לעבודה הזו — רק סומן בסגירה שהיא נסגרה עם קבלה. הסימון יוסר
              והעבודה תצא מהדוח החודשי לרואה החשבון.
            </p>
          )}

          <div>
            <Label>סיבה (לא חובה)</Label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="הלקוח שילם במזומן בלי קבלה"
            />
            <p className="mt-1 text-xs text-ink-400">נשמר בציר הזמן של העבודה, כדי שיהיה ברור אחר כך למה.</p>
          </div>

          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setAsking(null)} disabled={busy}>
              ביטול
            </Button>
            <Button variant="danger" fullWidth onClick={() => apply("remove")} loading={busy}>
              {live ? `ביטול קבלה ${live.receipt_number}` : "סימון כללא קבלה"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={asking === "restore"}
        onClose={() => !busy && setAsking(null)}
        title="לסמן שהעבודה נסגרה עם קבלה?"
      >
        <div className="space-y-3">
          <p className="text-sm text-ink-600">
            העבודה תיכלל שוב בדוח החודשי לרואה החשבון.
            {receipt?.cancelled_at
              ? ` הקבלה שבוטלה (${receipt.receipt_number}) נשארת מבוטלת — אם צריך מסמך ללקוח, הפיקו קבלה חדשה והיא תקבל מספר חדש.`
              : " אם צריך גם מסמך ללקוח, אפשר להפיק קבלה מיד אחרי זה."}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setAsking(null)} disabled={busy}>
              ביטול
            </Button>
            <Button fullWidth onClick={() => apply("restore")} loading={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "סימון כנסגרה עם קבלה"}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
