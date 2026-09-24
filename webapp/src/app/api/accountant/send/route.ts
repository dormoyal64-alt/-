import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { createClient } from "@/lib/supabase/server";
import { toCsv } from "@/lib/csv";
import { agorotToShekels } from "@/lib/money";
import { formatDateHe } from "@/lib/dates";
import { monthRange, expenseLines, buildAccountantEmail } from "@/lib/accountant";
import type { AdSpend, AppSettings, BusinessExpense, ExpenseCategory, ExpenseReceipt, Receipt } from "@/lib/types";
import { RECEIPTS_BUCKET } from "@/lib/api/expenseReceipts";
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

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");

function configured(): boolean {
  return !!GMAIL_USER && !!GMAIL_APP_PASSWORD;
}

/** Whether the screens may offer a real send, and from which address. */
export async function GET() {
  return NextResponse.json({ configured: configured(), from: configured() ? GMAIL_USER : null });
}

export async function POST(request: NextRequest) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "לא מחוברים למערכת" }, { status: 401 });

  if (!configured()) {
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

  const [settingsRes, rec, fixed, cats, ads, costs, photos, contractorPaid, contractorPaper] =
    await Promise.all([
      supabase.from("app_settings").select("*").eq("id", true).maybeSingle(),
      supabase.from("receipts").select("*").gte("issued_at", fromIso).lte("issued_at", toIso).order("issued_at"),
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

  const receipts = (rec.data as Receipt[]) ?? [];
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

  const attachments: { filename: string; content: string | Buffer; contentType: string }[] = [
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

  // both kinds of paper go out together: what the business bought, and what the
  // contractors it paid handed over
  const photoRows: ExpenseReceipt[] = [...purchasePaper, ...contractorPaper];

  const { attached, skipped } = await attachPhotos(supabase, photoRows, attachments);

  let body = email.body;
  if (attached === 1) body += "\n\nמצורפת תמונה אחת של קבלה (רכישה או קבלן).";
  else if (attached > 1) body += `\n\nמצורפות ${attached} תמונות של קבלות רכישה וקבלות מקבלנים.`;
  if (skipped > 0) {
    // saying nothing would leave the accountant unaware there is more to ask for
    body += attached > 0 ? " " : "\n\n";
    body +=
      skipped === 1
        ? "תמונה אחת נוספת לא צורפה כדי לא לחרוג ממגבלת הגודל של המייל — אפשר לראות אותה במערכת."
        : `${skipped} תמונות נוספות לא צורפו כדי לא לחרוג ממגבלת הגודל של המייל — אפשר לראות אותן במערכת.`;
  }

  try {
    const transport = nodemailer.createTransport(smtpConfig());

    await transport.sendMail({
      from: settings?.business_name?.trim()
        ? `"${settings.business_name.trim()}" <${GMAIL_USER}>`
        : GMAIL_USER,
      to,
      replyTo: settings?.business_email?.trim() || undefined,
      subject: email.subject,
      text: body,
      attachments,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: gmailError(e) }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    to,
    receipts: receipts.length,
    expenses: expenses.length,
    photos: attached,
  });
}

/** Gmail refuses anything past 25MB, so the photographs stop well short of it. */
const PHOTO_BUDGET_BYTES = 15 * 1024 * 1024;

/**
 * The photographed receipts, as many as the message can carry.
 *
 * They are attached oldest first and stop at a budget rather than being
 * silently truncated by the mail server: an email that bounces for size helps
 * nobody, and the ones left behind are named in the body so the accountant
 * knows to ask.
 */
async function attachPhotos(
  supabase: ReturnType<typeof createClient>,
  rows: ExpenseReceipt[],
  attachments: { filename: string; content: string | Buffer; contentType: string }[]
): Promise<{ attached: number; skipped: number }> {
  let used = 0;
  let attached = 0;
  let skipped = 0;

  for (const row of rows) {
    if (used + (row.size_bytes ?? 0) > PHOTO_BUDGET_BYTES) {
      skipped += 1;
      continue;
    }
    const { data, error } = await supabase.storage.from(RECEIPTS_BUCKET).download(row.storage_path);
    if (error || !data) {
      skipped += 1;
      continue;
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    if (used + buffer.length > PHOTO_BUDGET_BYTES) {
      skipped += 1;
      continue;
    }
    used += buffer.length;
    attached += 1;
    attachments.push({
      filename: row.file_name || `receipt-${attached}.jpg`,
      content: buffer,
      contentType: row.content_type || "image/jpeg",
    });
  }

  return { attached, skipped };
}

/**
 * Gmail, unless a loopback address was named.
 *
 * The override exists so the send can be exercised against a local stand-in
 * server; it refuses to drop TLS for anything that is not on this machine, so
 * there is no configuration that quietly posts the business's mail in the
 * clear.
 */
function smtpConfig() {
  const auth = { user: GMAIL_USER!, pass: GMAIL_APP_PASSWORD! };
  const host = process.env.SMTP_HOST;
  if (!host) return { service: "gmail", auth };
  const local = host === "127.0.0.1" || host === "localhost" || host === "::1";
  return {
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: false,
    ignoreTLS: local,
    requireTLS: !local,
    auth,
  };
}

/**
 * Google's own words, when they help.
 *
 * A rejected password and a blocked sign-in are different problems with
 * different fixes, and "sending failed" sends the business looking in the
 * wrong place for both.
 */
function gmailError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e ?? "");
  if (/invalid login|username and password not accepted|535/i.test(message)) {
    return "Gmail דחה את פרטי ההתחברות. צריך סיסמת אפליקציה (App Password), לא סיסמת החשבון הרגילה.";
  }
  if (/timed out|ETIMEDOUT|ECONNREFUSED/i.test(message)) {
    return "לא הצלחנו להתחבר לשרת של Gmail. נסו שוב בעוד רגע.";
  }
  return message ? `השליחה נכשלה: ${message}` : "השליחה נכשלה.";
}
