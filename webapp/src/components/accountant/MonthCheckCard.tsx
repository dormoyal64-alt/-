"use client";

import Link from "next/link";
import { AlertTriangle, CheckCircle2, CalendarClock, Ban, Hash, ChevronLeft } from "lucide-react";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { formatAgorot } from "@/lib/money";
import { formatDateHe } from "@/lib/dates";
import { termsLabel } from "@/lib/api/annual";
import type { MonthCheck } from "@/lib/api/monthCheck";

/**
 * What to look at before the month goes out.
 *
 * Deliberately silent when there is nothing wrong: a checklist that always has
 * something on it stops being read, and the whole value of this card is that
 * seeing it green means something. When it is not green it says what, how much
 * it is worth, and links straight to the job — because the only useful reply
 * to "this job has no receipt" is being one tap from issuing it.
 */
export function MonthCheckCard({ check, label }: { check: MonthCheck; label: string }) {
  const missingTotal = check.missing.reduce((s, j) => s + (j.final_price_agorot ?? 0), 0);
  const awaitingTotal = check.awaiting.reduce((s, j) => s + (j.final_price_agorot ?? 0), 0);

  // an empty month is not a clean month, and telling the owner every receipt
  // is in order when there were none is the kind of reassurance that teaches
  // him to stop reading this card
  const empty = check.rows.length === 0 && check.missing.length === 0 && check.awaiting.length === 0;
  if (empty) {
    return (
      <Card>
        <CardBody className="flex items-center gap-3">
          <CalendarClock className="h-5 w-5 shrink-0 text-ink-300" />
          <p className="text-sm text-ink-500">
            לא נסגרו עבודות בתשלום ב{label} — אין מה לבדוק.
          </p>
        </CardBody>
      </Card>
    );
  }

  if (!check.hasProblems && check.awaiting.length === 0) {
    return (
      <Card className="border-success-100 bg-success-50">
        <CardBody className="flex items-center gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-success-600" />
          <div>
            <p className="text-sm font-bold text-success-700">הכל תקין ב{label}</p>
            <p className="text-xs text-success-600/80">
              לכל {check.rows.length} העבודות שנסגרו בתשלום יש קבלה, והמספור רצוף. אפשר לשלוח.
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className={check.hasProblems ? "border-warning-200" : "border-ink-100"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {check.hasProblems ? (
            <AlertTriangle className="h-5 w-5 text-warning-600" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-success-600" />
          )}
          לפני השליחה — כדאי לבדוק
        </CardTitle>
      </CardHeader>
      <CardBody className="space-y-4">
        {check.missing.length > 0 && (
          <div>
            <p className="text-sm font-bold text-danger-700">
              {check.missing.length} עבודות נסגרו בתשלום בלי קבלה · {formatAgorot(missingTotal)}
            </p>
            <p className="mb-2 text-xs text-ink-500">
              הכסף הזה לא יופיע בדוח. אפשר להיכנס לעבודה ולהפיק קבלה, או להשאיר כך אם זו הייתה
              הכוונה.
            </p>
            <div className="divide-y divide-ink-50 overflow-hidden rounded-xl border border-ink-100">
              {check.missing.map((j) => (
                <Link
                  key={j.id}
                  href={`/jobs/${j.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-ink-50"
                >
                  <span className="w-20 shrink-0 text-xs font-bold text-ink-400">
                    {j.closed_at ? formatDateHe(j.closed_at) : "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink-800">
                    {j.customer_name}
                    <span className="mr-1.5 text-xs font-normal text-ink-400">{j.job_number}</span>
                    {check.cancelledJobIds.has(j.id) && (
                      <span className="mr-1.5 text-xs font-bold text-ink-400">הקבלה בוטלה</span>
                    )}
                  </span>
                  <span className="shrink-0 font-extrabold text-ink-900">
                    {formatAgorot(j.final_price_agorot ?? 0)}
                  </span>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
                </Link>
              ))}
            </div>
          </div>
        )}

        {check.cancelled.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-sm font-bold text-ink-800">
              <Ban className="h-4 w-4 text-ink-400" /> {check.cancelled.length} קבלות בוטלו
            </p>
            <p className="text-xs text-ink-500">
              מספר {check.cancelled.map((r) => r.receipt_number).join(", ")} מופיע ברצף אבל אין
              מאחוריו כסף — קבלה מבוטלת שומרת על מספרה כדי שלא ייווצר חור בספירה. זה תקין, רק כדאי
              שרואה החשבון ידע.
            </p>
          </div>
        )}

        {check.gaps.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-sm font-bold text-ink-800">
              <Hash className="h-4 w-4 text-ink-400" /> חסרים מספרים ברצף
            </p>
            <p className="text-xs text-ink-500">
              {check.gaps.join(", ")} — קבלות שהופקו בחודש אחר, או מספרים שנשרפו. שווה לוודא לפני
              שרואה החשבון שואל.
            </p>
          </div>
        )}

        {check.awaiting.length > 0 && (
          <div>
            <p className="flex items-center gap-1.5 text-sm font-bold text-ink-800">
              <CalendarClock className="h-4 w-4 text-brand-500" />
              {check.awaiting.length} עבודות ממתינות לתשלום · {formatAgorot(awaitingTotal)}
            </p>
            <p className="mb-2 text-xs text-ink-500">
              אלה לא חסרות — לפי שוטף+, הקבלה תופק ביום שהכסף ייכנס, והסכום ייספר באותו חודש.
            </p>
            <div className="divide-y divide-ink-50 overflow-hidden rounded-xl border border-ink-100">
              {check.awaiting.map((j) => (
                <Link
                  key={j.id}
                  href={`/jobs/${j.id}`}
                  className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-ink-50"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold text-ink-800">
                    {j.customer_name}
                    <span className="mr-1.5 text-xs font-normal text-ink-400">
                      {termsLabel(j.payment_terms_days ?? 0)}
                    </span>
                  </span>
                  <span className="shrink-0 font-extrabold text-ink-900">
                    {formatAgorot(j.final_price_agorot ?? 0)}
                  </span>
                  <ChevronLeft className="h-4 w-4 shrink-0 text-ink-300" />
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
