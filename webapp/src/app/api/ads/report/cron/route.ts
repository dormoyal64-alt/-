import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { MAIL_FROM, mailConfigured, mailError, sendMail } from "@/lib/mail";
import {
  adMonthCsv,
  adMonthPaperNote,
  buildAdMonth,
  buildAdMonthEmail,
  monthEnd,
  monthKey,
} from "@/lib/ads/report";
import { israelDate } from "@/lib/ads/google";
import type { AdSpend, AppSettings, LeadSource } from "@/lib/types";
import {
  PHOTO_BUDGET_BYTES,
  attachReceiptFiles,
  listAdSpendReceipts,
} from "@/lib/api/expenseReceipts";
import type { Attachment } from "@/lib/mail";

/**
 * The advertising report, sent on its day without anyone remembering.
 *
 * The scheduler holds nothing but a password to ring this doorbell; the
 * database key and the mailbox password stay on the server that already has
 * them. It is called twice a day, at 05:00 and 06:00 UTC, because eight in the
 * morning in Israel is one of those two depending on daylight saving — and the
 * second call is a no-op, since a month already sent is not sent again.
 *
 * That idempotence is the whole safety of the thing: it is also what makes a
 * retry, a redeploy or a double-fire harmless.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorised(request: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  // no secret configured means no scheduled sending, rather than an open door
  if (!expected) return false;
  const given =
    request.headers.get("x-cron-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    "";
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

/** The month before the one this Israeli date falls in. */
function previousMonth(today: string): string {
  const d = new Date(today + "T00:00:00");
  return monthKey(new Date(d.getFullYear(), d.getMonth() - 1, 1));
}

async function run(request: NextRequest) {
  if (!authorised(request)) {
    return NextResponse.json({ ok: false, error: "unauthorised" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    return NextResponse.json(
      { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set on this server" },
      { status: 503 }
    );
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: settingsRow, error: settingsError } = await supabase
    .from("app_settings")
    .select("*")
    .eq("id", true)
    .maybeSingle();
  // a failed read is not the same as a settings row that says do not send: if
  // this came back silent and were treated as "off", the report would quietly
  // stop going out and nothing would ever say why
  if (settingsError || !settingsRow) {
    return NextResponse.json(
      { ok: false, error: `could not read the settings: ${settingsError?.message ?? "no row"}` },
      { status: 503 }
    );
  }
  const settings = settingsRow as AppSettings;

  if (!settings.ad_report_auto) {
    return NextResponse.json({ ok: true, skipped: "automatic sending is off" });
  }

  // the day is read in Israel, not in UTC: at 05:00 UTC on the 1st it is
  // already the 1st in Israel, and a report due on the 1st must not wait a day
  const today = israelDate();
  const dayOfMonth = Number(today.slice(8, 10));
  // a date named in the query is for trying it by hand; it never bypasses the
  // "already sent" check below
  const asked = new URL(request.url).searchParams.get("month");
  const month = asked && /^\d{4}-\d{2}-01$/.test(asked) ? asked : previousMonth(today);

  if (!asked && dayOfMonth !== (settings.ad_report_day ?? 5)) {
    return NextResponse.json({ ok: true, skipped: `today is the ${dayOfMonth}, the report goes out on the ${settings.ad_report_day}` });
  }

  const { data: already } = await supabase
    .from("ad_report_months")
    .select("sent_at")
    .eq("month", month)
    .maybeSingle();
  if (already?.sent_at) {
    return NextResponse.json({ ok: true, skipped: `${month} was already sent at ${already.sent_at}` });
  }

  const to = settings.accountant_email?.trim();
  if (!to) {
    return NextResponse.json({ ok: false, error: "no accountant email configured" }, { status: 400 });
  }
  if (!mailConfigured()) {
    return NextResponse.json({ ok: false, error: "the business mailbox is not configured" }, { status: 503 });
  }

  const [spendRes, sourcesRes] = await Promise.all([
    supabase
      .from("ad_spend")
      .select("*")
      .gte("spent_on", month)
      .lte("spent_on", monthEnd(month))
      .order("spent_on"),
    supabase.from("lead_sources").select("id, name"),
  ]);

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
  const email = buildAdMonthEmail(report, settings.business_name ?? null, channelName, note);

  try {
    await sendMail({
      to,
      cc: settings.business_email?.trim() || MAIL_FROM,
      replyTo: settings.business_email ?? null,
      fromName: settings.business_name ?? null,
      subject: email.subject,
      text: email.body,
      attachments,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: mailError(e) }, { status: 502 });
  }

  await supabase.rpc("mark_ad_month_sent", { p_month: month, p_to: to });

  return NextResponse.json({ ok: true, month, to, rows: report.rows.length, total: report.total });
}

// Vercel's scheduler issues a GET; a person testing it by hand usually reaches
// for POST, and both should do the same thing
export const GET = run;
export const POST = run;
