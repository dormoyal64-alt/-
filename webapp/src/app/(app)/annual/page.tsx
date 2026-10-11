"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Gauge,
} from "lucide-react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { formatAgorot } from "@/lib/money";
import { formatDateHe, todayLocalDate } from "@/lib/dates";
import { errorMessage } from "@/lib/errors";
import {
  dueLabel,
  fetchAnnualByMethod,
  fetchAnnualByMonth,
  fetchAwaitingPayment,
  markJobPaid,
  termsLabel,
} from "@/lib/api/annual";
import type { AnnualByMethod, AnnualByMonth, JobWithRelations } from "@/lib/types";

/**
 * The year against the exemption ceiling.
 *
 * An עוסק פטור is only one until the year's turnover passes the ceiling, and
 * the way that goes wrong is never a surprise in December — it is nine months
 * of not looking. So the whole year is one bar, counted from the money that
 * actually came in, with what is still owed shown beside it rather than mixed
 * into it.
 *
 * Money is counted on the day it arrived, which for a job paid on the spot is
 * the day it closed and for an institution is the day the transfer landed.
 */

const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

export default function AnnualPage() {
  const supabase = useMemo(() => createClient(), []);
  const { settings } = useRefData();
  const toast = useToast();

  const [year, setYear] = useState(() => new Date().getFullYear());
  const [byMethod, setByMethod] = useState<AnnualByMethod[]>([]);
  const [byMonth, setByMonth] = useState<AnnualByMonth[]>([]);
  const [waiting, setWaiting] = useState<JobWithRelations[]>([]);
  // the columns arrive with a migration; until they do the screen says so
  // rather than showing a year of zeros as though that were the truth
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);

  const [paying, setPaying] = useState<JobWithRelations | null>(null);
  const [paidOn, setPaidOn] = useState(todayLocalDate());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [methods, months, owed] = await Promise.all([
      fetchAnnualByMethod(supabase, year),
      fetchAnnualByMonth(supabase, year),
      fetchAwaitingPayment(supabase),
    ]);
    setReady(methods !== null && months !== null);
    setByMethod(methods ?? []);
    setByMonth(months ?? []);
    setWaiting(owed ?? []);
    setLoading(false);
  }, [supabase, year]);

  useEffect(() => {
    load();
  }, [load]);

  const received = byMethod.reduce((s, r) => s + r.received_agorot, 0);
  const pending = byMethod.reduce((s, r) => s + r.pending_agorot, 0);
  const jobs = byMethod.reduce((s, r) => s + r.jobs, 0);
  const ceiling = settings?.exempt_ceiling_agorot ?? 12283300;
  const left = ceiling - received;
  const pct = ceiling > 0 ? Math.min(100, (received / ceiling) * 100) : 0;
  // what the year would reach if everything still owed came in
  const pctWithPending = ceiling > 0 ? Math.min(100, ((received + pending) / ceiling) * 100) : 0;
  const over = received > ceiling;
  const close = !over && received >= ceiling * 0.85;
  const wouldPass = !over && received + pending > ceiling;

  const overdue = waiting.filter((j) => j.payment_due_on && dueLabel(j.payment_due_on).late);

  async function confirmPaid() {
    if (!paying) return;
    setSaving(true);
    try {
      await markJobPaid(supabase, paying.id, paidOn || null);
      toast.success(`סומן שהתשלום על ${paying.job_number} התקבל`);
      setPaying(null);
      await load();
    } catch (e) {
      toast.error(errorMessage(e, "לא הצלחנו לסמן את התשלום"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">מחזור שנתי ותקרת הפטור</h1>
        <p className="text-sm text-ink-500">
          כמה כסף נכנס מתחילת השנה, לפי אמצעי תשלום, מול התקרה של עוסק פטור.
        </p>
      </div>

      <Card>
        <CardBody className="flex items-center justify-between gap-2">
          <button
            onClick={() => setYear((y) => y - 1)}
            className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:bg-ink-50"
            aria-label="שנה קודמת"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-lg font-extrabold text-ink-900">{year}</span>
          <button
            onClick={() => setYear((y) => y + 1)}
            disabled={year >= new Date().getFullYear()}
            className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:bg-ink-50 disabled:opacity-30"
            aria-label="שנה הבאה"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </CardBody>
      </Card>

      {!ready && !loading && (
        <Card className="border-warning-100 bg-warning-50/60">
          <CardBody className="flex items-start gap-2.5 text-sm">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-600" />
            <p className="text-ink-700">
              המסך הזה צריך עדכון של הדאטהבייס שעוד לא רץ. אחרי שתריצו אותו, המספרים יופיעו כאן לבד.
            </p>
          </CardBody>
        </Card>
      )}

      {/* the whole year in one line */}
      <Card className={over ? "border-2 border-danger-200" : close ? "border-2 border-warning-200" : undefined}>
        <CardBody className="space-y-3">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-ink-400">נכנס בפועל ב-{year}</p>
              <p className={`text-3xl font-extrabold ${over ? "text-danger-600" : "text-ink-900"}`}>
                {formatAgorot(received)}
              </p>
              <p className="text-xs text-ink-400">
                מ-{jobs} עבודות שנסגרו
              </p>
            </div>
            <div className="text-left">
              <p className="text-xs font-bold text-ink-400">התקרה</p>
              <p className="text-lg font-extrabold text-ink-700">{formatAgorot(ceiling)}</p>
            </div>
          </div>

          {/* received, and behind it what would arrive if everything owed came in */}
          <div className="relative h-3.5 overflow-hidden rounded-full bg-ink-100">
            <div
              className="absolute inset-y-0 right-0 bg-brand-200"
              style={{ width: `${pctWithPending}%` }}
            />
            <div
              className={`absolute inset-y-0 right-0 ${
                over ? "bg-danger-500" : close ? "bg-warning-500" : "bg-success-500"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>

          <div className="flex items-center justify-between text-xs font-bold">
            <span className={over ? "text-danger-600" : close ? "text-warning-700" : "text-success-700"}>
              {Math.round(pct)}% מהתקרה
            </span>
            <span className="text-ink-500">
              {over
                ? `חרגת ב-${formatAgorot(received - ceiling)}`
                : `נשאר עד התקרה: ${formatAgorot(left)}`}
            </span>
          </div>

          {pending > 0 && (
            <div className="flex items-start gap-2 rounded-xl bg-brand-50/70 px-3.5 py-2.5 text-xs">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
              <p className="text-ink-600">
                בנוסף <b className="text-ink-900">{formatAgorot(pending)}</b> שכבר עבדת עליהם
                ועדיין לא נכנסו. אם הכל ייכנס השנה, תגיע ל-
                <b className="text-ink-900">{formatAgorot(received + pending)}</b>
                {wouldPass && <span className="font-bold text-danger-600"> — מעל התקרה</span>}.
              </p>
            </div>
          )}

          {over && (
            <p className="rounded-xl bg-danger-50 px-3.5 py-2.5 text-xs font-bold text-danger-700">
              עברת את התקרה. מהרגע שעוברים, העסקאות חייבות במע״מ וצריך לעדכן את מע״מ האזורי —
              כדאי לדבר עם רואה החשבון עכשיו.
            </p>
          )}
          {close && (
            <p className="rounded-xl bg-warning-50 px-3.5 py-2.5 text-xs font-bold text-warning-700">
              אתה מתקרב לתקרה. שווה לבדוק עם רואה החשבון מה עדיף מכאן.
            </p>
          )}
        </CardBody>
      </Card>

      {/* what is owed and from whom */}
      {waiting.length > 0 && (
        <Card className={overdue.length > 0 ? "border-2 border-warning-200" : undefined}>
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-brand-600" /> ממתין לתשלום
                <span className="text-sm font-bold text-ink-400">
                  {formatAgorot(waiting.reduce((s, j) => s + (j.final_price_agorot ?? 0), 0))}
                </span>
              </span>
            </CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <div className="divide-y divide-ink-50">
              {waiting.map((job) => {
                const due = dueLabel(job.payment_due_on);
                return (
                  <div key={job.id} className="flex items-center gap-2 px-4 py-2.5">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                        due.late ? "bg-danger-50 text-danger-600" : due.soon ? "bg-warning-50 text-warning-600" : "bg-ink-100 text-ink-400"
                      }`}
                    >
                      {due.late ? <AlertTriangle className="h-4 w-4" /> : <CalendarClock className="h-4 w-4" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/jobs/${job.id}`}
                        className="block truncate text-sm font-bold text-ink-800 hover:text-brand-700"
                      >
                        {job.customer_name}
                        {job.institution_ref ? ` · ${job.institution_ref}` : ""}
                      </Link>
                      <p className="text-xs text-ink-400">
                        <span className={due.late ? "font-bold text-danger-600" : due.soon ? "font-bold text-warning-700" : ""}>
                          {due.text}
                        </span>
                        {" · "}
                        {termsLabel(job.payment_terms_days)}
                        {" · "}
                        {job.payment_due_on ? <bdi>{formatDateHe(job.payment_due_on)}</bdi> : "—"}
                      </p>
                    </div>
                    <span className="shrink-0 font-extrabold text-ink-900">
                      {formatAgorot(job.final_price_agorot ?? 0)}
                    </span>
                    <Button
                      variant="secondary"
                      className="shrink-0 !px-2.5 !py-1.5 text-xs"
                      onClick={() => {
                        setPaidOn(todayLocalDate());
                        setPaying(job);
                      }}
                    >
                      התקבל
                    </Button>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      {/* by channel */}
      <Card>
        <CardHeader>
          <CardTitle>
            <span className="flex items-center gap-2">
              <Gauge className="h-4 w-4 text-brand-600" /> לפי אמצעי תשלום
            </span>
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-2">
          {loading ? (
            <p className="text-sm text-ink-400">טוען...</p>
          ) : byMethod.length === 0 ? (
            <p className="text-sm text-ink-400">עוד לא נסגרו עבודות בשנה הזו</p>
          ) : (
            <>
              {byMethod.map((row) => {
                const share = received > 0 ? (row.received_agorot / received) * 100 : 0;
                return (
                  <div key={row.bucket} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-semibold text-ink-700">
                        {row.bucket}
                        <span className="mr-1.5 text-xs font-normal text-ink-400">
                          {row.jobs} עבודות
                        </span>
                      </span>
                      <span className="font-extrabold text-ink-900">
                        {formatAgorot(row.received_agorot)}
                        {row.pending_agorot > 0 && (
                          <span className="mr-1.5 text-xs font-bold text-brand-600">
                            +{formatAgorot(row.pending_agorot)} בדרך
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-ink-100">
                      <div className="h-full bg-brand-500" style={{ width: `${share}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex items-center justify-between border-t border-ink-100 pt-2 text-sm">
                <span className="font-bold text-ink-700">סך הכל נכנס</span>
                <span className="font-extrabold text-success-700">{formatAgorot(received)}</span>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {/* month by month */}
      <Card>
        <CardHeader>
          <CardTitle>חודש אחר חודש</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <div className="divide-y divide-ink-50">
            {byMonth.map((row) => {
              const max = Math.max(...byMonth.map((m) => m.received_agorot + m.pending_agorot), 1);
              const share = ((row.received_agorot + row.pending_agorot) / max) * 100;
              return (
                <div key={row.month} className="flex items-center gap-3 px-4 py-2">
                  <span className="w-16 shrink-0 text-xs font-bold text-ink-500">
                    {MONTHS[row.month - 1]}
                  </span>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-ink-50">
                    <div className="h-full bg-success-400" style={{ width: `${share}%` }} />
                  </div>
                  <span className="shrink-0 text-sm font-extrabold tabular-nums text-ink-900">
                    {row.received_agorot > 0 ? formatAgorot(row.received_agorot) : "—"}
                  </span>
                  {row.pending_agorot > 0 && (
                    <span className="shrink-0 text-xs font-bold text-brand-600">
                      +{formatAgorot(row.pending_agorot)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>

      <p className="px-1 pb-4 text-xs text-ink-400">
        הסכומים נספרים לפי היום שבו הכסף נכנס — עבודה שנסגרה במזומן נספרת ביום שלה, ועבודה של מוסד
        נספרת ביום שהעברה הגיעה. התקרה נלקחת מההגדרות ואפשר לעדכן אותה בכל שנה.
      </p>

      <Modal open={!!paying} onClose={() => setPaying(null)} title="התקבל תשלום" size="sm">
        {paying && (
          <div className="space-y-3">
            <div className="rounded-xl border border-ink-100 bg-ink-50 px-3.5 py-3 text-sm">
              <p className="font-bold text-ink-900">{paying.customer_name}</p>
              <p className="text-xs text-ink-500">
                {paying.job_number} · {formatAgorot(paying.final_price_agorot ?? 0)} ·{" "}
                {termsLabel(paying.payment_terms_days)}
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
                הסכום ייספר במחזור של היום הזה, והקבלה שתופק תישא אותו.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => setPaying(null)}>
                ביטול
              </Button>
              <Button fullWidth loading={saving} onClick={confirmPaid}>
                <CheckCircle2 className="h-4 w-4" /> התקבל
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
