import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAIL_FROM, mailConfigured, mailError, sendMail, type Attachment } from "@/lib/mail";
import { toCsv } from "@/lib/csv";
import { agorotToShekels } from "@/lib/money";
import { formatDateHe } from "@/lib/dates";
import { monthRange, expenseLines, buildAccountantEmail } from "@/lib/accountant";
import type { AdSpend, AppSettings, BusinessExpense, ExpenseCategory, ExpenseReceipt, Receipt } from "@/lib/types";
import {
  PHOTO_BUDGET_BYTES,
  adSpendReceiptFilesInMonth,
  attachReceiptFiles,
  jobExpenseReceiptFilesInMonth,
} from "@/lib/api/expenseReceipts";
import { fetchLiveReceipts } from "@/lib/api/jobs";
import { contractorReceiptLines, contractorReceiptFilesInMonth } from "@/lib/api/contractorReceipts";

/**
 * The month, sent — with the spreadsheets attached.
 *
 * A link to a compose window can carry text and nothing else; a file has to
 * be handed to a server that can actually post the message. This one signs in
 * to the business's own Gmail over SMTP, so the accountant receives it from
 * the address they already know, with the two CSVs attached and the figures
 * in the body.
 *
 * The app password lives in an environment variable the browser never sees,
 * and the request carries only a year and a month: what goes out is read from
 * the database here, through the caller's own session, so a page cannot ask
 * this route to send anything the person could not see for themselves.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Whether the screens may offer a real send, and from which address. */
export async function GET() {
  return NextResponse.json({ configured: mailConfigured(), from: mailConfigured() ? MAIL_FROM : null });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "לא מחוברים למערכת" }, { status: 401 });

  if (!mailConfigured()) {
    return NextResponse.json(
      { ok: false, configured: false, error: "שליחה ישירה לא מוגדרת" },
      { status: 503 }
    );
  }

  let year: number | undefined;
  let month: number | undefined;
  try {
    const body = await request.json();
    year = Number(body?.year);
    month = Number(body?.month);
  } catch {
    // handled by the guard below
  }
  if (!Number.isInteger(year) || !Number.isInteger(month) || month! < 0 || month! > 11) {
    return NextResponse.json({ ok: false, error: "חודש לא תקין" }, { status: 400 });
  }

  const range = monthRange(year!, month!);
  const fromIso = `${range.from}T00:00:00`;
  const toIso = `${range.to}T23:59:59.999`;

  const [settingsRes, rec, fixed, cats, ads, costs, photos, contractorPaid, contractorPaper, adPaper, jobCostPaper] =
    await Promise.all([
      supabase.from("app_settings").select("*").eq("id", true).maybeSingle(),
      fetchLiveReceipts(supabase, fromIso, toIso),
      supabase.from("business_expenses").select("*").lte("spent_on", range.to),
      supabase.from("expense_categories").select("*"),
      supabase.from("ad_spend").select("*").lte("spent_on", range.to),
      supabase
        .from("job_expenses")
        .select("description, amount_agorot, job:jobs!inner(job_number, closed_at)")
        .gte("job.closed_at", fromIso)
        .lte("job.closed_at", toIso),
      // the photographed receipts behind the bills that touch this month
      supabase
        .from("expense_receipts")
        .select("*, expense:business_expenses!inner(spent_on, covers_to)")
        .lte("expense.spent_on", range.to)
        .order("created_at"),
      contractorReceiptLines(supabase, range.from, range.to),
      contractorReceiptFilesInMonth(supabase, range.from, range.to),
      // the invoice behind the advertising, which the figures alone cannot prove
      adSpendReceiptFilesInMonth(supabase, range.from, range.to),
      // and the counter receipts for what was bought for the jobs themselves
      jobExpenseReceiptFilesInMonth(supabase, fromIso, toIso),
    ]);

  const settings = settingsRes.data as AppSettings | null;
  const to = settings?.accountant_email?.trim();
  if (!to) {
    return NextResponse.json({ ok: false, error: "לא הוגדר מייל של רואה החשבון" }, { status: 400 });
  }

  const categories = (cats.data as ExpenseCategory[]) ?? [];
  const categoryName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? "אחר";
  const jobCosts = (
    (costs.data as unknown as {
      description: string;
      amount_agorot: number;
      job: { job_number: string; closed_at: string } | null;
    }[]) ?? []
  )
    .filter((r) => r.job)
    .map((r) => ({
      closed_at: r.job!.closed_at,
      job_number: r.job!.job_number,
      description: r.description,
      amount_agorot: r.amount_agorot,
    }));

  const receipts = rec;
  const expenses = expenseLines(
    range.from,
    range.to,
    (fixed.data as BusinessExpense[]) ?? [],
    categoryName,
    (ads.data as AdSpend[]) ?? [],
    jobCosts,
    contractorPaid
  );

  if (receipts.length === 0 && expenses.length === 0) {
    return NextResponse.json({ ok: false, error: "אין נתונים בחודש הזה לשליחה" }, { status: 400 });
  }

  // the whole month goes in the body here: nothing has to survive a URL
  const email = buildAccountantEmail(range.label, settings?.business_name ?? null, receipts, expenses);
  const stamp = range.from.slice(0, 7);

  const receiptsCsv = toCsv(
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
  );

  const expensesCsv = toCsv(
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
  );

  const attachments: Attachment[] = [
    { filename: `receipts-${stamp}.csv`, content: receiptsCsv, contentType: "text/csv; charset=utf-8" },
    { filename: `expenses-${stamp}.csv`, content: expensesCsv, contentType: "text/csv; charset=utf-8" },
  ];

  const purchasePaper = (
    (photos.data as unknown as (ExpenseReceipt & {
      expense: { spent_on: string; covers_to: string | null } | null;
    })[]) ?? []
  ).filter((r) => {
    const end = r.expense?.covers_to ?? r.expense?.spent_on;
    return !!end && end >= range.from;
  });

  // every kind of paper goes out together: what the business bought, what the
  // contractors it paid handed over, what the advertising cost, and what was
  // bought at a counter for one job
  const photoRows: ExpenseReceipt[] = [
    ...purchasePaper,
    ...contractorPaper,
    ...adPaper,
    ...jobCostPaper,
  ];

  const { attached, skipped } = await attachReceiptFiles(supabase, photoRows, attachments, PHOTO_BUDGET_BYTES);

  let body = email.body;
  if (attached === 1) body += "\n\nמצורפת קבלה אחת (רכישה, קבלן או פרסום).";
  else if (attached > 1)
    body += `\n\nמצורפות ${attached} קבלות — רכישות, הוצאות על עבודות, קבלות מקבלנים וחשבוניות פרסום.`;
  if (skipped > 0) {
    // saying nothing would leave the accountant unaware there is more to ask for
    body += attached > 0 ? " " : "\n\n";
    body +=
      skipped === 1
        ? "תמונה אחת נוספת לא צורפה כדי לא לחרוג ממגבלת הגודל של המייל — אפשר לראות אותה במערכת."
        : `${skipped} תמונות נוספות לא צורפו כדי לא לחרוג ממגבלת הגודל של המייל — אפשר לראות אותן במערכת.`;
  }

  try {
    await sendMail({
      to,
      replyTo: settings?.business_email ?? null,
      fromName: settings?.business_name ?? null,
      subject: email.subject,
      text: body,
      attachments,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: mailError(e) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    to,
    receipts: receipts.length,
    expenses: expenses.length,
    photos: attached,
  });
}
