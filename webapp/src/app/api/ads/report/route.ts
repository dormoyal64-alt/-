import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { MAIL_FROM, mailConfigured, mailError, sendMail } from "@/lib/mail";
import {
  adMonthCsv,
  adMonthPaperNote,
  buildAdMonth,
  buildAdMonthEmail,
  monthEnd,
} from "@/lib/ads/report";
import type { AdSpend, AppSettings, LeadSource } from "@/lib/types";
import {
  PHOTO_BUDGET_BYTES,
  attachReceiptFiles,
  listAdSpendReceipts,
} from "@/lib/api/expenseReceipts";
import type { Attachment } from "@/lib/mail";

/**
 * One month of advertising, sent to the accountant.
 *
 * The request carries a month and nothing else. What goes out is read here,
 * through the caller's own session, so a page cannot ask this route to send
 * figures the person could not see for themselves — and the mailbox password
 * stays in an environment variable the browser never sees.
 *
 * A copy goes to the business's own address, so there is always proof in the
 * owner's own inbox of what the accountant was sent and when.
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
  if (!user) {
    return NextResponse.json({ ok: false, error: "לא מחוברים" }, { status: 401 });
  }

  if (!mailConfigured()) {
    return NextResponse.json(
      { ok: false, error: "המייל של העסק לא מוגדר בשרת (GMAIL_USER / GMAIL_APP_PASSWORD)" },
      { status: 503 }
    );
  }

  let month: string | undefined;
  try {
    const body = await request.json();
    month = typeof body?.month === "string" ? body.month : undefined;
  } catch {
    // handled by the guard below
  }
  // the first of a month, and nothing else — the key every month is stored by
  if (!month || !/^\d{4}-\d{2}-01$/.test(month)) {
    return NextResponse.json({ ok: false, error: "חודש לא תקין" }, { status: 400 });
  }

  const [settingsRes, spendRes, sourcesRes] = await Promise.all([
    supabase.from("app_settings").select("*").eq("id", true).maybeSingle(),
    supabase
      .from("ad_spend")
      .select("*")
      .gte("spent_on", month)
      .lte("spent_on", monthEnd(month))
      .order("spent_on"),
    supabase.from("lead_sources").select("id, name"),
  ]);

  const settings = settingsRes.data as AppSettings | null;
  const to = settings?.accountant_email?.trim();
  if (!to) {
    return NextResponse.json({ ok: false, error: "לא הוגדר מייל של רואה החשבון" }, { status: 400 });
  }

  const sources = (sourcesRes.data as Pick<LeadSource, "id" | "name">[]) ?? [];
  const channelName = (id: string | null) => sources.find((s) => s.id === id)?.name ?? "ללא ערוץ";
  const report = buildAdMonth(month, (spendRes.data as AdSpend[]) ?? [], channelName);

  // the invoices behind this month's figures, as many as the message can carry.
  // They are filed against the very rows being sent, so a campaign that spans
  // two months brings its paper to the month its date says it belongs to —
  // the same rule the figures follow
  const attachments: Attachment[] = [
    {
      filename: `ads-${month.slice(0, 7)}.csv`,
      content: adMonthCsv(report, channelName),
      contentType: "text/csv; charset=utf-8",
    },
  ];
  const paper = await listAdSpendReceipts(supabase, report.rows.map((r) => r.id)).catch(() => []);
  const { attached, skipped } = await attachReceiptFiles(
    supabase,
    paper,
    attachments,
    PHOTO_BUDGET_BYTES
  );
  const note = adMonthPaperNote(attached, skipped);
  const email = buildAdMonthEmail(report, settings?.business_name ?? null, channelName, note);

  try {
    await sendMail({
      to,
      // the owner keeps a copy, so what was sent and when is never only the
      // accountant's word
      cc: settings?.business_email?.trim() || MAIL_FROM,
      replyTo: settings?.business_email ?? null,
      fromName: settings?.business_name ?? null,
      subject: email.subject,
      text: email.body,
      attachments,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: mailError(e) }, { status: 502 });
  }

  // recorded only once the message has actually gone; a failed send must not
  // leave a month looking reported. The database stamps it, in one statement,
  // so a month created by its own send does not come out looking already stale.
  const { data: stamped } = await supabase.rpc("mark_ad_month_sent", { p_month: month, p_to: to });
  const row = Array.isArray(stamped) ? stamped[0] : stamped;

  return NextResponse.json({
    ok: true,
    to,
    sent_at: row?.sent_at ?? new Date().toISOString(),
    rows: report.rows.length,
    total: report.total,
  });
}
