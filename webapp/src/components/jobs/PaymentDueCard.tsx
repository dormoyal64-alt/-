"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Undo2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { formatAgorot } from "@/lib/money";
import { formatDateHe, todayLocalDate } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import { dueLabel, markJobPaid, markJobUnpaid, termsLabel } from "@/lib/api/annual";
import type { JobWithRelations } from "@/lib/types";

/**
 * Money a job is owed, and the day it was finally paid.
 *
 * A job on terms is finished work that has not been paid for, which is a
 * different thing from a closed job — it is not in the year's turnover, it
 * cannot have a receipt yet, and somebody has to remember to look at the bank.
 * This is where that is remembered, and where the day the transfer landed is
 * written down, because the receipt will carry it.
 */
export function PaymentDueCard({ job, onChanged }: { job: JobWithRelations; onChanged: () => void }) {
  const supabase = useMemo(() => createClient(), []);
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const [paidOn, setPaidOn] = useState(todayLocalDate());
  const [busy, setBusy] = useState(false);

  const terms = job.payment_terms_days ?? 0;
  if (!job.is_closed || terms <= 0) return null;

  const due = dueLabel(job.payment_due_on);
  const paid = !!job.paid_at;

  async function confirm() {
    setBusy(true);
    try {
      await markJobPaid(supabase, job.id, paidOn || null);
      toast.success("סומן שהתשלום התקבל");
      setAsking(false);
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לסמן את התשלום"));
    } finally {
      setBusy(false);
    }
  }

  async function undo() {
    setBusy(true);
    try {
      await markJobUnpaid(supabase, job.id);
      toast.success("הסימון בוטל — העבודה חזרה לרשימת הממתינות");
      onChanged();
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לבטל את הסימון"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Card
        className={
          paid ? "border-success-100" : due.late ? "border-2 border-danger-200" : "border-warning-100"
        }
      >
        <CardBody className="flex flex-wrap items-center gap-3">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
              paid
                ? "bg-success-50 text-success-600"
                : due.late
                  ? "bg-danger-50 text-danger-600"
                  : "bg-warning-50 text-warning-600"
            }`}
          >
            {paid ? (
              <CheckCircle2 className="h-5 w-5" />
            ) : due.late ? (
              <AlertTriangle className="h-5 w-5" />
            ) : (
              <CalendarClock className="h-5 w-5" />
            )}
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-900">
              {paid ? "התשלום התקבל" : due.late ? "התשלום מאחר" : "ממתין לתשלום"}
              <span className="mr-1.5 text-xs font-bold text-ink-400">{termsLabel(terms)}</span>
            </p>
            <p className="text-xs text-ink-500">
              {paid ? (
                <>
                  נכנס ב־<bdi className="font-bold">{formatDateHe(job.paid_at!)}</bdi> ·{" "}
                  {formatAgorot(job.final_price_agorot ?? 0)}
                </>
              ) : (
                <>
                  אמור להיכנס עד{" "}
                  <bdi className="font-bold">
                    {job.payment_due_on ? formatDateHe(job.payment_due_on) : "—"}
                  </bdi>{" "}
                  · <span className={due.late ? "font-bold text-danger-600" : ""}>{due.text}</span>
                  {job.institution_ref ? ` · הזמנה ${job.institution_ref}` : ""}
                </>
              )}
            </p>
          </div>

          {paid ? (
            <Button variant="secondary" onClick={undo} loading={busy} className="shrink-0">
              <Undo2 className="h-4 w-4" /> ביטול הסימון
            </Button>
          ) : (
            <Button
              onClick={() => {
                setPaidOn(todayLocalDate());
                setAsking(true);
              }}
              className="shrink-0"
            >
              <CheckCircle2 className="h-4 w-4" /> הכסף נכנס
            </Button>
          )}
        </CardBody>

        {!paid && (
          <CardBody className="pt-0">
            <p className="text-xs text-ink-400">
              עד שתסמנו שהכסף נכנס, הסכום לא נספר במחזור השנתי ולא תופק קבלה — קבלה נושאת את היום
              שבו התשלום התקבל.
            </p>
          </CardBody>
        )}
      </Card>

      <Modal open={asking} onClose={() => setAsking(false)} title="התקבל תשלום" size="sm">
        <div className="space-y-3">
          <div className="rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-3 text-sm">
            <p className="font-bold text-ink-900">{job.customer_name}</p>
            <p className="text-xs text-ink-500">
              {job.job_number} · {formatAgorot(job.final_price_agorot ?? 0)}
            </p>
          </div>
          <div>
            <Label required>באיזה יום נכנס הכסף</Label>
            <Input
              type="date"
              value={paidOn}
              max={todayLocalDate()}
              onChange={(e) => setPaidOn(e.target.value)}
            />
            <p className="mt-1 text-xs text-ink-400">
              הסכום ייספר במחזור של היום הזה, והקבלה תישא אותו.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setAsking(false)}>
              ביטול
            </Button>
            <Button fullWidth loading={busy} onClick={confirm}>
              <CheckCircle2 className="h-4 w-4" /> התקבל
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
