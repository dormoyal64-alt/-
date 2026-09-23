"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronLeft, Download, Mail, Copy, Receipt as ReceiptIcon, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRefData } from "@/lib/refdata";
import { useToast } from "@/components/ui/Toast";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatAgorot, agorotToShekels } from "@/lib/money";
import { formatDateHe } from "@/lib/dates";
import { toCsv, downloadCsv } from "@/lib/csv";
import {
  monthRange,
  expenseLines,
  buildAccountantEmail,
  gmailComposeLink,
  mailtoLink,
  type ExpenseLine,
} from "@/lib/accountant";
import type { AdSpend, BusinessExpense, ExpenseCategory, Receipt } from "@/lib/types";

/**
 * One month, as the accountant needs it.
 *
 * Everything already lives in the system; what was missing was a month-shaped
 * view of it and a way out. The figures are worked out with the same
 * arithmetic the balance screen uses, so the business and its accountant are
 * never looking at two different months.
 */
export default function AccountantPage() {
  const supabase = useMemo(() => createClient(), []);
  const { settings } = useRefData();
  const toast = useToast();

  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const range = monthRange(year, month);

  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [expenses, setExpenses] = useState<ExpenseLine[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const fromIso = `${range.from}T00:00:00`;
    const toIso = `${range.to}T23:59:59.999`;

    const [rec, fixed, cats, ads, costs] = await Promise.all([
      supabase.from("receipts").select("*").gte("issued_at", fromIso).lte("issued_at", toIso).order("issued_at"),
      supabase.from("business_expenses").select("*").lte("spent_on", range.to),
      supabase.from("expense_categories").select("*"),
      supabase.from("ad_spend").select("*").lte("spent_on", range.to),
      supabase
        .from("job_expenses")
        .select("description, amount_agorot, job:jobs!inner(job_number, closed_at, is_closed)")
        .gte("job.closed_at", fromIso)
        .lte("job.closed_at", toIso),
    ]);

    const categories = (cats.data as ExpenseCategory[]) ?? [];
    const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "אחר";

    const jobCosts = (((costs.data as unknown as {
      description: string;
      amount_agorot: number;
      job: { job_number: string; closed_at: string } | null;
    }[]) ?? [])
      .filter((r) => r.job)
      .map((r) => ({
        closed_at: r.job!.closed_at,
        job_number: r.job!.job_number,
        description: r.description,
        amount_agorot: r.amount_agorot,
      })));

    setReceipts((rec.data as Receipt[]) ?? []);
    setExpenses(
      expenseLines(
        range.from,
        range.to,
        (fixed.data as BusinessExpense[]) ?? [],
        categoryName,
        (ads.data as AdSpend[]) ?? [],
        jobCosts
      )
    );
    setLoading(false);
  }, [supabase, range.from, range.to]);

  useEffect(() => {
    load();
  }, [load]);

  const income = receipts.reduce((s, r) => s + r.amount_agorot, 0);
  const outgoing = expenses.reduce((s, e) => s + e.amount_agorot, 0);

  const email = buildAccountantEmail(range.label, settings?.business_name ?? null, receipts, expenses);
  const gmail = gmailComposeLink(settings?.accountant_email, email.subject, email.body);
  const mailto = mailtoLink(settings?.accountant_email, email.subject, email.body);

  function step(by: number) {
    const d = new Date(year, month + by, 1);
    setYear(d.getFullYear());
    setMonth(d.getMonth());
  }

  function downloadReceipts() {
    downloadCsv(
      `קבלות-${range.from.slice(0, 7)}.csv`,
      toCsv(
        receipts.map((r) => ({
          date: formatDateHe(r.issued_at),
          number: r.receipt_number,
          customer: r.customer_name,
          method: r.payment_method_name ?? "",
          amount: agorotToShekels(r.amount_agorot),
        })),
        [
          { key: "date", label: "תאריך" },
          { key: "number", label: "מספר קבלה" },
          { key: "customer", label: "לקוח" },
          { key: "method", label: "אמצעי תשלום" },
          { key: "amount", label: "סכום (₪)" },
        ]
      )
    );
  }

  function downloadExpenses() {
    downloadCsv(
      `הוצאות-${range.from.slice(0, 7)}.csv`,
      toCsv(
        expenses.map((e) => ({
          date: formatDateHe(e.date),
          kind: e.kind,
          description: e.description,
          amount: agorotToShekels(e.amount_agorot),
        })),
        [
          { key: "date", label: "תאריך" },
          { key: "kind", label: "סוג" },
          { key: "description", label: "פירוט" },
          { key: "amount", label: "סכום (₪)" },
        ]
      )
    );
  }

  async function copyAll() {
    try {
      await navigator.clipboard.writeText(email.body);
      toast.success("הדוח הועתק — אפשר להדביק במייל");
    } catch {
      toast.error("לא הצלחנו להעתיק. אפשר להוריד CSV במקום.");
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-extrabold text-ink-900">דוח לרואה חשבון</h1>
        <p className="text-sm text-ink-500">
          כל חודש בנפרד — הקבלות שהוצאו וההוצאות שהיו, מוכנים לשליחה
        </p>
      </div>

      <Card>
        <CardBody className="flex items-center justify-between gap-2">
          <button
            onClick={() => step(-1)}
            className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:bg-ink-50"
            aria-label="חודש קודם"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="text-lg font-extrabold text-ink-900">{range.label}</span>
          <button
            onClick={() => step(1)}
            className="rounded-xl border border-ink-200 p-2 text-ink-500 hover:bg-ink-50"
            aria-label="חודש הבא"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Card className="border-success-100 bg-success-50">
          <CardBody className="text-center">
            <p className="text-xs font-bold text-success-700">הכנסות עם קבלה</p>
            <p className="mt-1 text-2xl font-extrabold text-success-700">{formatAgorot(income)}</p>
            <p className="text-xs text-success-600/80">{receipts.length} קבלות</p>
          </CardBody>
        </Card>
        <Card className="border-danger-100 bg-danger-50">
          <CardBody className="text-center">
            <p className="text-xs font-bold text-danger-700">הוצאות</p>
            <p className="mt-1 text-2xl font-extrabold text-danger-700">{formatAgorot(outgoing)}</p>
            <p className="text-xs text-danger-600/80">{expenses.length} רישומים</p>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardBody className="space-y-2">
          {gmail ? (
            <>
              <a
                href={gmail}
                target="_blank"
                rel="noreferrer"
                className="btn-primary flex w-full items-center justify-center gap-2 py-3"
              >
                <Mail className="h-4 w-4" /> שליחה דרך Gmail
              </a>
              <a
                href={mailto!}
                className="block text-center text-xs font-bold text-ink-400 hover:text-ink-700"
              >
                או דרך תוכנת המייל שבמחשב
              </a>
            </>
          ) : (
            <p className="rounded-xl bg-warning-50 px-3.5 py-3 text-sm font-semibold text-warning-700">
              לא הוגדר מייל של רואה החשבון — אפשר להגדיר אותו בהגדרות כלליות.
            </p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button variant="secondary" onClick={downloadReceipts} disabled={receipts.length === 0}>
              <Download className="h-4 w-4" /> CSV קבלות
            </Button>
            <Button variant="secondary" onClick={downloadExpenses} disabled={expenses.length === 0}>
              <Download className="h-4 w-4" /> CSV הוצאות
            </Button>
            <Button variant="secondary" onClick={copyAll}>
              <Copy className="h-4 w-4" /> העתקת הדוח
            </Button>
          </div>
          <p className="text-xs text-ink-400">
            הכפתור פותח חלון כתיבה ב-Gmail שלכם, עם הכתובת, הנושא וכל הדוח כבר בפנים — נשאר
            רק ללחוץ ״שלח״. אם אתם מחוברים לכמה חשבונות Gmail, ייפתח החשבון הפעיל. את קבצי
            ה-CSV אפשר להוריד ולצרף להודעה, אם רואה החשבון מעדיף טבלה.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ReceiptIcon className="h-5 w-5 text-ink-400" /> קבלות שהוצאו
          </CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-ink-400">טוען...</p>
          ) : receipts.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">לא הוצאו קבלות בחודש הזה</p>
          ) : (
            <div className="divide-y divide-ink-50">
              {receipts.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-24 shrink-0 text-xs font-bold text-ink-400">{formatDateHe(r.issued_at)}</span>
                  <span className="w-20 shrink-0 text-xs font-bold text-brand-700">{r.receipt_number}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-800">{r.customer_name}</span>
                  <span className="shrink-0 font-extrabold text-ink-900">{formatAgorot(r.amount_agorot)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between bg-ink-50 px-4 py-2.5">
                <span className="text-sm font-extrabold text-ink-900">סה״כ</span>
                <span className="font-extrabold text-success-700">{formatAgorot(income)}</span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-ink-400" /> הוצאות החודש
          </CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          {loading ? (
            <p className="p-4 text-sm text-ink-400">טוען...</p>
          ) : expenses.length === 0 ? (
            <p className="p-4 text-sm text-ink-400">לא נרשמו הוצאות בחודש הזה</p>
          ) : (
            <div className="divide-y divide-ink-50">
              {expenses.map((e, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="w-24 shrink-0 text-xs font-bold text-ink-400">{formatDateHe(e.date)}</span>
                  <span className="w-28 shrink-0 text-xs font-semibold text-ink-500">{e.kind}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-800">{e.description}</span>
                  <span className="shrink-0 font-extrabold text-ink-900">{formatAgorot(e.amount_agorot)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between bg-ink-50 px-4 py-2.5">
                <span className="text-sm font-extrabold text-ink-900">סה״כ</span>
                <span className="font-extrabold text-danger-600">{formatAgorot(outgoing)}</span>
              </div>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
